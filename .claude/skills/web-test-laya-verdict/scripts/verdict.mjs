// Plan 2 — per-step verdict with confidence. Replaces record.mjs in this skill: the agent writes what the page
// showed (`actual`), Laya compares it with the step's planned `expected` and picks pass / fail / blocked.
//
//   Laya p ≥ 0.85        → status = Laya's label, verdictBy "laya"
//   0.60 ≤ p < 0.85      → status = Laya's label, verdictBy "laya", review: true (the report flags it)
//   p < 0.60 / Laya off  → status "review": the agent must judge and call again with --status … (verdictBy "model")
//
// Usage:
//   node verdict.mjs <runDir> <caseId> <stepN> --actual "<page text, quoted>" [--shot shots/TC01-S01.png]
//   node verdict.mjs <runDir> <caseId> <stepN> --status <pass|fail|blocked|skipped> [--reason "<why>"]
//        after verdict=review: the agent's own verdict (verdictBy "model")
//        after Laya decided:   an override of Laya — --reason is required (override: true)
// Prints one line: verdict=<status> by=<laya|model> p=<0.00> review=<bool> [override=true] case=<id>:<status> remaining-not-run=N laya=on|off
// Every Laya call is appended to ~/.ess-web-test/verdict-log.jsonl (expected, actual, Laya view) for offline scoring.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, alive, ask } from './laya-lib.mjs';

const HIGH = 0.85, LOW = 0.6;
const STATUSES = ['pass', 'fail', 'blocked', 'skipped'];
const [runDir, caseId, stepN, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i === -1 ? undefined : rest[i + 1]; };
const actualArg = opt('--actual'), statusArg = opt('--status'), reason = opt('--reason'), shot = opt('--shot');
if (!runDir || !caseId || !stepN || (actualArg === undefined && !statusArg) || (statusArg && !STATUSES.includes(statusArg))) {
  console.error('Usage: node verdict.mjs <runDir> <caseId> <stepN> --actual "<text>" [--shot <file>]\n' +
    '       node verdict.mjs <runDir> <caseId> <stepN> --status <pass|fail|blocked|skipped> [--reason "<why>"]');
  process.exit(2);
}

const file = path.join(runDir, 'results.json');
const results = JSON.parse(fs.readFileSync(file, 'utf8'));
const c = (results.cases || []).find((x) => x.id === caseId);
const s = c?.steps?.find((x) => String(x.n) === String(stepN));
if (!s) { console.error(`no step ${caseId}-S${stepN} in ${file}`); process.exit(2); }

if (actualArg !== undefined) s.actual = actualArg;
if (shot !== undefined) s.screenshot = shot;
s.at ??= new Date().toISOString();

const QUESTION = {
  type: 'choice',
  instructions: 'A manual web test step. Compare the actual result with the expected result. What is the verdict?',
  criteria: {
    pass: 'The actual result shows what the expected result describes.',
    fail: 'The actual result differs from the expected result: wrong value, wrong message, an error, or something missing.',
    blocked: 'The step could not be checked: page did not load, sign-in needed, test data missing, or an environment error.',
  },
};

let layaOn = false;
if (statusArg) {
  // Agent's verdict: either resolving a "review" step or overriding Laya.
  const v = s.verdict || {};
  const layaDecided = v.by === 'laya';
  if (layaDecided && statusArg !== s.status) {
    if (!reason) { console.error('overriding Laya needs --reason "<why>"'); process.exit(2); }
    s.verdict = { ...v, by: 'model', override: true, reason };
  } else if (layaDecided) {
    s.verdict = { ...v, confirmed: true, ...(reason ? { reason } : {}) }; // agent re-checked a review step and agrees
  } else {
    s.verdict = { ...v, by: 'model', review: false, ...(reason ? { reason } : {}) };
  }
  s.status = statusArg;
} else {
  const cfg = loadConfig();
  let a = null;
  if (cfg.enabled !== false && (await alive(cfg.url))) {
    layaOn = true;
    a = (await ask(cfg, { expected: s.expected ?? '', actual: s.actual ?? '' }, { verdict: QUESTION }, { maxLen: 512 }))?.verdict ?? null;
  }
  if (a) {
    const p = a.p ?? 0;
    s.verdict = { by: p >= LOW ? 'laya' : 'model', laya: { label: a.label, p: Number(p.toFixed(3)) }, review: p < HIGH };
    s.status = p >= LOW ? a.label : 'review';
    try {
      const logDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.ess-web-test');
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(path.join(logDir, 'verdict-log.jsonl'), JSON.stringify({
        t: new Date().toISOString(), run: path.basename(path.resolve(runDir)), step: `${caseId}-S${stepN}`,
        expected: s.expected, actual: s.actual, laya: a.probabilities }) + '\n');
    } catch { /* logging is best-effort */ }
  } else {
    s.verdict = { by: 'model', laya: null, review: true };
    s.status = 'review';
  }
}

const RANK = { fail: 5, review: 4, blocked: 3, skipped: 2, 'not-run': 1, pass: 0 };
c.status = c.steps.map((x) => x.status ?? 'not-run').reduce((w, v) => ((RANK[v] ?? 1) > (RANK[w] ?? 1) ? v : w), 'pass');
fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');

const all = results.cases.flatMap((x) => x.steps || []);
const left = all.filter((x) => (x.status ?? 'not-run') === 'not-run').length;
const v = s.verdict;
const parts = [`verdict=${s.status}`, `by=${v.by}`, `p=${v.laya?.p ?? '-'}`, `review=${!!v.review}`];
if (v.override) parts.push('override=true');
parts.push(`case=${caseId}:${c.status}`, `remaining-not-run=${left}`);
if (!statusArg) parts.push(`laya=${layaOn ? 'on' : 'off'}`);
console.log(parts.join(' '));
if (s.status === 'review') console.log(`→ judge it yourself: node verdict.mjs "${runDir}" ${caseId} ${stepN} --status <pass|fail|blocked|skipped>`);
