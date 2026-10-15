// Plan 02 (idea/web-test/02-laya-element-grounding-reranking-plan.md) — element grounding: find the element a step
// means ("Previous week", "Apply filter", "Submission date from") WITHOUT the agent reading a page snapshot, and
// optionally click / fill it. Candidates are extracted and pruned locally; rules pick when the match is clear,
// Laya reranks only an ambiguous short list, and the agent gets a compact list (~15 lines) when neither is sure.
//
// Usage:
//   node find.mjs --goal "<what to act on>" [--role button|link|tab|textbox|combobox|option|checkbox|any]
//                 [--click | --fill "<text>"] [--allow-write] [--shot <file.png>] [--cdp <url>] [--url <route of the page under test>]
//   node find.mjs --pick g7 [--click | --fill "<text>"] [--allow-write]     act on a candidate from the last list
// Prints one line: found=<gN|none> by=<rule|laya|none> p=<conf|-> role=<r> name="<n>" action=<clicked|filled|none|refused> candidates=<k> laya=on|off
//   by=none → the next lines list the top candidates (gN role "name" [hint]) — pick one with --pick, or snapshot if none fits.
// Safety: elements whose name looks like a write (submit, approve, save, delete …) are never clicked without
// --allow-write, which you pass only for steps the user has OK'd (write-action gate). Fill is always allowed
// (typing changes nothing until a write button is pressed).
// Every call is appended to ~/.ess-web-test/ground-log.jsonl (goal, candidates, choice) — the plan's benchmark data.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, alive, ask } from './laya-lib.mjs';
import { attach } from './cdp-lib.mjs';

const MAX_LAYA = 15;          // never send more candidates than this to Laya
const LAYA_MIN = 0.8;         // Laya's pick is used only at or above this
const LAYA_MARGIN = 0.25;     // …and only when it beats the runner-up by this much
const WRITE_RE = /\b(submit|approve|reject|delete|remove|save|send|confirm|cancel request|withdraw|upload|sign|accept|decline|assign|book|enrol|enroll|register|reset)\b/i;

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
const goal = opt('--goal'), pick = opt('--pick'), role = (opt('--role') || 'any').toLowerCase(), fillText = opt('--fill');
const doClick = argv.includes('--click'), allowWrite = argv.includes('--allow-write'), shot = opt('--shot');
if (!goal && !pick) {
  console.error('Usage: node find.mjs --goal "<target>" [--role <role>] [--click | --fill "<text>"] [--allow-write] [--shot <file>]\n       node find.mjs --pick gN [--click | --fill "<text>"] [--allow-write]');
  process.exit(2);
}

