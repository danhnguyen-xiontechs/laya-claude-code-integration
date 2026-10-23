// Story 2272 AC5: haiku-build-auto runs the v3 helpers. A failed test run is recorded in manifest.diagnostics
// and the fix-tests request carries its recovery state; the plan saves a trace of the spec; the plan and review
// requests get one shared context bundle; a re-review after a changed diff gets the rebuilt bundle; JEV off makes
// no ask; a run with all tests passing has no diagnostics and ends done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runAuto, CONDITIONS } from '../scripts/auto.mjs';
import { buildTrace } from '../../haiku-build/scripts/trace.mjs';
import { getBundle } from '../../haiku-build/scripts/context_bundle.mjs';
import { SPEC, MAJOR, baseDeps, fakeAgent, fakeTests, noAsk, readJson } from './fixture.mjs';

async function blocked(deps, condition) {
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, condition);
  assert.equal(res.exitCode, 1);
  return res;
}

const reviewWithMajor = (req, n) => (n <= 3 ? JSON.stringify([MAJOR]) : '[]');

test('2272 AC5 fail then pass: the failed run is in manifest.diagnostics and the run ends done', async () => {
  const a = fakeAgent();
  const deps = baseDeps({ agent: a.agent, ...fakeTests([false, true]) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.diagnostics.length, 1);
  assert.equal(m.diagnostics[0].stage, 'test');
  assert.equal(m.diagnostics[0].attempt, 'T1');
  assert.equal(m.diagnostics[0].progress, 'first');
});

test('2272 AC5 fail then pass: the fix-tests request carries the recovery state of the failed run', async () => {
  const a = fakeAgent();
  await runAuto(baseDeps({ agent: a.agent, ...fakeTests([false, true]) }));
  const fix = a.calls.find((c) => c.role === 'fix-tests');
  assert.ok(fix, 'a fix-tests request was made');
  assert.match(fix.diagnostics, /^failed 1; last test T1: /);
});

test('2272 AC5 plan: manifest.trace is the trace of the saved spec', async () => {
  const deps = baseDeps({ agent: fakeAgent().agent, ...fakeTests() });
  await runAuto(deps);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  const expected = buildTrace(SPEC);
  assert.deepEqual(m.trace.unmapped, expected.unmapped);
  assert.deepEqual(m.trace.unmapped, ['AC1']);
  assert.equal(m.trace.ok, false);
  assert.equal(m.trace.acs.length, expected.acs.length);
});

test('2272 AC5 plan: the plan request carries a context bundle', async () => {
  const a = fakeAgent();
  await runAuto(baseDeps({ agent: a.agent, ...fakeTests() }));
  const plan = a.calls.find((c) => c.role === 'plan');
  assert.equal(typeof plan.context, 'object');
  assert.ok(plan.context !== null);
});

test('2272 AC5 review: the three lens requests share one context bundle object', async () => {
  const a = fakeAgent({ review: '[]' });
  await runAuto(baseDeps({ agent: a.agent, ...fakeTests() }));
  const reviews = a.calls.filter((c) => c.role === 'review');
  assert.equal(reviews.length, 3);
  assert.equal(typeof reviews[0].context, 'object');
  assert.ok(reviews.every((c) => c.context === reviews[0].context));
});

test('2272 AC5 re-review: after a fix round with a changed diff, the re-review gets a rebuilt bundle', async () => {
  let diffN = 0;
  const a = fakeAgent({ review: reviewWithMajor });
  const deps = baseDeps({
    agent: a.agent,
    ...fakeTests(),
    gitDiff: () => `diff --git a/src/a.mjs b/src/a.mjs\n+export const flag${++diffN} = true;\n`,
  });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  const reviewCtx = a.calls.find((c) => c.role === 'review').context;
  const reReview = a.calls.find((c) => c.role === 're-review');
  assert.ok(reReview, 're-review was requested');
  assert.notEqual(JSON.stringify(reReview.context), JSON.stringify(reviewCtx));
  const again = getBundle(deps.runDir, { stage: 'review', task: deps.task });
  assert.equal(again.reused, true);
});

test('2272 AC5 JEV off: no ask is made and the run ends done', async () => {
  const na = noAsk();
  const res = await runAuto(baseDeps({ ask: na.ask, agent: fakeAgent().agent, ...fakeTests() }));
  assert.equal(res.status, 'done');
  assert.equal(na.asked.length, 0);
});

test('2272 AC5 all pass: no diagnostics are recorded and the run ends done', async () => {
  const deps = baseDeps({ agent: fakeAgent().agent, ...fakeTests([true]) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  assert.equal(res.exitCode, 0);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.ok(!m.diagnostics || m.diagnostics.length === 0);
});

test('2272 AC5 ladder used up: every test run is in manifest.diagnostics and the run is blocked', async () => {
  const deps = baseDeps({ agent: fakeAgent().agent, ...fakeTests([false]) });
  await blocked(deps, CONDITIONS.ladder);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.diagnostics.filter((d) => d.stage === 'test').length, 4);
});

test('2272 AC5 plan failed: each failed hand-back is recorded in manifest.diagnostics', async () => {
  const deps = baseDeps({ agent: fakeAgent({ plan: 'no headings here' }).agent, ...fakeTests() });
  await blocked(deps, CONDITIONS.planFailedTwice);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.deepEqual(m.diagnostics.filter((d) => d.stage === 'plan').map((d) => d.attempt), [1, 2]);
});

test('2272 AC5 review failed: each failed hand-back is recorded in manifest.diagnostics', async () => {
  const deps = baseDeps({ agent: fakeAgent({ review: 'not json at all' }).agent, ...fakeTests() });
  await blocked(deps, CONDITIONS.reviewFailedTwice);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.diagnostics.filter((d) => d.stage === 'review').length, 2);
});
