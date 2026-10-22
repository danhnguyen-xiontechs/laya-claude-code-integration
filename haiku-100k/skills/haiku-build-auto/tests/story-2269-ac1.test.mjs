// Story 2269 AC1: given any start model and any task, runAuto asks nothing and ends in exactly one of done,
// done_with_findings, blocked. An Opus or Fable start answers the switch question "yes" by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runAuto, autoRouting, TERMINAL } from '../scripts/auto.mjs';
import { SKILL_DIR, MINOR, baseDeps, fakeAgent, fakeTests, readJson } from './fixture.mjs';

test('2269 AC1 opus or fable start: switch answered yes automatically, main session on sonnet, no question', async () => {
  for (const startModel of ['claude-opus-5-5', 'opus', 'fable']) {
    const r = autoRouting(startModel);
    assert.equal(r.switchAnswer, 'yes');
    assert.equal(r.main, 'sonnet');
    assert.equal(r.stages.find((s) => s.id === '07-present').model, 'sonnet');
    const deps = baseDeps({ startModel, ...fakeAgent(), ...fakeTests() });
    const res = await runAuto(deps);
    assert.equal(res.status, 'done');
    const m = readJson(path.join(deps.runDir, 'manifest.json'));
    assert.equal(m.routing.switchAnswer, 'yes');
    assert.equal(m.routing.switchAnsweredBy, 'haiku-build-auto');
    assert.equal(m.routing.main, 'sonnet');
    assert.equal(m.auto.questionsAsked, 0);
  }
});

test('2269 AC1 haiku, sonnet and unknown starts keep routing.mjs behaviour with no question', () => {
  assert.deepEqual([autoRouting('claude-haiku-5-5').main, autoRouting('sonnet').main, autoRouting(null).main], ['haiku', 'sonnet', 'sonnet']);
  for (const s of ['haiku', 'sonnet', null, 'gpt-x']) {
    assert.equal(autoRouting(s).switchQuestion, null);
    assert.equal(autoRouting(s).switchAnswer, null);
  }
  assert.equal(autoRouting('haiku').stages.find((s) => s.id === '02-plan').model, 'opus');
});

test('2269 AC1 happy path: plan ok, tests pass on T1, empty review -> done, exit 0, result.json', async () => {
  const a = fakeAgent();
  const t = fakeTests([true]);
  const deps = baseDeps({ agent: a.agent, runTests: t.runTests });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  assert.equal(res.exitCode, 0);
  assert.equal(res.condition, null);
  assert.equal(readJson(path.join(deps.runDir, 'result.json')).status, 'done');
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.finalStatus, 'done');
  assert.deepEqual(m.attempts.map((x) => [x.attempt, x.ok]), [['T1', true]]);
  assert.equal(t.runs.length, 1);
  assert.equal(a.count('plan'), 1);
  assert.equal(a.count('review'), 3);
  assert.deepEqual(a.calls.filter((c) => c.role === 'review').map((c) => c.lens).sort(), ['blind-hunter', 'edge-case-hunter', 'verification-gap']);
  assert.equal(a.count('fix'), 0);
  for (const f of ['spec.md', 'evidence/diff.patch', 'evidence/unit-tests.log', 'evidence/review.json']) {
    assert.ok(fs.existsSync(path.join(deps.runDir, f)), f);
  }
});

test('2269 AC1 any start model and any task ends in exactly one terminal status and never asks', async () => {
  const scenarios = {
    pass: () => ({ ...fakeAgent(), ...fakeTests([true]) }),
    minor: () => ({ ...fakeAgent({ review: (req) => (req.lens === 'verification-gap' ? JSON.stringify([MINOR]) : '[]') }), ...fakeTests([true]) }),
    failingTests: () => ({ ...fakeAgent(), ...fakeTests([false]) }),
    agentThrows: () => ({ agent: async () => { throw new Error('Agent tool unavailable'); }, ...fakeTests([true]) }),
    noTask: () => ({ task: '', ...fakeAgent(), ...fakeTests([true]) }),
  };
  let asked = 0;
  for (const startModel of ['claude-haiku-5-5', 'sonnet', 'opus', 'fable', null, 'unknown-model']) {
    for (const [name, make] of Object.entries(scenarios)) {
      const deps = baseDeps({ startModel, askUser: () => { asked++; throw new Error('asked the user'); }, ...make() });
      const res = await runAuto(deps);
      assert.ok(TERMINAL.includes(res.status), `${startModel}/${name}: ${res.status}`);
      assert.equal(res.exitCode, res.status === 'blocked' ? 1 : 0);
      assert.equal(readJson(path.join(deps.runDir, 'result.json')).status, res.status);
    }
  }
  assert.equal(asked, 0);
});

test('2269 AC1 JEV intake advice is injected (no network) and may pick the plan model', async () => {
  const asks = [];
  const ask = async (q) => { asks.push(q.point); return { label: 'sonnet', confidence: 0.95 }; };
  const a = fakeAgent();
  const deps = baseDeps({ env: { HAIKU_BUILD_JEV: 'apply' }, ask, agent: a.agent, ...fakeTests([true]) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  assert.deepEqual(asks, ['intake']);
  assert.equal(a.calls.find((c) => c.role === 'plan').model, 'sonnet');
  assert.equal(readJson(path.join(deps.runDir, 'manifest.json')).jev.calls[0].source, 'jev');
});

test('2269 AC1 skill: SKILL.md forbids asking the user and names the three terminal statuses', () => {
  const text = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(text, /^name: haiku-build-auto$/m);
  assert.match(text, /Never ask the user anything/);
  assert.match(text, /Never end a turn waiting for input/);
  for (const s of ['done', 'done_with_findings', 'blocked']) assert.ok(text.includes(`\`${s}\``), s);
  assert.match(text, /Three terminal statuses only/);
  assert.match(text, /scripts\/auto\.mjs/);
  for (const step of ['step-02-plan.md', 'step-03-implement.md', 'step-04-test.md', 'step-05-review.md', 'step-06-fix.md']) {
    assert.ok(text.includes(step), step);
  }
});
