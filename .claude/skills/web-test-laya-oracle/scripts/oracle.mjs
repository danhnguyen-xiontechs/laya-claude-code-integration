// Plan 01 (idea/web-test/01-laya-test-oracle-plan.md) — test oracle: decide whether a step reached its expected
// result from a COMPACT observation, rules first, Laya second, the agent last. False PASS is the costly error,
// so a PASS needs more confidence than a FAIL, and NOT_READY / AMBIGUOUS always go back to the agent.
//
// Order of decision:
//   1. rule   — page still loading (spinner/skeleton)          → not_ready (agent waits and re-runs)
//             — expected has quoted strings ('…' "…" ‘…’ “…”)  → all found on the page and no error text → pass
//   2. Laya   — labels pass / fail / not_ready / ambiguous on { expected, observed[], url, loading }
//               pass accepted at p ≥ 0.95, fail at p ≥ 0.85; anything else → review
//   3. agent  — `--status <pass|fail|blocked|skipped>` (by model); overriding a rule/Laya verdict needs --reason
//
// Usage:
//   node oracle.mjs <runDir> <caseId> <stepN> --observe [--observed "<text>" …] [--shot shots/TC01-S01.png]
//        --observe reads the compact state from the role browser (port 9222): url, loading, toast/alert texts,
//        and the page lines that contain the expected's quoted strings. --observed adds lines you read yourself
//        (quote page text, never paraphrase expected). At least one of the two is required.
//   node oracle.mjs <runDir> <caseId> <stepN> --status <pass|fail|blocked|skipped> [--reason "<why>"]
// Prints: oracle=<status> by=<rule|laya|model> p=<conf|-> review=<bool> [override=true] case=<id>:<status> remaining-not-run=N laya=on|off
// Every decision is appended to ~/.ess-web-test/oracle-log.jsonl for the plan's benchmark (false-pass rate etc.).
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, alive, ask } from './laya-lib.mjs';
import { attach } from './cdp-lib.mjs';

const PASS_MIN = 0.95, FAIL_MIN = 0.85;
const STATUSES = ['pass', 'fail', 'blocked', 'skipped'];
const ERROR_RE = /something went wrong|access denied|unauthori[sz]ed|an error occurred|failed to load|\b(?:4\d\d|5\d\d)\b.*error/i;

const argv = process.argv.slice(2);
const [runDir, caseId, stepN] = argv;
const rest = argv.slice(3);
const opt = (k) => { const i = rest.indexOf(k); return i === -1 ? undefined : rest[i + 1]; };
const all = (k) => rest.flatMap((a, i) => (a === k && rest[i + 1] !== undefined ? [rest[i + 1]] : []));
const statusArg = opt('--status'), reason = opt('--reason'), shot = opt('--shot'), cdpUrl = opt('--cdp');
const observeLive = rest.includes('--observe');
const observedArg = all('--observed');
if (!runDir || !caseId || !stepN || (!statusArg && !observeLive && !observedArg.length) || (statusArg && !STATUSES.includes(statusArg))) {
  console.error('Usage: node oracle.mjs <runDir> <caseId> <stepN> --observe [--observed "<text>" …] [--shot <file>]\n' +
    '       node oracle.mjs <runDir> <caseId> <stepN> --status <pass|fail|blocked|skipped> [--reason "<why>"]');
  process.exit(2);
}

const file = path.join(runDir, 'results.json');
const results = JSON.parse(fs.readFileSync(file, 'utf8'));
const c = (results.cases || []).find((x) => x.id === caseId);
const s = c?.steps?.find((x) => String(x.n) === String(stepN));
if (!s) { console.error(`no step ${caseId}-S${stepN} in ${file}`); process.exit(2); }
if (shot !== undefined) s.screenshot = shot;
s.at ??= new Date().toISOString();

/** Quoted fragments of the expected result: the concrete strings a rule can look for. */
function quoted(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/'([^']{2,})'|"([^"]{2,})"|‘([^’]{2,})’|“([^”]{2,})”/g)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4]).trim());
  return out;
}

async function observe(frags) {
  const a = await attach(cdpUrl);
  if (a.error) return { error: a.error };
  try {
    return await a.page.evaluate((frags) => {
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const loading = [...document.querySelectorAll('[class*="skeleton" i],[class*="spinner" i],[class*="loading" i],[aria-busy="true"],[role="progressbar"]')].filter(vis).length;
      const toasts = [...document.querySelectorAll('[role="alert"],[role="status"],[class*="toast" i],[class*="notification" i]')]
        .filter(vis).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5);
      // Visible text lines, plus the accessible names of icon-only controls (ESS calendar arrows have no text).
      const lines = (document.body?.innerText || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (const el of document.querySelectorAll('[aria-label],[title]')) {
        if (!vis(el)) continue;
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        if (name && !lines.includes(name)) lines.push(name);
      }
      const found = {};
      const hits = [];
      for (const f of frags) {
        const fl = f.toLowerCase();
        const line = lines.find((l) => l.toLowerCase().includes(fl));
        found[f] = !!line;
        if (line && !hits.includes(line)) hits.push(line.slice(0, 200));
      }
      return { url: location.pathname + location.search, loading, toasts, found, lines: hits, text: lines.join(' ').slice(0, 4000) };
    }, frags);
  } catch (e) { return { error: `observe: ${e.message.split('\n')[0]}` }; }
  finally { await a.browser.close().catch(() => {}); }
}

