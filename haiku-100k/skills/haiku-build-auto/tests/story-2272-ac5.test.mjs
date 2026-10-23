// Story 2272 AC5: haiku-build (manual) and haiku-build-auto use the same v3 helpers (AC map, failure
// fingerprint, context bundle, run metrics); auto asks zero questions and manual keeps its interaction points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAuto, CONDITIONS } from '../scripts/auto.mjs';
import { acMap } from '../../haiku-build/scripts/ac_map.mjs';
import { failureRecord, fingerprint } from '../../haiku-build/scripts/failure.mjs';
import { runMetrics } from '../../haiku-build/scripts/run_metrics.mjs';
import { LADDER } from '../../haiku-build/scripts/status.mjs';
import { AUTO_CLI, STATUS_CLI, SKILL_DIR, MAJOR, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

const HB = path.join(SKILL_DIR, '..', 'haiku-build');
const SPEC_MAPPED = [
  '# Spec: fixture', '', '## 1. Goal & Intent', 'Add a flag.', '',
  '## 6. Tasks & Acceptance Criteria', '- `src/a.mjs` add the flag',
  '- AC1: flag works — target: `src/a.mjs`; verify: `node --test test/a.test.mjs`',
  '- AC2: default kept — target: `src/a.mjs`; verify: `node --test test/b.test.mjs`', '',
  '## 7. Red Checks', 'red: test "flag" fails before', '', '## 8. Verification', '`node --test test/a.test.mjs`', '',
].join('\n');
const node = (...args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').at(-1)) : null };
};
const importsOf = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((x) => path.basename(x[1]));

test('2272 AC5 shared: auto.mjs and the manual scripts import the same helper modules', () => {
  const auto = importsOf(path.join(SKILL_DIR, 'scripts', 'auto.mjs'));
  for (const h of ['failure.mjs', 'context_bundle.mjs', 'run_metrics.mjs', 'save_opus.mjs', 'status.mjs']) assert.ok(auto.includes(h), h);
  // The AC map reaches auto through save_opus -> build_report savePlanSpec, the same path as manual mode.
  assert.ok(importsOf(path.join(HB, 'scripts', 'save_opus.mjs')).includes('build_report.mjs'));
  const report = importsOf(path.join(HB, 'scripts', 'build_report.mjs'));
  for (const h of ['ac_map.mjs', 'run_metrics.mjs']) assert.ok(report.includes(h), h);
  assert.ok(importsOf(path.join(HB, 'scripts', 'status.mjs')).includes('failure.mjs'));
  const autoSrc = fs.readFileSync(path.join(SKILL_DIR, 'scripts', 'auto.mjs'), 'utf8');
  assert.match(autoSrc, /from '\.\.\/\.\.\/haiku-build\/scripts\/failure\.mjs'/);
  assert.match(autoSrc, /from '\.\.\/\.\.\/haiku-build\/scripts\/context_bundle\.mjs'/);
  assert.match(autoSrc, /from '\.\.\/\.\.\/haiku-build\/scripts\/run_metrics\.mjs'/);
});

test('2272 AC5 shared: a done auto run records acMap, bundles Plan and Review context, and writes metrics', async () => {
  const a = fakeAgent({ plan: SPEC_MAPPED, review: (req) => (req.lens === 'blind-hunter' ? JSON.stringify([MAJOR]) : '[]'), 're-review': '[]' });
  const deps = baseDeps({ agent: a.agent, ...fakeTests([true]) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.deepEqual(m.acMap, acMap(SPEC_MAPPED));
  // Context: the plan call, every review lens and the re-review get the bundle text.
  for (const role of ['plan', 'review', 're-review']) {
    for (const c of a.calls.filter((x) => x.role === role)) assert.match(c.context, /^CONTEXT BUNDLE/, role);
  }
  assert.match(a.calls.find((c) => c.role === 'review').context, /AC1: flag works — target: src\/a\.mjs/);
  const uses = m.contextBundle.uses;
  assert.deepEqual(uses.map((u) => u.stage), ['02-plan', '05-review', '06-fix']);
  assert.deepEqual(uses[0].rebuilt, ['acs']);
  assert.ok(uses[1].rebuilt.includes('diff'));
  assert.ok(fs.existsSync(path.join(deps.runDir, 'evidence', 'context-bundle.json')));
  // Metrics: same function as manual mode, in the manifest and result.json.
  assert.deepEqual(res.metrics, m.metrics);
  assert.deepEqual(m.metrics, runMetrics(m));
  assert.deepEqual(m.metrics.attempts, { tests: 1, plan: 1, review: 1, fixRounds: 1 });
  assert.deepEqual(m.metrics.acs, { total: 2, pass: 2, fail: 0, not_run: 0, unmapped: 0 });
  assert.ok(Object.keys(m.metrics.stages).includes('07-present'));
  assert.deepEqual(m.attempts.map((x) => [x.attempt, x.passed, x.failed]), [['T1', 3, 0]]);
});

test('2272 AC5 shared: auto test failures match the manual status.mjs records; recovery state and failure reach the retry', async () => {
  const a = fakeAgent();
  const t = fakeTests([false, false, true]);
  const asked = [];
  const ask = async (q) => { asked.push(q); return { label: q.point === 'intake' ? 'opus' : 'fix-code', confidence: 0.9 }; };
  const deps = baseDeps({ agent: a.agent, runTests: t.runTests, ask, env: { HAIKU_BUILD_JEV: 'apply' } });
  assert.equal((await runAuto(deps)).status, 'done');
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.deepEqual(m.failures.map((f) => [f.kind, f.stage, f.attempt, f.progress, f.repeatCount]), [['test', '04-test', 'T1', 'first', 1], ['test', '04-test', 'T2', 'none', 2]]);
  assert.deepEqual(m.attempts.map((x) => [x.attempt, x.ok, x.failed]), [['T1', false, 1], ['T2', false, 1], ['sonnet-retry', true, 0]]);
  // Manual mode: the same logs through status.mjs record give the same fingerprints.
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'evidence'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ attempts: [] }));
  fs.writeFileSync(path.join(dir, 'evidence', 'unit-tests.log'), 'pass 2 fail 1');
  node(STATUS_CLI, dir, 'record', 'fail');
  node(STATUS_CLI, dir, 'record', 'fail');
  const manual = readJson(path.join(dir, 'manifest.json')).failures;
  assert.deepEqual(manual.map(({ fingerprint: f, category, progress, passed, failed }) => [f, category, progress, passed, failed]),
    m.failures.map(({ fingerprint: f, category, progress, passed, failed }) => [f, category, progress, passed, failed]));
  // The one recovery advice (no new JEV call) gets the failure state; the retry gets the last record.
  assert.deepEqual(asked.map((q) => q.point), ['intake', 'recovery']);
  assert.match(asked[1].state, new RegExp(`fingerprint ${m.failures[1].fingerprint}, progress none, seen 2x`));
  assert.deepEqual(a.calls.find((c) => c.role === 'sonnet-retry').failure, m.failures[1]);
  assert.deepEqual(a.calls.find((c) => c.role === 'fix-tests').failure, m.failures[0]);
  assert.equal(m.metrics.repeatedFailures[0].count, 2);
});

