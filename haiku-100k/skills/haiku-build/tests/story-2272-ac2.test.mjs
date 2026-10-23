// Story 2272 AC2: two failure logs that differ only in paths, timings or line numbers share one fingerprint,
// a repeated failure is reported as repeated, and `status.mjs record fail --log` writes manifest.diagnostics
// while leaving the `next` output unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizeFailure, fingerprint, categorize, parseCounts, recordFailure, recoveryState,
} from '../scripts/diagnostics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', 'scripts');
const DIAG_CLI = path.join(SCRIPTS, 'diagnostics.mjs');
const STATUS_CLI = path.join(SCRIPTS, 'status.mjs');

const LOG_A = [
  'C:\\work\\run\\src\\a.mjs:12:5 AssertionError: expected 3 to equal 4',
  '\u001b[31m  not ok 2 - adds (12.3ms)\u001b[39m',
  '# fail 1',
  'failed at /home/dev/proj/test/a.test.mjs:40:7 duration_ms 45.6',
  'build failed in 1.2s at 2026-10-23T10:11:12.345Z commit 9f8e7d6c5b4a',
].join('\n');

const LOG_B = [
  'C:\\other\\place\\src\\a.mjs:99:1 AssertionError: expected 3 to equal 4',
  '  not ok 2 - adds (98.7ms)',
  '# fail 1',
  'failed at /tmp/elsewhere/test/a.test.mjs:7:2 duration_ms 3.1',
  'build failed in 0.4s at 2027-01-02T03:04:05.000Z commit 0a1b2c3d4e5f',
].join('\n');

const LOG_OTHER = 'SyntaxError: Unexpected token } in module.mjs:3:1\n';

