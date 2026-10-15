// Plan 1 — wait for an ESS page to settle, in ONE tool call instead of a wait_for/snapshot loop.
// Attaches read-only to the browser on port 9222 (same one chrome-devtools MCP uses), polls the
// visible text every 500 ms, and returns a single line when the page is ready, is a sign-in page,
// shows an error, or the timeout elapses. Laya (optional) classifies the text; without it the
// script uses rules only (expected text present + no spinner/skeleton).
//
// Usage: node wait.mjs [--url "<route or URL of the page under test>"] [--expect "<text>"] [--timeout 20] [--shot <file.png>] [--cdp http://127.0.0.1:9222] [--json] [--log <file.jsonl>]
// Output (one line): status=ready|login|error|timeout screen=<id> login=<bool> expect=found|missing|- waited=<s> laya=on|idle|off [laya_p=…]
//   laya=on → Laya was consulted for this verdict; idle → reachable but rules alone decided; off → disabled/unreachable.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { selectPage } from './page-select.mjs';
import { loadConfig, alive, ask } from './laya-lib.mjs';

// ---- args
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
const EXPECT = opt('--expect', null);
const URL_WANT = opt('--url', null); // which tab: see page-select.mjs (hidden tabs ignored, ambiguity is an error)
const TIMEOUT = Number(opt('--timeout', 20)) * 1000;
const SHOT = opt('--shot', null);
const CDP = opt('--cdp', 'http://127.0.0.1:9222');
const JSON_OUT = argv.includes('--json');
const POLL = 500;
const MAX_CHARS = 1500;
const LAYA_MIN_P = 0.6; // below this a Laya answer is ignored and rules alone decide
const STABLE_MS = 3000; // page text unchanged this long before Laya is consulted
const LOG = opt('--log', path.join(process.env.USERPROFILE || process.env.HOME || '.', '.ess-web-test', 'wait-log.jsonl'));

// ---- ESS screens (from ess-fe routes). Keep ≤ 15; `unknown` catches the rest.
const SCREENS = {
  'home': 'ESS home / dashboard with tiles for the main sections',
  'profile': 'Employee profile: personal details, contact info, address, dependents, education, identification',
  'time-off': 'Leave / time-off: balances, leave requests list or a new leave request form',
  'attendance': 'Attendance: my attendance or team attendance calendar, schedule, holidays',
  'payslips': 'Payslips list or a payslip detail',
  'hr-request': 'HR request: list of HR requests or a new HR request form',
  'approvals': 'Approvals / approval delegation: pending requests for a manager to approve or reject',
  'employment': 'Employment: probation review, questionnaires, calibration views',
  'courses': 'Courses / course calendar / learning',
  'login': 'Microsoft sign-in page: email or password prompt, account picker, MFA / verify your identity',
  'error': 'Error page or a global error message such as Something went wrong, Access denied, 404 Not found',
  'unknown': 'None of the above',
};
const LOGIN_RE = /sign in to your account|pick an account|enter password|approve sign in request|verify your identity|stay signed in\?|login\.microsoftonline/i;
const ERROR_RE = /something went wrong|access denied|unauthori[sz]ed|not found|an error occurred|failed to load/i;
const ROUTE_HINTS = [['/time-off', 'time-off'], ['/attendance', 'attendance'], ['/payslips', 'payslips'], ['/hr-request', 'hr-request'],
  ['approval', 'approvals'], ['/employment', 'employment'], ['/courses', 'courses'], ['/profile', 'profile'], ['login.microsoftonline', 'login']];

// ---- playwright-core: local install, else the copy that ships with the global playwright-cli
function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const appdata = process.env.APPDATA || '';
  const candidates = ['playwright-core', 'playwright',
    path.join(appdata, 'npm', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(appdata, 'npm', 'node_modules', 'playwright-core')];
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  throw new Error('playwright-core not found: npm i -g playwright-core, or install playwright-cli');
}

// ---- page probe: a few hundred chars of text + loading indicators, never the DOM
const PROBE = `(() => {
  const loading = document.querySelectorAll('[class*="skeleton" i],[class*="spinner" i],[class*="loading" i],[aria-busy="true"],[role="progressbar"]').length;
  const text = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim();
  return { url: location.href, title: document.title, loading, text };
})()`;