test('2272 AC5 shared: a blocked auto run records hand-back failures and still writes metrics', async () => {
  const a = fakeAgent({ plan: '' });
  const deps = baseDeps({ agent: a.agent, ...fakeTests() });
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, CONDITIONS.planFailedTwice);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.deepEqual(m.failures.map((f) => [f.kind, f.stage, f.attempt, f.category, f.progress]), [['plan', '02-plan', '1', 'handback-empty', 'first'], ['plan', '02-plan', '2', 'handback-empty', 'none']]);
  assert.equal(m.failures[0].fingerprint, failureRecord({ kind: 'plan', text: 'empty output' }).fingerprint);
  assert.deepEqual(res.metrics.attempts, { plan: 2, review: 0, fixRounds: 0 });
  assert.ok(res.metrics.missing.includes('attempts.tests'));
  assert.deepEqual(m.metrics, res.metrics);
  // Invalid re-reviews are review failures of stage 06-fix.
  const r = fakeAgent({ review: JSON.stringify([MAJOR]), 're-review': 'not json' });
  const d2 = baseDeps({ agent: r.agent, ...fakeTests() });
  assert.equal((await runAuto(d2)).condition, CONDITIONS.reviewFailedTwice);
  const f2 = readJson(path.join(d2.runDir, 'manifest.json')).failures;
  assert.deepEqual(f2.map((f) => [f.kind, f.stage, f.attempt, f.category]), [['review', '06-fix', 're-review-1-1', 'handback-format'], ['review', '06-fix', 're-review-1-2', 'handback-format']]);
  // A halt before any manifest: metrics list every measurement as missing.
  const pre = baseDeps({ gitClean: () => false, agent: fakeAgent().agent, ...fakeTests() });
  const r3 = await runAuto(pre);
  assert.equal(r3.metrics.missing.length, 8);
});

