// Builds eval/data/{gate,verdict,oracle,wait}.json. Deterministic: same inputs → same files.
//   gate    : idea/web-test/gate/samples.json (dev, the rule was tuned on it) + heldout.json (24, written after the freeze)
//   verdict : 20 REAL steps from ess-test-runs/*/results.json (truth = the status the tester agent recorded)
//             + 8 hand-mutated "fail" copies of real steps + 8 "blocked" copies (actual replaced by an environment error)
//             + hand-written ESS steps (eval/data/handwritten.mjs)
//   oracle  : the verdict items as observations, plus 8 hand-written not_ready observations
//   wait    : hand-written page snapshots, clean and with the real (generic) ESS navigation text in front
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERDICT_HW, ORACLE_NOT_READY, WAIT_HW } from './handwritten.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const write = (name, v) => fs.writeFileSync(path.join(here, name), JSON.stringify(v, null, 1) + '\n');

// ---- gate
const gate = [
  ...read('idea/web-test/gate/samples.json').map(([text, w], i) => ({ id: `dev-${i + 1}`, set: 'dev', text, truth: w ? 'write' : 'read' })),
  ...read('idea/web-test/gate/heldout.json').map(([text, w], i) => ({ id: `held-${i + 1}`, set: 'heldout', text, truth: w ? 'write' : 'read' })),
];
write('gate.json', gate);

// ---- verdict
const real = [];
for (const d of fs.readdirSync(path.join(root, 'ess-test-runs')).sort()) {
  const r = read(`ess-test-runs/${d}/results.json`);
  for (const c of r.cases) for (const s of c.steps || []) {
    if (!s.expected || !['pass', 'fail', 'blocked'].includes(s.status)) continue;
    real.push({ id: `real-${d.split('-')[0]}-${d.split('-').slice(-2).join('')}-${c.id}-S${s.n}`, set: 'real', expected: s.expected, actual: s.actual ?? '', truth: s.status,
      historicLaya: s.verdict?.laya ?? null });
  }
}
// hand mutations of REAL passing steps: the actual now contradicts the expected (by construction → fail)
const MUT_FAIL = [
  ['Toolbar shows Scheduled/Total/Absence hours for June 2026, not the week-only values', 'Month view, June 2026: Scheduled hours: 40 / Total hours: 0 / Absence hours: 32 (same as the week view 5-11 Oct)'],
  ['Total hours equals the TC01 value (no 0 vs 55 flip)', 'Next month: July 2026 Scheduled hours: 184, Total hours: 0. Back to June 2026: Scheduled hours: 160, Total hours: 55, Absence hours: 105'],
  ['Same Total Hours value as step 1', 'Round trip Jun->Jul->Aug->Jul->Jun: June 2026 first visit Scheduled 160 / Total 0 / Absence 160; second visit Total 55'],
  ["Month view shows 'October 2026' and 'Scheduled hours: 176' (whole month, not the week's 40)", 'October 2026 | Scheduled hours: 40'],
  ["Header 'June 2026' with 'Scheduled hours: 160' and 'Total hours: 0', identical every time", 'June 2026 | Scheduled hours: 160 | Total hours: 55'],
  ['Attendance page loads for the signed-in employee', 'Attendance page shows a blank white screen; console error TypeError: Cannot read properties of undefined'],
  ['Date is not labelled Approved Leave', "Attendance week 23–29 Mar: 'Tue 24/03 · Casual leave · Approved'"],
  ['Date still labelled Approved Leave', "Week 23–29 Mar: 'Mon 23/03 · No records', 'Wed 25/03 · Casual leave · Approved'"],
];
const ENV = [
  "Redirected to Microsoft sign-in 'Pick an account'; the page could not be reached with this session.",
  'Page stayed on skeleton placeholders for 30 s and the API returned 503; nothing could be read.',
  'Test data missing for this account, so the scenario cannot be set up on this environment.',
];
const passReal = real.filter((r) => r.truth === 'pass');
const mutFail = MUT_FAIL.map(([expected, actual], i) => ({ id: `mut-fail-${i + 1}`, set: 'mut-fail', expected, actual, truth: 'fail' }));
const mutBlocked = passReal.slice(0, 8).map((r, i) => ({ id: `mut-blocked-${i + 1}`, set: 'mut-blocked', expected: r.expected, actual: ENV[i % ENV.length], truth: 'blocked' }));
const hw = VERDICT_HW.map(([expected, actual, truth], i) => ({ id: `hw-${i + 1}`, set: 'hw', expected, actual, truth }));
const verdict = [...real, ...mutFail, ...mutBlocked, ...hw];
write('verdict.json', verdict);

// ---- oracle: the same steps seen as a compact observation; not_ready added
const oracle = [
  ...verdict.map((v) => ({ id: v.id, set: v.set, expected: v.expected, observed: v.actual ? [v.actual] : [], url: '/attendance', loading: false, truth: v.truth === 'blocked' ? 'not-pass' : v.truth })),
  ...ORACLE_NOT_READY.map(([expected, observed, loading], i) => ({ id: `nr-${i + 1}`, set: 'not-ready', expected, observed, url: '/page', loading, truth: 'not_ready' })),
];
write('oracle.json', oracle);

// ---- wait
const NAV = 'ESS System Skills & performance My work Remuneration My organisation 10 Skills & performance My work Remuneration My organisation Home Attendance Attendance My attendance Team attendance Attendance shortage Overtime Request attendance regularization ';
const wait = [];
for (const [id, p, title, loading, text, truth] of WAIT_HW) {
  wait.push({ id, set: 'clean', url: `https://ess.example.test${p}`, title, loading, text, truth });
  if (!truth.login && truth.state !== 'error') wait.push({ id: `${id}+nav`, set: 'with-nav', url: `https://ess.example.test${p}`, title, loading, text: NAV + text, truth });
}
write('wait.json', wait);

console.log(JSON.stringify({ gate: gate.length, verdict: verdict.length, verdictBySet: Object.fromEntries(['real', 'mut-fail', 'mut-blocked', 'hw'].map((s) => [s, verdict.filter((v) => v.set === s).length])),
  verdictTruth: verdict.reduce((a, v) => ((a[v.truth] = (a[v.truth] || 0) + 1), a), {}), oracle: oracle.length, wait: wait.length }));
