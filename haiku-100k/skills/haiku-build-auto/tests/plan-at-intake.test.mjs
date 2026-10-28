// xt-factory plan-at-intake: plan-only writes the plan as a ready-for-dev story spec; a later run of
// the same story reuses it without a plan call, or refreshes it on Sonnet when it is draft with a
// Replan note; a story spec in another format is planned as usual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runAuto, planOnly, storyPlan } from '../scripts/auto.mjs';
import { SPEC, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

const folder = () => {
  const dir = tmpDir('haiku-plan-intake-');
  fs.writeFileSync(path.join(dir, 'stories.yaml'), '- id: "7"\n  title: "Move a card"\n');
  return dir;
};
const dispatch = (specFolder) => ({ specFolder, storyId: '7', title: 'Move a card', task: null });

test('plan-only: the plan becomes the ready-for-dev story spec and nothing is built', async () => {
  const specFolder = folder();
  const a = fakeAgent();
  const deps = baseDeps({ ...dispatch(specFolder), agent: a.agent, runTests: fakeTests().runTests });
  // Start + plan as the skill does in plan-only mode (runAuto would go on to build: stop it at implement).
  const stop = new Error('stop after plan');
  const r = await runAuto({ ...deps, agent: async (req) => { if (req.role === 'implement') throw stop; return a.agent(req); } });
  assert.equal(r.status, 'blocked', 'the stub stopped the run at implement');
  fs.rmSync(path.join(specFolder, 'stories'), { recursive: true, force: true }); // the blocked write-back
  const out = planOnly(deps.runDir);
  assert.equal(out.ok, true);
  const text = fs.readFileSync(out.file, 'utf8');
  assert.match(text, /^---\nstatus: 'ready-for-dev'\nformat: haiku-spec\n---\n\n# Spec: fixture/);
  assert.equal(readJson(path.join(deps.runDir, 'manifest.json')).status, 'PLANNED');
  assert.equal(storyPlan(dispatch(specFolder)).kind, 'reuse');
});

test('reuse: a ready-for-dev story spec is the plan, the plan model is never called', async () => {
  const specFolder = folder();
  fs.mkdirSync(path.join(specFolder, 'stories'), { recursive: true });
  fs.writeFileSync(path.join(specFolder, 'stories', '7-move-a-card.md'), `---\nstatus: 'ready-for-dev'\nformat: haiku-spec\n---\n\n${SPEC}`);
  const a = fakeAgent();
  const deps = baseDeps({ ...dispatch(specFolder), agent: a.agent, runTests: fakeTests([true]).runTests });
  const r = await runAuto(deps);
  assert.equal(r.status, 'done');
  assert.equal(a.count('plan'), 0);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.auto.plan, 'reused');
  assert.equal(m.opusCalls[0].source, 'intake');
  assert.ok(fs.existsSync(path.join(deps.runDir, 'spec.md')));
});

test('refresh: a draft story spec with a Replan note is planned again on Sonnet with the previous plan', async () => {
  const specFolder = folder();
  fs.mkdirSync(path.join(specFolder, 'stories'), { recursive: true });
  fs.writeFileSync(path.join(specFolder, 'stories', '7-move-a-card.md'), `---\nstatus: 'draft'\n---\n\n${SPEC}\n## Replan note\n\n- api: src/a.mjs\n`);
  const a = fakeAgent();
  const deps = baseDeps({ ...dispatch(specFolder), agent: a.agent, runTests: fakeTests([true]).runTests });
  const r = await runAuto(deps);
  assert.equal(r.status, 'done');
  const plan = a.calls.filter((c) => c.role === 'plan');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].model, 'sonnet');
  assert.match(fs.readFileSync(plan[0].previousPlan, 'utf8'), /## Replan note[\s\S]*src\/a\.mjs/);
});

test('a story spec in another format (a bmad spec) is not adopted: the plan stage runs', async () => {
  const specFolder = folder();
  fs.mkdirSync(path.join(specFolder, 'stories'), { recursive: true });
  fs.writeFileSync(path.join(specFolder, 'stories', '7-move-a-card.md'), "---\nstatus: 'ready-for-dev'\n---\n\n## Intent\n\nx\n\n## Code Map\n\n- `a.mjs`\n");
  assert.equal(storyPlan(dispatch(specFolder)), null);
});
