// Story 2272 AC5: auto and status.mjs share the diagnostics contract; no ask in noAsk mode; retry still needs approvedBy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runAuto } from '../scripts/auto.mjs';
import { parseAcMap, diagnoseFailure } from '../../haiku-build/scripts/v3.mjs';
import { saveOpus } from '../../haiku-build/scripts/save_opus.mjs';
import { SPEC, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

test('2272 AC5 shared contracts and modes preserved', async () => {
  let asked = 0;
  const ask = async () => { asked += 1; throw new Error('ask must not be called'); };
  const a = fakeAgent();
  const deps = baseDeps({ agent: a.agent, ask, env: { HAIKU_BUILD_JEV: 'off' }, runTests: fakeTests([false]).runTests });
  const res = await runAuto(deps);
  assert.equal(asked, 0, 'runAuto never asks');
  assert.ok(['blocked', 'done', 'done_with_findings'].includes(res.status));

  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  const r = readJson(path.join(deps.runDir, 'result.json'));
  assert.deepEqual(r.acMap, parseAcMap(SPEC), 'acMap comes from the shared parser');

  const log = fs.readFileSync(path.join(deps.runDir, 'evidence', 'unit-tests.log'), 'utf8');
  const shared = diagnoseFailure({ kind: 'test', log, failed: 1, attempt: 'T1', at: '2026-10-22T10:00:00.000Z' });
  assert.equal(m.diagnostics[0].fingerprint, shared.fingerprint, 'auto and status.mjs agree on the fingerprint');

  const dir = tmpDir();
  const file = path.join(dir, 'plan.md');
  fs.writeFileSync(file, SPEC);
  assert.throws(() => saveOpus('plan', dir, file, { attempt: 2 }), /approved/);
});
