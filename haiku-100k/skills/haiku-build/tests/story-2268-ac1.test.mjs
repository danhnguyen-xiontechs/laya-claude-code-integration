// Story 2268 AC1: given a start model, every v2 stage has a model and only an Opus/Fable start yields one
// switch question.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, SWITCH_QUESTION, routeStages } from '../scripts/routing.mjs';

const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const assertAllRouted = (r) => {
  assert.equal(r.stages.length, 7);
  assert.deepEqual(r.stages.map((s) => s.id), STAGES.map((s) => s.id));
  for (const s of r.stages) assert.ok(MODELS.includes(s.model), `${s.id} has model ${s.model}`);
};

test('2268 AC1 every stage routed for each start model', () => {
  for (const start of ['haiku', 'sonnet', 'opus', 'fable', undefined, 'claude-haiku-5-5', 'claude-opus-5-5']) {
    assertAllRouted(routeStages(start));
  }
});

test('2268 AC1 opus and fable start yield exactly one switch question', () => {
  for (const start of ['opus', 'fable', 'claude-opus-5-5']) {
    const r = routeStages(start);
    assert.equal(r.switchQuestion, SWITCH_QUESTION);
    assert.equal(typeof r.switchQuestion, 'string'); // one question, not a list
  }
});

test('2268 AC1 switch answer yes moves main stages to Sonnet, no keeps the start model', () => {
  const yes = routeStages('opus', { switchAnswer: 'yes' });
  assert.equal(yes.main, 'sonnet');
  for (const s of yes.stages.filter((x) => x.runsIn === 'main')) assert.equal(s.model, 'sonnet');
  const no = routeStages('fable', { switchAnswer: 'no' });
  assert.equal(no.main, 'fable');
  assert.equal(no.switchQuestion, SWITCH_QUESTION);
});

test('2268 AC1 no question for haiku, sonnet or no start model', () => {
  assert.equal(routeStages('haiku').switchQuestion, null);
  assert.equal(routeStages('haiku').main, 'haiku');
  assert.equal(routeStages('sonnet').switchQuestion, null);
  assert.equal(routeStages('sonnet').main, 'sonnet');
  assert.equal(routeStages(undefined).switchQuestion, null);
  assert.equal(routeStages(undefined).main, 'sonnet');
});

test('2268 AC1 stage set is 01-intake .. 07-present in order', () => {
  assert.deepEqual(STAGES.map((s) => s.id), [
    '01-intake', '02-plan', '03-implement', '04-test', '05-review', '06-fix', '07-present',
  ]);
});

test('2268 AC1 stage models: Opus only for the plan, Haiku implements, tests and fixes, Sonnet reviews', () => {
  const by = (r) => Object.fromEntries(r.stages.map((s) => [s.id, s]));
  const opusStages = (r) => Object.values(r).filter((s) => s.model === 'opus').map((s) => s.id);
  for (const start of ['haiku', 'sonnet', undefined]) {
    const r = by(routeStages(start));
    assert.equal(r['02-plan'].model, 'opus');
    assert.equal(r['03-implement'].model, 'haiku');
    assert.equal(r['04-test'].model, 'haiku');
    assert.equal(r['05-review'].model, 'sonnet');
    assert.equal(r['06-fix'].model, 'haiku');
    assert.deepEqual(opusStages(r), ['02-plan']);
  }
  assert.deepEqual(opusStages(by(routeStages('opus', { switchAnswer: 'yes' }))), ['02-plan']);
});

test('2268 AC1 fallbacks: 03-implement one Sonnet fallback, 06-fix at most one Sonnet re-review', () => {
  const by = Object.fromEntries(routeStages('haiku').stages.map((s) => [s.id, s]));
  assert.deepEqual(by['03-implement'].fallback, { model: 'sonnet', role: 'implement', max: 1 });
  assert.deepEqual(by['06-fix'].fallback, { model: 'sonnet', role: 're-review', max: 1 });
  for (const id of ['01-intake', '02-plan', '04-test', '05-review', '07-present']) assert.equal(by[id].fallback, null);
});

test('2268 AC1 JEV points: intake at 01-intake, recovery at 04-test, triage at 05-review', () => {
  const points = Object.fromEntries(STAGES.filter((s) => s.jev).map((s) => [s.id, s.jev]));
  assert.deepEqual(points, { '01-intake': 'intake', '04-test': 'recovery', '05-review': 'triage' });
});

test('2268 AC1 plan advice limited to opus or sonnet', () => {
  const plan = (r) => r.stages.find((s) => s.id === '02-plan').model;
  assert.equal(plan(routeStages('haiku', { planAdvice: 'sonnet' })), 'sonnet');
  assert.equal(plan(routeStages('haiku', { planAdvice: 'gpt' })), 'opus');
  assert.equal(plan(routeStages('haiku')), 'opus');
});
