// Story 2272 AC1: runAuto writes the AC map of the saved spec into result.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runAuto } from '../scripts/auto.mjs';
import { baseDeps, fakeAgent, fakeTests, readJson } from './fixture.mjs';

test('2272 AC1 auto carries AC map into result', async () => {
  const a = fakeAgent();
  const deps = baseDeps({ agent: a.agent, ...fakeTests() });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  const r = readJson(path.join(deps.runDir, 'result.json'));
  assert.ok(Array.isArray(r.acMap), 'acMap is an array');
  const ac1 = r.acMap.find((x) => x.id === 'AC1');
  assert.ok(ac1, 'AC1 present');
  assert.equal(ac1.target, 'src/a.mjs');
  assert.ok(ac1.missing.includes('test'));
});
