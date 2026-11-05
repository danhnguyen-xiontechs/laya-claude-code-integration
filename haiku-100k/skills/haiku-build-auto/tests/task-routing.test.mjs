// The task router at Implement and Fix dispatch (task-routing.mjs): writes the stage model and the decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { routeStage, routingInput, hasExecutableCheck } from '../scripts/task-routing.mjs';

function runDir(spec, extra = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hba-route-'));
  fs.writeFileSync(path.join(d, 'spec.md'), spec);
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ runId: 'run-1', routing: { stages: [{ id: '03-implement', model: 'haiku' }, { id: '06-fix', model: 'haiku' }] }, ...extra }));
  return d;
}
const ON = { HAIKU_BUILD_TASK_ROUTER: 'on' };
const ask = (nouls) => { const f = async () => { f.n++; return { ok: true, nouls, ms: 5, cost: null }; }; f.n = 0; return f; };

test('implement: a cross-module change starts on sonnet; the manifest records model and decision', async () => {
  const d = runDir('Change src/orders/api.ts and src/orders/db.ts so totals flow through. Run `npm test`.');
  const a = ask({ fully_specified: 0.3, cross_file: 0.85, open_design: 0.2, unknown_cause: 0.1 });
  const r = await routeStage(d, 'implement', { env: ON, ask: a });
  assert.equal(r.tier, 'sonnet');
  const m = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8'));
  assert.equal(m.routing.stages.find((s) => s.id === '03-implement').model, 'sonnet');
  assert.equal(m.taskRouting.implement.source, 'jev');
  // a second gate (resume) reuses the cached decision
  await routeStage(d, 'implement', { env: ON, ask: a });
  assert.equal(a.n, 1);
});

test('no executable check → sonnet by rule, no Jev; off by default and with =off, nothing changes', async () => {
  const d = runDir('Update the wording in docs/intro.md.');
  const a = ask({ fully_specified: 0.9, cross_file: 0.1, open_design: 0.1, unknown_cause: 0.1 });
  const r = await routeStage(d, 'implement', { env: ON, ask: a });
  assert.deepEqual([r.tier, r.source, a.n], ['sonnet', 'rule', 0]);
  const d2 = runDir('x');
  assert.equal(await routeStage(d2, 'implement', { env: { HAIKU_BUILD_TASK_ROUTER: 'off' } }), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d2, 'manifest.json'), 'utf8')).taskRouting, undefined);
  // default (env {}): the router is off, returns null and writes no taskRouting
  const d3 = runDir('Change src/orders/api.ts and src/orders/db.ts. Run `npm test`.');
  assert.equal(await routeStage(d3, 'implement', { env: {}, ask: a }), null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d3, 'manifest.json'), 'utf8')).taskRouting, undefined);
});

test('fix input lists the open findings; a cli case in tests.json counts as a check', () => {
  const spec = fs.mkdtempSync(path.join(os.tmpdir(), 'hba-spec-'));
  fs.writeFileSync(path.join(spec, 'tests.json'), JSON.stringify({ cases: [{ id: 'TC1', story: '7', type: 'cli', command: 'dotnet test' }] }));
  const m = { dispatch: { specFolder: spec, storyId: '7' }, review: { findings: [{ severity: 'Major', title: 'null total', ref: 'src/a.cs:4', status: 'open' }, { title: 'done', status: 'fixed' }] } };
  assert.equal(hasExecutableCheck(m, ''), true);
  const { text, facts } = routingInput(spec, m, 'fix');
  assert.match(text, /null total/);
  assert.doesNotMatch(text, /done/);
  assert.equal(facts.fix, true);
});