test('2272 AC2 fingerprint: normalizeFailure strips ANSI, paths, line:col, durations, ISO times and hashes', () => {
  const n = normalizeFailure(LOG_A);
  assert.doesNotMatch(n, /\u001b/);
  assert.doesNotMatch(n, /C:\\|\/home\//);
  assert.doesNotMatch(n, /12\.3ms|45\.6|1\.2s/);
  assert.doesNotMatch(n, /2026-10-23T/);
  assert.doesNotMatch(n, /9f8e7d6c5b4a/);
  assert.match(n, /<path>/);
  assert.match(n, /<t>/);
  assert.match(n, /<time>/);
  assert.match(n, /<hash>/);
  assert.match(n, /<n>/);
});

test('2272 AC2 fingerprint: lines with failure markers are kept, deduped and in their original order', () => {
  const log = 'first not ok 1\nnoise line\nnot ok 1\nnot ok 1\nAssertionError: boom\n';
  const lines = normalizeFailure(log).split('\n').filter(Boolean);
  assert.equal(lines.length, new Set(lines).size);
  assert.ok(lines.indexOf(lines.find((l) => /not ok/.test(l))) < lines.indexOf(lines.find((l) => /AssertionError/.test(l))));
  assert.ok(!lines.some((l) => /noise/.test(l)));
});

test('2272 AC2 fingerprint: Windows paths, POSIX paths, :12:5 and duration forms normalize to the same text', () => {
  assert.equal(normalizeFailure('fail at C:\\a\\b.mjs:12:5 (12.3ms)'), normalizeFailure('fail at /x/y/b.mjs:3:9 (4.5ms)'));
  assert.equal(normalizeFailure('took 1.2s and duration_ms 45.6 in not ok'), normalizeFailure('took 9.9s and duration_ms 0.1 in not ok'));
});

test('2272 AC2 fingerprint: two logs differing only in paths, timings and line numbers get one fingerprint', () => {
  assert.equal(fingerprint(LOG_A), fingerprint(LOG_B));
  assert.match(fingerprint(LOG_A), /^[0-9a-f]{12}$/);
});

test('2272 AC2 fingerprint: a different failure gets a different fingerprint', () => {
  assert.notEqual(fingerprint(LOG_A), fingerprint(LOG_OTHER));
});

test('2272 AC2 fingerprint: categorize returns one of the fixed categories', () => {
  assert.equal(categorize('Cannot find module ./x.mjs', { stage: 'test' }), 'missing-module');
  assert.equal(categorize('SyntaxError: Unexpected token', { stage: 'test' }), 'syntax');
  assert.equal(categorize('test timed out after 5000ms', { stage: 'test' }), 'timeout');
  assert.equal(categorize('AssertionError: expected 1', { stage: 'test' }), 'assertion');
  assert.equal(categorize('# fail 2', { stage: 'test' }), 'test-failure');
  assert.equal(categorize('plan too vague', { stage: 'plan' }), 'plan-rejected');
  assert.equal(categorize('review said no', { stage: 'review' }), 'review-rejected');
  assert.equal(categorize('', { stage: 'test' }), 'unknown');
});

test('2272 AC2 fingerprint: parseCounts reads passed and failed, null when neither is present', () => {
  assert.deepEqual(parseCounts('# pass 3\n# fail 1\n'), { passed: 3, failed: 1 });
  assert.equal(parseCounts('nothing useful here'), null);
});

test('2272 AC2 fingerprint: a repeated failure gives progress repeated and repeatCount 2', () => {
  const m = { runId: 'r' };
  const first = recordFailure(m, { stage: 'test', attempt: 'T1', log: LOG_A, at: '2026-10-23T00:00:00.000Z' });
  assert.equal(first.progress, 'first');
  assert.equal(first.repeatCount, 1);
  const second = recordFailure(m, { stage: 'test', attempt: 'T2', log: LOG_B, at: '2026-10-23T00:01:00.000Z' });
  assert.equal(second.progress, 'repeated');
  assert.equal(second.repeatCount, 2);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(m.diagnostics.length, 2);
});

test('2272 AC2 fingerprint: fewer failed tests than the previous attempt of the same stage gives improved', () => {
  const m = {};
  recordFailure(m, { stage: 'test', attempt: 'T1', log: '# pass 1\n# fail 3\n', at: 'x' });
  const e = recordFailure(m, { stage: 'test', attempt: 'T2', log: '# pass 2\n# fail 1\nAssertionError: other\n', at: 'x' });
  assert.equal(e.progress, 'improved');
  assert.equal(e.failed, 1);
});

test('2272 AC2 fingerprint: recoveryState starts with the failed count and names the category, fingerprint and progress', () => {
  const m = {};
  recordFailure(m, { stage: 'test', attempt: 'T1', log: LOG_A, at: 'x' });
  recordFailure(m, { stage: 'test', attempt: 'T2', log: LOG_B, at: 'x' });
  const text = recoveryState(m, 2);
  assert.match(text, /^failed 2/);
  assert.match(text, /assertion/);
  assert.match(text, new RegExp(fingerprint(LOG_A)));
  assert.match(text, /repeated/);
  assert.match(text, /2/);
});

test('2272 AC2 fingerprint CLI: diagnostics.mjs record stage attempt log writes manifest diagnostics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac2-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ runId: 'r' }));
  const logFile = path.join(dir, 'unit.log');
  fs.writeFileSync(logFile, LOG_A);
  const run = spawnSync(process.execPath, [DIAG_CLI, dir, 'record', 'test', 'T1', logFile], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const line = JSON.parse(run.stdout.trim());
  assert.equal(line.progress, 'first');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.diagnostics.length, 1);
  assert.equal(m.diagnostics[0].stage, 'test');
  assert.equal(m.diagnostics[0].attempt, 'T1');
});

test('2272 AC2 fingerprint status: record fail --log writes m.diagnostics and next output is unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac2-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ runId: 'r', attempts: [] }));
  const logFile = path.join(dir, 'unit.log');
  fs.writeFileSync(logFile, LOG_A);
  const run = spawnSync(process.execPath, [STATUS_CLI, dir, 'record', 'fail', '--log', logFile], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim()), {
    recorded: 'T1', ok: false, next: { next: { attempt: 'T2', model: 'haiku' } },
  });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.attempts.length, 1);
  assert.equal(m.diagnostics[0].fingerprint, fingerprint(LOG_A));
});

test('2272 AC2 fingerprint status: --log is ignored on pass and when the log file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac2-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ runId: 'r', attempts: [] }));
  const pass = spawnSync(process.execPath, [STATUS_CLI, dir, 'record', 'pass', '--log', path.join(dir, 'none.log')], { encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.diagnostics, undefined);
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac2-'));
  fs.writeFileSync(path.join(dir2, 'manifest.json'), JSON.stringify({ runId: 'r', attempts: [] }));
  const missing = spawnSync(process.execPath, [STATUS_CLI, dir2, 'record', 'fail', '--log', path.join(dir2, 'none.log')], { encoding: 'utf8' });
  assert.equal(missing.status, 0, missing.stderr);
  const m2 = JSON.parse(fs.readFileSync(path.join(dir2, 'manifest.json'), 'utf8'));
  assert.equal(m2.diagnostics, undefined);
  assert.equal(m2.attempts.length, 1);
});