test('2272 AC5 shared: CLI gate and round record failures the same way', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'cli', tool: 'haiku-build', status: 'INTAKE', task: 't', opusCalls: [], phases: [], haiku: {}, auto: { fixRounds: 1 }, review: { status: 'done', findings: [{ ...MAJOR, resolution: 'open' }] } }));
  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(bad, 'no headings');
  const g = node(AUTO_CLI, 'gate', 'plan', dir, bad);
  assert.equal(g.json.action, 'retry');
  assert.equal(g.json.failure.category, 'handback-format');
  fs.writeFileSync(bad, 'not json');
  const r = node(AUTO_CLI, 'round', dir, '--re-review', bad);
  assert.equal(r.json.action, 'retry');
  const f = readJson(path.join(dir, 'manifest.json')).failures;
  assert.deepEqual(f.map((x) => [x.kind, x.stage, x.category]), [['plan', '02-plan', 'handback-format'], ['review', '06-fix', 'handback-format']]);
  assert.equal(f[0].fingerprint, fingerprint('missing heading: Goal & Intent, Tasks & Acceptance Criteria, Red Checks, Verification'));
});

test('2272 AC5 semantics: auto asks zero questions; ladder, gates and statuses are unchanged', async () => {
  const a = fakeAgent({ plan: SPEC_MAPPED });
  const t = fakeTests([false]);
  const deps = baseDeps({ agent: a.agent, runTests: t.runTests });
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, CONDITIONS.ladder);
  assert.deepEqual(t.runs.map((x) => x.attempt), LADDER.map((x) => x.attempt));
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.auto.questionsAsked, 0);
  assert.equal(a.calls.some((c) => /question|ask/i.test(c.role)), false);
  assert.equal(m.failures.length, 4);
  assert.deepEqual(m.failures.map((f) => f.progress), ['first', 'none', 'none', 'none']);
});

test('2272 AC5 semantics: manual docs keep their interaction points and name the shared v3 helpers', () => {
  const read = (...p) => fs.readFileSync(path.join(HB, ...p), 'utf8');
  const skill = read('SKILL.md');
  assert.match(skill, /# haiku-build \(v3\)/);
  assert.match(skill, /switch main session to Sonnet\?/);
  assert.match(skill, /\[R\] retry/);
  assert.match(skill, /blocking questions/i);
  for (const s of ['ac_map.mjs', 'failure.mjs', 'context_bundle.mjs', 'run_metrics.mjs']) assert.ok(skill.includes(s), s);
  const step02 = read('steps', 'step-02-plan.md');
  assert.match(step02, /\[R\] retry/);
  assert.match(step02, /Blocking questions/);
  assert.match(step02, /context_bundle\.mjs/);
  assert.match(step02, /ac-unmapped/);
  assert.match(read('steps', 'step-04-test.md'), /failure\.mjs|--log/);
  assert.match(read('steps', 'step-05-review.md'), /context_bundle\.mjs/);
  assert.match(read('steps', 'step-07-present.md'), /Run metrics/);
  assert.match(read('templates', 'spec.md'), /target: .*verify:/);
  assert.match(read('prompts', 'plan-opus.md'), /target:.*verify:/);
  assert.match(read('prompts', 'review.md'), /context bundle/i);
  const schema = JSON.parse(read('schemas', 'haiku-build-manifest.schema.json'));
  for (const k of ['acMap', 'failures', 'contextBundle', 'metrics']) assert.ok(schema.properties[k], k);
  assert.ok(schema.properties.attempts.items.properties.passed);
  const auto = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(auto, /Never ask the user anything/);
  assert.match(auto, /v3/);
});
