// Story 2272 AC2: every failed rung leaves a diagnostic; the recovery advise carries the summary and no extra advise call is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runAuto, CONDITIONS } from '../scripts/auto.mjs';
import { LADDER } from '../../haiku-build/scripts/status.mjs';
import { baseDeps, fakeAgent, fakeTests, readJson } from './fixture.mjs';

test('2272 AC2 auto ladder records diagnostics', async () => {
  const a = fakeAgent();
  const asks = [];
  const ask = async (o) => {
    asks.push(o);
    return { label: o.choices[0], confidence: 0.95 };
  };
  const t = fakeTests([false]);
  const deps = baseDeps({ agent: a.agent, runTests: t.runTests, ask, env: { HAIKU_BUILD_JEV: 'apply' } });
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, CONDITIONS.ladder);

  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.diagnostics.length, t.runs.length, 'one diagnostic per failed rung');
  assert.ok(m.diagnostics.every((d) => 'fingerprint' in d && 'summary' in d));
  assert.ok(m.diagnostics.some((d) => d.repeated === true), 'repeats are flagged');

  const recovery = asks.filter((o) => o.point === 'recovery');
  assert.equal(recovery.length, 1, 'still one recovery advise');
  assert.ok(recovery[0].state.length > `failed ${m.tests.failed}`.length, 'state carries the diagnostic summary');

  assert.ok(m.attempts.length <= LADDER.length);
});

test('2272 AC2 auto records a diagnostic for a failed review hand-back', async () => {
  const a = fakeAgent({ review: (req, n) => (n <= 3 ? 'not json' : '[]') });
  const deps = baseDeps({ agent: a.agent, runTests: fakeTests([true]).runTests });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  const review = m.diagnostics.filter((d) => d.kind === 'review');
  assert.equal(review.length, 1, 'the failed first review attempt');
  assert.equal(review[0].attempt, 1);
  assert.equal(review[0].category, 'review-invalid');
  assert.ok(review[0].fingerprint);
});
