#!/usr/bin/env node
// Retry ladder and final status of a v2 run. Test attempts (stage 04-test) follow one ladder: T1 (Haiku),
// T2 (Haiku), one Sonnet retry (03-implement's one Sonnet fallback), T3 (Haiku, final verification run).
// A failure after T3 makes the run `blocked` and refuses any further retry. The final status (stage
// 07-present) takes no JEV input: blocked if a required artifact is missing or tests still fail, else
// done_with_findings if a finding is open, else done.
//
// Usage: node status.mjs <runDir> next              prints the next ladder attempt (exit 1 when refused)
//        node status.mjs <runDir> record pass|fail [--log <file>]
//                                                   records the next ladder attempt in manifest.attempts
//                                                   (exit 1 when that record uses up the ladder: a failed T3);
//                                                   v3: the attempt gets `passed` / `failed` parsed from the
//                                                   log (default evidence/unit-tests.log) when parseable, and
//                                                   a `fail` appends a failure record (failure.mjs) to
//                                                   manifest.failures
//        node status.mjs <runDir> final             writes manifest.finalStatus (exit 1 when blocked)
//   Prints one JSON line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCounts, recordFailure } from './failure.mjs';

/** Files every finished run must have, relative to the run folder. A missing one is a failure. */
export const REQUIRED_ARTIFACTS = [
  'manifest.json',
  'spec.md',
  'evidence/diff.patch',
  'evidence/unit-tests.log',
  'evidence/review.json',
];

export const LADDER = [
  { attempt: 'T1', model: 'haiku' },
  { attempt: 'T2', model: 'haiku' },
  { attempt: 'sonnet-retry', model: 'sonnet' },
  { attempt: 'T3', model: 'haiku' },
];

export const LADDER_TEXT = 'T1 (Haiku), T2 (Haiku), Sonnet retry, T3 (Haiku)';

/**
 * Next attempt from the attempt history ([{ attempt, ok }], in order).
 * Returns { next: { attempt, model } } while the ladder has a rung left, { done: true } after a pass,
 * or { refused: true, status: 'blocked', reason } when every rung failed.
 */
export function nextAttempt(history = []) {
  if (history.some((h) => h.ok)) return { done: true, next: null };
  if (history.length >= LADDER.length) {
    return { refused: true, next: null, status: 'blocked', reason: `retry ladder used up: ${LADDER_TEXT} all failed` };
  }
  return { next: { ...LADDER[history.length] } };
}

/** Required artifacts that do not exist in runDir, in REQUIRED_ARTIFACTS order. */
export function missingArtifacts(runDir, required = REQUIRED_ARTIFACTS) {
  return required.filter((rel) => !fs.existsSync(path.join(runDir, rel)));
}

/**
 * Final status of a run. Input: { missing: string[], tests: { failed }, attempts: [{ attempt, ok }],
 * findings: [{ resolution }] }. Any other field (a JEV advice, for instance) is ignored by design.
 * Returns { status: 'blocked' | 'done_with_findings' | 'done', reason }.
 */
export function finalStatus({ missing = [], tests = {}, attempts = [], findings = [] } = {}) {
  if (missing.length) return { status: 'blocked', reason: `missing required artifact: ${missing.join(', ')}` };
  const ladder = nextAttempt(attempts);
  if (ladder.refused) return { status: 'blocked', reason: ladder.reason };
  const lastFailed = attempts.length > 0 && !attempts.at(-1).ok;
  if ((tests.failed ?? 0) > 0 || lastFailed) return { status: 'blocked', reason: 'tests still fail' };
  const open = findings.filter((f) => (f.resolution ?? 'open') === 'open').length;
  if (open) return { status: 'done_with_findings', reason: `${open} finding(s) open` };
  return { status: 'done', reason: null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--log');
  const logArg = li >= 0 ? args.splice(li, 2)[1] : null;
  const [runDir, cmd, result] = args;
  if (!runDir || !['next', 'record', 'final'].includes(cmd) || (cmd === 'record' && !['pass', 'fail'].includes(result))) {
    console.log('usage: node status.mjs <runDir> next | record pass|fail [--log <file>] | final');
    process.exit(2);
  }
  const mf = path.join(runDir, 'manifest.json');
  const m = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  const attempts = m?.attempts ?? [];
  if (cmd === 'final') {
    const r = finalStatus({ missing: missingArtifacts(runDir), tests: m?.tests, attempts, findings: m?.review?.findings });
    if (m) fs.writeFileSync(mf, JSON.stringify({ ...m, finalStatus: r.status, finalReason: r.reason }, null, 2));
    console.log(JSON.stringify(r));
    process.exit(r.status === 'blocked' ? 1 : 0);
  }
  if (!m) { console.log(JSON.stringify({ error: `missing required artifact: manifest.json in ${runDir}` })); process.exit(1); }
  const n = nextAttempt(attempts);
  if (cmd === 'record' && n.next) {
    const logFile = logArg ?? path.join(runDir, 'evidence', 'unit-tests.log');
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const counts = testCounts(log);
    const ok = result === 'pass';
    m.attempts = [...attempts, {
      ...n.next, ok,
      ...(counts.passed != null ? { passed: counts.passed } : {}), ...(counts.failed != null ? { failed: counts.failed } : {}),
      at: new Date().toISOString(),
    }];
    const failure = ok ? null : recordFailure(m, { kind: 'test', stage: '04-test', attempt: n.next.attempt, text: log, ...counts });
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    const after = nextAttempt(m.attempts);
    const f = failure ? { failure: { fingerprint: failure.fingerprint, category: failure.category, progress: failure.progress, repeatCount: failure.repeatCount } } : {};
    console.log(JSON.stringify({ recorded: n.next.attempt, ok, next: after, ...f }));
    process.exit(after.refused ? 1 : 0);
  }
  console.log(JSON.stringify(n));
  process.exit(n.refused || (cmd === 'record' && !n.next) ? 1 : 0);
}
