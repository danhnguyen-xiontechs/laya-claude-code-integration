// Story 2272 AC2: a failed attempt is recorded with a normalized fingerprint, a category and progress vs the
// previous attempt of the same kind; the recovery state text carries them to the existing JEV recovery point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizeFailure, fingerprint, failureCategory, testCounts, failureRecord, recordFailure, repeatedFailures, recoveryState,
} from '../scripts/failure.mjs';
import { advise } from '../scripts/jev_advice.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const node = (...args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').at(-1)) : null };
};

const LOG_A = [
  'TAP version 13',
  '# Subtest: flag works',
  'not ok 1 - flag works',
  '  ---',
  '  duration_ms: 12.345',
  '  location: \'C:\\Users\\ann\\repo\\test\\a.test.mjs:12:5\'',
  '  failureType: \'testCodeFailure\'',
  '  error: \'Expected values to be strictly equal: 2 !== 3\'',
  '  code: \'ERR_ASSERTION\'',
  '  stack: |-',
  '    at TestContext.<anonymous> (file:///C:/Users/ann/repo/test/a.test.mjs:12:5)',
  '  at: 2026-10-23T14:12:09.123Z',
  '1..1',
  '# tests 3',
  '# pass 2',
  '# fail 1',
  '# duration_ms 95.1',
].join('\n');
const LOG_B = LOG_A
  .replace(/C:\\Users\\ann\\repo/g, '/home/bob/work/other-repo').replace(/file:\/\/\/C:\/Users\/ann\/repo/g, 'file:///home/bob/work/other-repo')
  .replace(/:12:5/g, ':40:17').replace('12.345', '7.1').replace('2026-10-23T14:12:09.123Z', '2026-11-01T09:00:00Z')
  .replace('# duration_ms 95.1', '# duration_ms 300.9').replace('/', '\\');
const LOG_OTHER = LOG_A.replace('2 !== 3', '"a" !== "b"').replace('# pass 2', '# pass 1').replace('# fail 1', '# fail 2');