function routeScreen(url) { const u = (url || '').toLowerCase(); for (const [k, v] of ROUTE_HINTS) if (u.includes(k)) return v; return null; }

async function classify(cfg, layaOn, probe, stableMs) {
  const text = probe.text.slice(0, MAX_CHARS);
  const rule = {
    login: LOGIN_RE.test(text) || LOGIN_RE.test(probe.url),
    error: ERROR_RE.test(text),
    loading: probe.loading > 0 || text.length < 20,
    expect: EXPECT ? text.toLowerCase().includes(EXPECT.toLowerCase()) : null,
    screen: routeScreen(probe.url),
  };
  // Rules first; Laya (~2 s per call on CPU) only when they cannot conclude AND the page text has stopped
  // changing for a while — i.e. it is not merely still loading. Keeps the common path at 500 ms polls.
  // A visible spinner/skeleton is loading, full stop — Laya is only asked about a page that looks finished but isn't what we expected.
  const conclusive = rule.login || rule.error || rule.loading || (EXPECT && rule.expect);
  if (!layaOn || conclusive || stableMs < STABLE_MS) return { ...rule, source: 'rule' };
  const ans = await ask(cfg, { url: probe.url, title: probe.title, loading_indicators: probe.loading, page_text: text }, {
    state: { type: 'choice', instructions: 'Has this web page finished loading its content?',
      criteria: { ready: 'Yes: real content (tables, forms, numbers, names) is visible and no loading placeholders remain.',
        loading: 'No: the page is still loading — skeletons, spinners, empty tables, or only a shell/header is visible.',
        error: 'No: the page shows an error instead of content.' } },
    screen: { type: 'choice', instructions: 'Which ESS screen is this page?', criteria: SCREENS },
    login: { type: 'choice', instructions: 'Is this a Microsoft sign-in / MFA page rather than the application?',
      criteria: { true: 'Yes, a sign-in, account picker, password or MFA page.', false: 'No, the application itself.' } },
  });
  if (!ans) return { ...rule, source: 'rule', layaFailed: true };
  const sure = (a) => (a.p ?? 0) >= LAYA_MIN_P;
  // Rules decide readiness whenever --expect is given (expected text + no spinner = ready, whatever Laya thinks).
  // Laya adds: login/error detection beyond the regexes, the screen id, and readiness when there is no --expect.
  const layaLoading = ans.state.label === 'loading' && sure(ans.state);
  return {
    login: rule.login || (ans.login.label === 'true' && sure(ans.login)),
    error: rule.error || (ans.state.label === 'error' && sure(ans.state)),
    loading: EXPECT ? rule.loading : layaLoading, // rule.loading is false here (see `conclusive`)
    expect: rule.expect,
    screen: rule.screen || (ans.screen.label !== 'unknown' && sure(ans.screen) ? ans.screen.label : null),
    source: 'laya', p: { state: ans.state.p, screen: ans.screen.p, login: ans.login.p },
    laya: { state: ans.state.label, screen: ans.screen.label, login: ans.login.label }, rule,
  };
}

// Every poll is appended here (text excerpt + rule view + Laya view) so Laya can be scored offline later.
function logPoll(probe, c) {
  if (!LOG) return;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), url: probe.url, title: probe.title, loading_indicators: probe.loading,
      text: probe.text.slice(0, MAX_CHARS), expect: EXPECT, rule: c.rule ?? { login: c.login, error: c.error, loading: c.loading, expect: c.expect, screen: c.screen },
      laya: c.laya ?? null, p: c.p ?? null }) + '\n');
  } catch { /* logging never breaks a run */ }
}

// ---- main
const t0 = Date.now();
const cfg = loadConfig();
const layaOn = cfg.enabled !== false && (await alive(cfg.url));
const pw = loadPlaywright();
let browser;
try { browser = await pw.chromium.connectOverCDP(CDP, { timeout: 5000 }); }
catch (e) { console.log(`status=error reason=no-browser cdp=${CDP} detail=${e.message.split('\n')[0]}`); process.exitCode = 1; }