// Runs in the page: every visible interactive element, with the name a user would read, tagged data-lg-id.
const EXTRACT = () => {
  const SEL = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[tabindex]:not([tabindex="-1"])';
  const txt = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  const byIds = (ids) => (ids || '').split(/\s+/).map((id) => txt(document.getElementById(id))).filter(Boolean).join(' ');
  const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const roleOf = (el) => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[el.tagName]
    || (el.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', search: 'searchbox' })[el.type] || 'textbox' : 'generic');
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (!vis(el)) continue;
    const labelFor = el.id ? txt(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) : '';
    const name = (el.getAttribute('aria-label') || byIds(el.getAttribute('aria-labelledby')) || labelFor || txt(el.closest('label')) ||
      txt(el) || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').slice(0, 80);
    const hint = (byIds(el.getAttribute('aria-describedby')) || (el.getAttribute('placeholder') !== name ? el.getAttribute('placeholder') : '') || '').slice(0, 60);
    if (!name && !hint) continue;
    const id = `g${++n}`;
    el.setAttribute('data-lg-id', id);
    out.push({ id, role: roleOf(el), name, hint, disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true') });
  }
  return { url: location.pathname, candidates: out };
};

const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const ROLE_OK = (c) => role === 'any' || c.role === role || (role === 'textbox' && ['searchbox', 'combobox'].includes(c.role)) || (role === 'button' && c.role === 'generic');

function score(c, g) {
  const n = norm(c.name), h = norm(c.hint), gw = g.split(' ');
  if (n === g) return 100;
  if (h === g) return 90;
  if (n.startsWith(g) || n.endsWith(g)) return 70;
  if (n.includes(g) || h.includes(g)) return 60;
  const words = new Set(`${n} ${h}`.split(' '));
  const hit = gw.filter((w) => words.has(w)).length;
  return hit ? Math.round((40 * hit) / gw.length) : 0;
}

function log(entry) {
  try {
    const dir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.ess-web-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'ground-log.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* best-effort */ }
}

const a = await attach(opt('--cdp'), { url: opt('--url') });
if (a.error) { console.log(`found=none by=none action=none reason=${a.error}`); process.exit(1); }
const { browser, page } = a;
let layaOn = false;
try {
  let chosen = null, by = 'none', p = null, shortlist = [], total = 0, url = '';
  if (pick) {
    const info = await page.evaluate((id) => {
      const el = document.querySelector(`[data-lg-id="${id}"]`);
      return el ? { name: (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80), role: el.getAttribute('role') || el.tagName.toLowerCase() } : null;
    }, pick);
    if (!info) { console.log(`found=none by=none action=none reason=stale-pick (page changed; run --goal again)`); process.exit(1); }
    chosen = { id: pick, ...info }; by = 'model';
  } else {
    const ex = await page.evaluate(EXTRACT);
    url = ex.url; total = ex.candidates.length;
    const g = norm(goal);
    const pool = ex.candidates.filter(ROLE_OK).filter((c) => !(c.disabled && (doClick || fillText !== undefined)));
    const ranked = pool.map((c) => ({ ...c, s: score(c, g) })).sort((x, y) => y.s - x.s);
    // Only candidates sharing at least one word with the goal. Measured on ESS: with an unrelated pool Laya
    // picked the nav link "Attendance" for "Submit" / "Apply filter" at p=1.0 — so no lexical match = not found.
    shortlist = ranked.filter((c) => c.s > 0).slice(0, MAX_LAYA);
    const top = shortlist[0], second = shortlist[1];
    // Rule: an exact (or exact-hint) match that no other candidate ties.
    if (top && top.s >= 90 && !(second && second.s >= top.s)) { chosen = top; by = 'rule'; }
    // Laya reranks only a real choice: two or more lexical candidates.
    else if (shortlist.length >= 2) {
      const cfg = loadConfig();
      if (cfg.enabled !== false && (await alive(cfg.url))) {
        layaOn = true;
        const criteria = Object.fromEntries(shortlist.map((c) => [c.id, `${c.role} "${c.name}"${c.hint ? ` (${c.hint})` : ''}${c.disabled ? ' [disabled]' : ''}`.slice(0, 160)]));
        criteria.none = 'None of these elements matches the goal.';
        const ans = (await ask(cfg, { goal, page: url }, { target: { type: 'choice', instructions: 'Which page element should a tester use for this goal?', criteria } }, { maxLen: 768 }))?.target;
        if (ans) {
          const probs = Object.values(ans.probabilities).sort((x, y) => y - x);
          p = Number((ans.p ?? 0).toFixed(3));
          if (ans.label !== 'none' && ans.p >= LAYA_MIN && ans.p - (probs[1] ?? 0) >= LAYA_MARGIN) { chosen = shortlist.find((c) => c.id === ans.label); by = 'laya'; }
        }
      }
    }
    log({ goal, role, url, total, shortlist: shortlist.map(({ id, role: r, name, hint, s }) => ({ id, role: r, name, hint, s })), chosen: chosen?.id ?? null, by, p });
  }

  let action = 'none';
  if (chosen && (doClick || fillText !== undefined)) {
    const loc = page.locator(`[data-lg-id="${chosen.id}"]`).first();
    if (doClick && WRITE_RE.test(chosen.name) && !allowWrite) action = 'refused';
    else if (fillText !== undefined) { await loc.fill(fillText, { timeout: 5000 }); action = 'filled'; }
    else { await loc.click({ timeout: 5000 }); action = 'clicked'; }
  }
  if (shot) {
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(data, 'base64')); await cdp.detach().catch(() => {});
  }
  const q = (s) => `"${String(s ?? '').replace(/"/g, "'")}"`;
  console.log(`found=${chosen?.id ?? 'none'} by=${chosen ? by : 'none'} p=${p ?? '-'} role=${chosen?.role ?? '-'} name=${q(chosen?.name)} action=${action} candidates=${pick ? '-' : total} laya=${layaOn ? 'on' : 'off'}`);
  if (action === 'refused') console.log('→ looks like a write action: only with --allow-write, for a step the user OK\'d');
  if (!chosen && shortlist.length) {
    console.log('→ not sure; pick one with --pick gN, or take a snapshot if none fits:');
    for (const c of shortlist) console.log(`  ${c.id} ${c.role} ${q(c.name)}${c.hint ? ` [${c.hint}]` : ''}${c.disabled ? ' (disabled)' : ''}`);
  }
} catch (e) {
  console.log(`found=none by=none action=error reason=${q2(e.message)}`);
  process.exitCode = 1;
} finally { await browser.close().catch(() => {}); }

function q2(s) { return `"${String(s).split('\n')[0].replace(/"/g, "'")}"`; }