function runDir(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac2-'));
  fs.mkdirSync(path.join(dir, 'evidence'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'ac2', attempts: [], ...extra }));
  return dir;
}
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('2272 AC2 record: a failure record has fingerprint, category, counts and progress "first"', () => {
  const r = failureRecord({ kind: 'test', attempt: 'T1', text: LOG_A });
  assert.equal(r.kind, 'test');
  assert.equal(r.stage, '04-test');
  assert.equal(r.attempt, 'T1');
  assert.match(r.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(r.category, 'assertion');
  assert.deepEqual([r.passed, r.failed, r.progress, r.repeatCount], [2, 1, 'first', 1]);
});

test('2272 AC2 record: progress vs the previous attempt of the same kind', () => {
  const m = {};
  recordFailure(m, { kind: 'test', attempt: 'T1', text: LOG_A });
  assert.equal(recordFailure(m, { kind: 'test', attempt: 'T2', text: LOG_OTHER }).progress, 'regressed');
  assert.equal(recordFailure(m, { kind: 'test', attempt: 'sonnet-retry', text: LOG_A }).progress, 'improved');
  assert.equal(recordFailure(m, { kind: 'test', attempt: 'T3', text: 'Error: boom', failed: 1 }).progress, 'changed');
  // Another kind does not count as the previous attempt.
  assert.equal(recordFailure(m, { kind: 'plan', attempt: 1, text: 'empty output' }).progress, 'first');
  assert.equal(recordFailure(m, { kind: 'plan', attempt: 2, text: 'empty output' }).progress, 'none');
  assert.equal(m.failures.length, 6);
});

test('2272 AC2 record: categories for test and hand-back failures', () => {
  assert.equal(failureCategory('test timed out after 3000 ms'), 'timeout');
  assert.equal(failureCategory('Error: spawn npx ENOENT'), 'environment');
  assert.equal(failureCategory('SyntaxError: Unexpected token }'), 'syntax');
  assert.equal(failureCategory("Error [ERR_MODULE_NOT_FOUND]: Cannot find module './x.mjs'"), 'missing-file');
  assert.equal(failureCategory("TypeError: Cannot read properties of undefined (reading 'a')"), 'runtime');
  assert.equal(failureCategory(LOG_A), 'assertion');
  assert.equal(failureCategory('???'), 'unknown');
  assert.equal(failureCategory('empty output', 'plan'), 'handback-empty');
  assert.equal(failureCategory('', 'review'), 'handback-empty');
  assert.equal(failureCategory('missing heading: Red Checks', 'plan'), 'handback-format');
  assert.equal(failureCategory('not parseable JSON', 'review'), 'handback-format');
  assert.equal(failureCategory('over 800 words (950)', 'review'), 'handback-oversize');
  assert.deepEqual(testCounts('ℹ tests 3\nℹ pass 2\nℹ fail 1\n'), { passed: 2, failed: 1 });
  assert.deepEqual(testCounts('pass 3 fail 0'), { passed: 3, failed: 0 });
  assert.deepEqual(testCounts('no counts here'), { passed: null, failed: null });
});

test('2272 AC2 record: status.mjs record fail stores counts on the attempt and appends manifest.failures', () => {
  const dir = runDir();
  fs.writeFileSync(path.join(dir, 'evidence', 'unit-tests.log'), LOG_A);
  const r1 = node(path.join(SCRIPTS, 'status.mjs'), dir, 'record', 'fail');
  assert.equal(r1.code, 0);
  assert.equal(r1.json.recorded, 'T1');
  assert.equal(r1.json.failure.category, 'assertion');
  assert.equal(r1.json.failure.progress, 'first');
  const other = path.join(dir, 'other.log');
  fs.writeFileSync(other, LOG_B);
  const r2 = node(path.join(SCRIPTS, 'status.mjs'), dir, 'record', 'fail', '--log', other);
  assert.equal(r2.json.failure.progress, 'none');
  assert.equal(r2.json.failure.repeatCount, 2);
  fs.writeFileSync(path.join(dir, 'evidence', 'unit-tests.log'), 'ℹ pass 3\nℹ fail 0\n');
  const r3 = node(path.join(SCRIPTS, 'status.mjs'), dir, 'record', 'pass');
  assert.equal(r3.json.failure, undefined);
  const m = manifest(dir);
  assert.deepEqual(m.attempts.map((a) => [a.attempt, a.ok, a.passed, a.failed]), [['T1', false, 2, 1], ['T2', false, 2, 1], ['sonnet-retry', true, 3, 0]]);
  assert.equal(m.failures.length, 2);
  assert.equal(m.failures[0].fingerprint, m.failures[1].fingerprint);
  // No log: the attempt is recorded without invented counts.
  const bare = runDir();
  node(path.join(SCRIPTS, 'status.mjs'), bare, 'record', 'fail');
  const a = manifest(bare).attempts[0];
  assert.equal('passed' in a, false);
  assert.equal(manifest(bare).failures[0].failed, null);
});

test('2272 AC2 record: the recovery state text carries fingerprint, category and progress to JEV --state', async () => {
  const m = {};
  recordFailure(m, { kind: 'test', attempt: 'T1', text: LOG_A });
  const last = recordFailure(m, { kind: 'test', attempt: 'T2', text: LOG_B });
  const state = recoveryState(m.failures);
  assert.ok(state.includes(last.fingerprint));
  assert.match(state, /category assertion/);
  assert.match(state, /progress none/);
  assert.match(state, /seen 2x/);
  assert.match(state, /repeated: [0-9a-f]{16} x2/);
  assert.equal(recoveryState([]), 'no failure recorded');
  // The existing advise() is unchanged: it simply receives this state (one call, the recovery point).
  const seen = [];
  const r = await advise({ point: 'recovery', baseline: 'fix-code', choices: ['fix-code', 'fix-test', 'rewrite'], state, env: { HAIKU_BUILD_JEV: 'apply' }, ask: async (q) => { seen.push(q.state); return { label: 'fix-test', confidence: 0.9 }; } });
  assert.equal(r.choice, 'fix-test');
  assert.deepEqual(seen, [state]);
});

test('2272 AC2 record: failure.mjs CLI record and state', () => {
  const dir = runDir();
  const log = path.join(dir, 'plan.txt');
  fs.writeFileSync(log, 'missing heading: Verification');
  const r = node(path.join(SCRIPTS, 'failure.mjs'), 'record', dir, 'plan', '1', log);
  assert.equal(r.code, 0);
  assert.deepEqual([r.json.kind, r.json.stage, r.json.category, r.json.progress], ['plan', '02-plan', 'handback-format', 'first']);
  const s = node(path.join(SCRIPTS, 'failure.mjs'), 'state', dir);
  assert.match(s.json.state, /last plan failure 1 \(02-plan\): category handback-format/);
  assert.equal(manifest(dir).failures.length, 1);
  assert.equal(spawnSync(process.execPath, [path.join(SCRIPTS, 'failure.mjs'), 'record', dir, 'bogus', '1', log]).status, 2);
});

test('2272 AC2 fingerprint: same failure with other paths, line numbers, timestamps and durations hashes the same', () => {
  assert.notEqual(LOG_A, LOG_B);
  assert.equal(fingerprint(LOG_A), fingerprint(LOG_B));
  const prev = [failureRecord({ kind: 'test', attempt: 'T1', text: LOG_A })];
  const r = failureRecord({ kind: 'test', attempt: 'T2', text: LOG_B }, prev);
  assert.equal(r.progress, 'none');
  assert.equal(r.repeatCount, 2);
  assert.equal(repeatedFailures([...prev, r]).length, 1);
});

test('2272 AC2 fingerprint: normalization details and a different failure', () => {
  assert.equal(normalizeFailure('at C:\\a\\b\\x.mjs:12:5'), 'at x.mjs:<n>');
  assert.equal(normalizeFailure('at /home/u/p/x.mjs:7:1'), 'at x.mjs:<n>');
  assert.equal(normalizeFailure('file:///D:/r/x.mjs:3'), 'x.mjs:<n>');
  assert.equal(normalizeFailure('failed at line 42 after 12.3ms'), 'failed at line <n> after <dur>');
  assert.equal(normalizeFailure('2026-10-23T14:12:09Z 10:11:12 id 0f3a9c2e77b1'), '<time> <time> id <hex>');
  assert.equal(normalizeFailure('run 123e4567-e89b-12d3-a456-426614174000'), 'run <uuid>');
  assert.notEqual(fingerprint(LOG_A), fingerprint(LOG_OTHER));
  // node:test summary lines alone do not change the fingerprint.
  assert.equal(fingerprint(LOG_A), fingerprint(LOG_A.replace('# pass 2', '# pass 7')));
  // No failure line: every line counts.
  assert.notEqual(fingerprint('build stopped\nstep 2'), fingerprint('build stopped\nstep 3'));
});