// The page under test, never just the first tab: the role browser can hold hidden tabs the MCP does not list.
// With --url, a tab that has not reached the route yet is waited for (within --timeout); ambiguity fails at once.
let page = null, pickedBy = null;
if (browser) {
  let pick;
  for (;;) {
    pick = await selectPage(browser, { url: URL_WANT });
    if (!pick.error || !pick.error.startsWith('no-match') || Date.now() - t0 >= TIMEOUT) break;
    await new Promise((r) => setTimeout(r, POLL));
  }
  if (pick.error) { console.log(`status=error reason=${pick.error}`); await browser.close().catch(() => {}); process.exitCode = 1; }
  else { page = pick.page; pickedBy = pick.reason; }
}
if (page) await run();

async function run() {

let last = null, verdict = 'timeout', lastErr = null, lastText = null, stableSince = Date.now();
while (Date.now() - t0 < TIMEOUT) {
  let probe;
  try { probe = await page.evaluate(PROBE); }
  catch (e) { lastErr = e.message.split('\n')[0]; await new Promise((r) => setTimeout(r, POLL)); continue; } // mid-navigation
  const key = `${probe.url}|${probe.loading}|${probe.text}`;
  if (key !== lastText) { lastText = key; stableSince = Date.now(); }
  last = await classify(cfg, layaOn, probe, Date.now() - stableSince);
  logPoll(probe, last);
  if (last.login) { verdict = 'login'; break; }
  if (last.error) { verdict = 'error'; break; }
  const settled = !last.loading && (EXPECT ? last.expect : true);
  if (settled) { verdict = 'ready'; break; }
  await new Promise((r) => setTimeout(r, POLL));
}

// Screen id is cheap to ask once at the end when neither the route nor an earlier Laya call gave it.
if (layaOn && last && !last.screen && verdict !== 'timeout') {
  try {
    const probe = await page.evaluate(PROBE);
    const ans = await ask(cfg, { url: probe.url, title: probe.title, page_text: probe.text.slice(0, MAX_CHARS) },
      { screen: { type: 'choice', instructions: 'Which ESS screen is this page?', criteria: SCREENS } });
    if (ans && ans.screen.label !== 'unknown' && (ans.screen.p ?? 0) >= LAYA_MIN_P) { last.screen = ans.screen.label; last.p = { ...(last.p || {}), screen: ans.screen.p }; last.source = 'laya'; }
  } catch { /* optional */ }
}

let shot = null;
if (SHOT && verdict !== 'timeout') {
  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  try { await page.screenshot({ path: SHOT, fullPage: false, timeout: 8000 }); shot = SHOT; }
  catch (e) {
    // Playwright's screenshot waits for fonts/animations and can hang on a background window; raw CDP does not.
    try {
      const cdp = await page.context().newCDPSession(page);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(SHOT, Buffer.from(data, 'base64')); shot = SHOT; await cdp.detach().catch(() => {});
    } catch (e2) { lastErr = `screenshot: ${e.message.split('\n')[0]} / cdp: ${e2.message.split('\n')[0]}`; }
  }
}
await browser.close().catch(() => {}); // disconnects only; the browser keeps running

const waited = ((Date.now() - t0) / 1000).toFixed(1);
const out = {
  status: verdict, screen: last?.screen ?? 'unknown', login: !!last?.login,
  expect: EXPECT ? (last?.expect ? 'found' : 'missing') : '-', waited: Number(waited),
  laya: !layaOn ? 'off' : (last?.source === 'laya' ? 'on' : 'idle'), // on = consulted, idle = available but rules sufficed
  laya_p: last?.p ?? null, shot, url: page.url(), tab: pickedBy, note: lastErr,
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  const parts = [`status=${out.status}`, `screen=${out.screen}`, `login=${out.login}`, `expect=${out.expect}`, `waited=${waited}s`, `laya=${out.laya}`];
  if (out.laya_p) parts.push(`laya_p=${Object.entries(out.laya_p).map(([k, v]) => `${k}:${(v ?? 0).toFixed(2)}`).join(',')}`);
  parts.push(`url=${out.url}`, `tab=${out.tab}`);
  if (shot) parts.push(`shot=${shot}`);
  if (lastErr) parts.push(`note="${lastErr}"`);
  console.log(parts.join(' '));
}
process.exitCode = verdict === 'ready' ? 0 : 1; // not process.exit(): Node 24 + CDP transport asserts in libuv on a hard exit
}
