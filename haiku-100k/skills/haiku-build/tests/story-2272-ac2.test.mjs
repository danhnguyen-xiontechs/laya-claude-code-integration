// Story 2272 AC2: status.mjs record fail and save_opus.mjs write a diagnostic per failed test, plan or review attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logFingerprint } from '../scripts/v3.mjs';
import { saveOpus } from '../scripts/save_opus.mjs';

const STATUS_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'status.mjs');
const record = (dir) => spawnSync(process.execPath, [STATUS_CLI, dir, 'record', 'fail'], { encoding: 'utf8' });
const readM = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const LOG = (ms, stamp) => [
  `${stamp} FAIL 1 test: flag works`,
  `AssertionError [ERR_ASSERTION]: expected true got false at src/a.mjs:3:5 (${ms}ms)`,
  'tests 2 pass 1 fail 1',
].join('\n');

function fixture(log) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-2272-ac2-'));
  fs.mkdirSync(path.join(dir, 'evidence'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'ac2', attempts: [] }));
  if (log !== null) fs.writeFileSync(path.join(dir, 'evidence', 'unit-tests.log'), log);
  return dir;
}

test('2272 AC2 failed attempt records diagnostic', () => {
  const dir = fixture(LOG(12.3, '2026-10-22T10:00:00Z'));
  assert.equal(record(dir).status, 0);
  assert.equal(record(dir).status, 0);
  const d = readM(dir).diagnostics;
  assert.equal(d.length, 2);
  assert.equal(d[0].progress, 'first');
  assert.equal(typeof d[0].category, 'string');
  assert.ok(d[0].fingerprint);
  assert.equal(d[1].fingerprint, d[0].fingerprint);
  assert.equal(d[1].progress, 'same');
  assert.equal(d[1].repeated, true);
  assert.ok(typeof d[1].summary === 'string' && d[1].summary.length > 0);

  const missing = fixture(null);
  assert.equal(record(missing).status, 0);
  assert.equal(readM(missing).diagnostics[0].fingerprint, null);
});

// Shaped like real node --test output (spec and TAP reporters): two runs of one failure differ only in durations.
const NODE_SPEC = (a, b, total) => [
  `✔ ok (${a}ms)`,
  `✖ bad (${b}ms)`,
  'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1',
  `ℹ duration_ms ${total}`,
  'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '    at TestContext.<anonymous> (file:///C:/work/run-7/x.test.mjs:2:47)',
].join('\n');
const NODE_TAP = (a, total) => [
  'not ok 2 - bad', '  ---', `  duration_ms: ${a}`, "  failureType: 'testCodeFailure'", '  ...',
  '# tests 2', '# pass 1', '# fail 1', `# duration_ms ${total}`,
].join('\n');

test('2272 AC2 fingerprint ignores node:test durations', () => {
  assert.equal(logFingerprint(NODE_SPEC('0.7008', '0.7135', '75.6107')), logFingerprint(NODE_SPEC('0.6278', '0.7092', '342.5351')));
  assert.equal(logFingerprint(NODE_TAP('0.5983', '72.5941')), logFingerprint(NODE_TAP('1.2', '80')));
  assert.notEqual(logFingerprint(NODE_SPEC('1', '1', '1')), logFingerprint(NODE_SPEC('1', '1', '1').replace('bad', 'other')));
});

test('2272 AC2 failed plan and review hand-backs record diagnostics', () => {
  const dir = fixture(null);
  const bad = path.join(dir, 'evidence', 'handback.txt');
  fs.writeFileSync(bad, 'not a json array');
  assert.equal(saveOpus('review', dir, bad, { attempt: 1 }).ok, false);
  assert.equal(saveOpus('review', dir, bad, { attempt: 2, approvedBy: 'auto' }).ok, false);
  const d = readM(dir).diagnostics;
  assert.deepEqual(d.map((x) => [x.kind, x.attempt, x.category, x.progress]), [['review', 1, 'review-invalid', 'first'], ['review', 2, 'review-invalid', 'same']]);
  assert.equal(d[1].repeated, true);

  fs.writeFileSync(bad, '');
  assert.equal(saveOpus('plan', dir, bad, { attempt: 1 }).ok, false);
  const p = readM(dir).diagnostics.at(-1);
  assert.equal(p.kind, 'plan');
  assert.equal(p.category, 'plan-invalid');
  assert.equal(p.progress, 'first', 'compared with the previous plan diagnostic only');

  fs.writeFileSync(bad, '[]');
  assert.equal(saveOpus('review', dir, bad, { attempt: 1 }).ok, true);
  assert.equal(readM(dir).diagnostics.length, 3, 'a passing hand-back adds none');
});
