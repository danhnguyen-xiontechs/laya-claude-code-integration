// Story 2268 AC2: tests that keep failing or a missing required artifact make the run blocked, a further
// retry is refused, and the missing artifact is named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LADDER, REQUIRED_ARTIFACTS, nextAttempt, missingArtifacts, finalStatus } from '../scripts/status.mjs';

const fail = (attempt) => ({ attempt, ok: false });
const allFailed = () => LADDER.map((r) => fail(r.attempt));

function runDir(skip = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2268-'));
  for (const rel of REQUIRED_ARTIFACTS.filter((r) => !skip.includes(r))) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '{}');
  }
  return dir;
}

test('2268 AC2 tests keep failing: ladder is T1, T2, Sonnet retry, T3', () => {
  assert.deepEqual(nextAttempt([]).next, { attempt: 'T1', model: 'haiku' });
  assert.deepEqual(nextAttempt([fail('T1')]).next, { attempt: 'T2', model: 'haiku' });
  assert.deepEqual(nextAttempt([fail('T1'), fail('T2')]).next, { attempt: 'sonnet-retry', model: 'sonnet' });
  assert.deepEqual(nextAttempt([fail('T1'), fail('T2'), fail('sonnet-retry')]).next, { attempt: 'T3', model: 'haiku' });
});

test('2268 AC2 tests keep failing: after T3 status blocked and next retry refused', () => {
  const n = nextAttempt(allFailed());
  assert.equal(n.refused, true);
  assert.equal(n.next, null);
  assert.equal(n.status, 'blocked');
  assert.match(n.reason, /T1.*T2.*Sonnet retry.*T3/);
  const f = finalStatus({ missing: [], tests: { failed: 2 }, attempts: allFailed() });
  assert.equal(f.status, 'blocked');
  assert.match(f.reason, /ladder/);
});

test('2268 AC2 tests keep failing: a pass stops the ladder and the run is done', () => {
  assert.equal(nextAttempt([fail('T1'), { attempt: 'T2', ok: true }]).done, true);
  assert.equal(finalStatus({ tests: { failed: 0 }, attempts: [{ attempt: 'T1', ok: true }] }).status, 'done');
  assert.equal(finalStatus({ tests: { failed: 1 }, attempts: [fail('T1')] }).status, 'blocked');
});

test('2268 AC2 missing artifact: status blocked and the message names the file', () => {
  const dir = runDir(['evidence/review.json']);
  const missing = missingArtifacts(dir);
  assert.deepEqual(missing, ['evidence/review.json']);
  const f = finalStatus({ missing, tests: { failed: 0 }, attempts: [{ attempt: 'T1', ok: true }] });
  assert.equal(f.status, 'blocked');
  assert.match(f.reason, /evidence\/review\.json/);
});

test('2268 AC2 missing artifact: none missing gives done or done_with_findings', () => {
  const dir = runDir();
  assert.deepEqual(missingArtifacts(dir), []);
  const ok = { missing: [], tests: { failed: 0 }, attempts: [{ attempt: 'T1', ok: true }] };
  assert.equal(finalStatus({ ...ok, findings: [{ resolution: 'open' }] }).status, 'done_with_findings');
  assert.equal(finalStatus({ ...ok, findings: [{ resolution: 'fixed' }] }).status, 'done');
});