function log(entry) {
  try {
    const dir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.ess-web-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'oracle-log.jsonl'), JSON.stringify({ t: new Date().toISOString(), run: path.basename(path.resolve(runDir)), step: `${caseId}-S${stepN}`, ...entry }) + '\n');
  } catch { /* best-effort */ }
}

let layaOn = false;
let shownStatus = null;
if (statusArg) {
  const v = s.verdict || {};
  const decided = v.by === 'rule' || v.by === 'laya';
  if (decided && statusArg !== s.status) {
    if (!reason) { console.error(`overriding the ${v.by} verdict needs --reason "<why>"`); process.exit(2); }
    s.verdict = { ...v, by: 'model', override: true, reason };
  } else if (decided) s.verdict = { ...v, confirmed: true, ...(reason ? { reason } : {}) };
  else s.verdict = { ...v, by: 'model', review: false, ...(reason ? { reason } : {}) };
  s.status = statusArg;
  log({ expected: s.expected, observed: v.observed, final: statusArg, by: s.verdict.by, override: !!s.verdict.override });
} else {
  const frags = quoted(s.expected);
  const obs = observeLive ? await observe(frags) : { loading: 0, toasts: [], found: {}, lines: [], url: null };
  if (obs.error) { console.log(`oracle=error reason=${obs.error}`); process.exit(1); }
  const observed = [...obs.toasts, ...obs.lines, ...observedArg].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 12);
  if (observedArg.length) for (const f of frags) obs.found[f] ||= observedArg.some((o) => o.toLowerCase().includes(f.toLowerCase()));
  const errorSeen = ERROR_RE.test([...obs.toasts, ...observedArg].join(' '));
  s.actual = observed.join(' | ') || s.actual;

  let verdict = null;
  if (obs.loading > 0) verdict = { status: 'not_ready', by: 'rule' };
  else if (frags.length && frags.every((f) => obs.found[f]) && !errorSeen) verdict = { status: 'pass', by: 'rule' };

  let laya = null;
  if (!verdict) {
    const cfg = loadConfig();
    if (cfg.enabled !== false && (await alive(cfg.url))) {
      layaOn = true;
      laya = (await ask(cfg, { expected: s.expected ?? '', observed, url: obs.url, loading: obs.loading > 0 }, {
        verdict: {
          type: 'choice',
          instructions: 'A web test step. Does the observed page state show the expected result?',
          criteria: {
            pass: 'Yes: the observed state shows everything the expected result describes.',
            fail: 'No: the observed state contradicts the expected result: wrong value, wrong message, an error, or something missing.',
            not_ready: 'Not yet: the page is still loading or has not reached the state the expected result describes.',
            ambiguous: 'Cannot tell from this observation; a person needs to look.',
          },
        },
      }, { maxLen: 512 }))?.verdict ?? null;
    }
    if (laya) {
      const p = laya.p ?? 0;
      const ok = (laya.label === 'pass' && p >= PASS_MIN) || (laya.label === 'fail' && p >= FAIL_MIN);
      verdict = ok ? { status: laya.label, by: 'laya' } : { status: 'review', by: 'model' };
    } else verdict = { status: 'review', by: 'model' };
  }
  // not_ready is never recorded as a final status: the step stays not-run until the agent waits and re-runs.
  if (verdict.status !== 'not_ready') s.status = verdict.status;
  s.verdict = { by: verdict.by, laya: laya ? { label: laya.label, p: Number((laya.p ?? 0).toFixed(3)) } : null,
    review: verdict.status === 'review', rule: { quoted: frags, found: obs.found, loading: obs.loading, errorSeen }, observed };
  log({ expected: s.expected, observed, url: obs.url, rule: s.verdict.rule, laya: laya?.probabilities ?? null, decided: verdict });
  shownStatus = verdict.status;
}

const RANK = { fail: 5, review: 4, blocked: 3, skipped: 2, 'not-run': 1, pass: 0 };
c.status = c.steps.map((x) => x.status ?? 'not-run').reduce((w, v) => ((RANK[v] ?? 1) > (RANK[w] ?? 1) ? v : w), 'pass');
fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');

const left = results.cases.flatMap((x) => x.steps || []).filter((x) => (x.status ?? 'not-run') === 'not-run').length;
const v = s.verdict;
const parts = [`oracle=${statusArg ? s.status : shownStatus}`, `by=${v.by}`, `p=${v.laya?.p ?? '-'}`, `review=${!!v.review}`];
if (v.override) parts.push('override=true');
parts.push(`case=${caseId}:${c.status}`, `remaining-not-run=${left}`);
if (!statusArg) parts.push(`laya=${layaOn ? 'on' : 'off'}`);
console.log(parts.join(' '));
if (!statusArg && shownStatus === 'not_ready') console.log('→ page still loading: wait, then run oracle.mjs again');
if (!statusArg && shownStatus === 'review') console.log(`→ judge it yourself: node oracle.mjs "${runDir}" ${caseId} ${stepN} --status <pass|fail|blocked|skipped>`);
