// Story 2272 AC4: a blocked auto run writes metrics into result.json; existing result fields are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runAuto, CONDITIONS } from '../scripts/auto.mjs';
import { baseDeps, fakeAgent, fakeTests, readJson } from './fixture.mjs';

test('2272 AC4 blocked result has metrics', async () => {
  const a = fakeAgent();
  const deps = baseDeps({ agent: a.agent, runTests: fakeTests([false]).runTests });
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  const r = readJson(path.join(deps.runDir, 'result.json'));
  assert.equal(r.status, 'blocked');
  assert.equal(r.condition, CONDITIONS.ladder);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
  assert.ok(r.metrics, 'metrics present');
  assert.ok(Array.isArray(r.metrics.stages));
  assert.equal(r.metrics.attempts.total, 4);
  assert.equal(typeof r.metrics.repeats, 'number');
});
