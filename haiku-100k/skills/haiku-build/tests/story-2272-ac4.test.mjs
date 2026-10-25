// Story 2272 AC4: the report of a completed or blocked run carries per-stage durations, attempt counts, test
// outcomes and repeated failures; data the run does not hold is left out and named, never invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageDurations, runMetrics } from '../scripts/run_metrics.mjs';
import { measure, renderHtml } from '../scripts/build_report.mjs';
import { recordFailure } from '../scripts/failure.mjs';
import { acMap } from '../scripts/ac_map.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const PHASES = [
  { phase: '02-plan', from: '2026-10-23T10:00:00.000Z', to: '2026-10-23T10:01:30.000Z' },
  { phase: '04-test', from: '2026-10-23T10:05:00.000Z', to: '2026-10-23T10:05:10.000Z' },
  { phase: '06-fix', from: '2026-10-23T10:06:00.000Z', to: '2026-10-23T10:06:20.000Z' },
  { phase: '04-test', from: '2026-10-23T10:07:00.000Z', to: '2026-10-23T10:07:05.000Z' },
];
const FAIL_LOG = 'not ok 1 - flag\n  error: \'Expected values to be strictly equal\'\n  location: \'/tmp/a/x.test.mjs:3:1\'\n# pass 2\n# fail 1\n';

function fullManifest() {
  const m = {
    runId: 'ac4', decision: 'fix_and_report', phases: PHASES,
    opusCalls: [{ step: '02-plan', attempt: 1, ok: false }, { step: '02-plan', attempt: 2, ok: true }, { step: '04-review', attempt: 1, ok: true }],
    attempts: [{ attempt: 'T1', model: 'haiku', ok: false, passed: 2, failed: 1 }, { attempt: 'T2', model: 'haiku', ok: true, passed: 3, failed: 0 }],
    tests: { command: 'node --test t.mjs', passed: 3, failed: 0 },
    auto: { fixRounds: 1 },
    acMap: acMap('- AC1: x — target: `a.mjs`; verify: `node --test t.mjs`\n- AC2: y\n'),
  };
  recordFailure(m, { kind: 'plan', attempt: 1, text: 'empty output' });
  recordFailure(m, { kind: 'test', attempt: 'T1', text: FAIL_LOG });
  return m;
}

test('2272 AC4 report: per-stage durations sum the windows of a stage', () => {
  assert.deepEqual(stageDurations(PHASES), { '02-plan': 90_000, '04-test': 15_000, '06-fix': 20_000 });
  assert.deepEqual(stageDurations([{ phase: '05-review', from: '2026-10-23T10:00:00Z' }]), { '05-review': null });
  assert.deepEqual(stageDurations([{ phase: '05-review', from: 'garbage', to: '2026-10-23T10:00:00Z' }, { phase: '05-review', from: '2026-10-23T10:00:00Z', to: '2026-10-23T10:00:01Z' }]), { '05-review': null });
});

test('2272 AC4 report: metrics carry durations, attempt counts and test outcomes', () => {
  const met = runMetrics(fullManifest());
  assert.deepEqual(met.stages, { '02-plan': 90_000, '04-test': 15_000, '06-fix': 20_000 });
  assert.deepEqual(met.attempts, { tests: 2, plan: 2, review: 1, fixRounds: 1 });
  assert.deepEqual(met.tests.final, { command: 'node --test t.mjs', passed: 3, failed: 0 });
  assert.deepEqual(met.tests.runs, [{ attempt: 'T1', ok: false, passed: 2, failed: 1 }, { attempt: 'T2', ok: true, passed: 3, failed: 0 }]);
  assert.equal(met.failures, 2);
  assert.deepEqual(met.acs, { total: 2, pass: 1, fail: 0, not_run: 0, unmapped: 1 });
  assert.deepEqual(met.missing, []);
});

test('2272 AC4 report: measure stores manifest.metrics and the report shows a Run metrics section', () => {
  const m = measure(fullManifest(), { haiku: {} });
  assert.deepEqual(m.metrics.attempts, { tests: 2, plan: 2, review: 1, fixRounds: 1 });
  const html = renderHtml(m, null);
  assert.match(html, /<h2>Run metrics<\/h2>/);
  assert.match(html, /<tr><td>02-plan<\/td><td>90\.0 s<\/td><\/tr>/);
  assert.match(html, /Attempts: tests 2, plan 2, review 1, fix rounds 1\./);
  assert.match(html, /Final tests: 3 passed, 0 failed\./);
  assert.match(html, /Test runs: T1 fail \(2 passed, 1 failed\), T2 pass \(3 passed, 0 failed\)\./);
});

test('2272 AC4 report: build_report.mjs CLI on a blocked run writes metrics to manifest and report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac4-'));
  const m = { ...fullManifest(), schemaVersion: 1, tool: 'haiku-build', status: 'TESTS_FAIL', task: 't', transcript: null, haiku: {}, finalStatus: 'blocked', finalReason: 'tests still fail', tests: { command: 'node --test t.mjs', passed: 2, failed: 1 } };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'build_report.mjs'), dir], { encoding: 'utf8', env: { ...process.env, HOME: dir, USERPROFILE: dir } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(out.metrics.tests.final, { command: 'node --test t.mjs', passed: 2, failed: 1 });
  assert.deepEqual(out.metrics.acs, { total: 2, pass: 0, fail: 1, not_run: 0, unmapped: 1 });
  assert.match(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), /<h2>Run metrics<\/h2>/);
});

test('2272 AC4 repeated: a fingerprint seen twice is listed as a repeated failure in metrics and report', () => {
  const m = fullManifest();
  recordFailure(m, { kind: 'test', attempt: 'T2', text: FAIL_LOG.replace('/tmp/a/', 'C:\\w\\').replace(':3:1', ':9:4') });
  const met = runMetrics(m);
  assert.equal(met.repeatedFailures.length, 1);
  assert.deepEqual([met.repeatedFailures[0].count, met.repeatedFailures[0].kind, met.repeatedFailures[0].category, met.repeatedFailures[0].attempts], [2, 'test', 'assertion', ['T1', 'T2']]);
  const html = renderHtml(measure(m, { haiku: {} }), null);
  assert.match(html, /Repeated failures \(same fingerprint twice or more\)/);
  assert.ok(html.includes(`<td>${met.repeatedFailures[0].fingerprint}</td><td>test</td><td>assertion</td><td>2</td><td>T1, T2</td>`));
  assert.deepEqual(runMetrics(fullManifest()).repeatedFailures, []);
});

test('2272 AC4 repeated: missing data is left out and named under missing, without throwing', () => {
  const met = runMetrics({});
  assert.deepEqual(met.missing, ['stages', 'attempts.tests', 'attempts.plan', 'attempts.review', 'tests.final', 'tests.runs', 'failures', 'acs']);
  for (const k of ['stages', 'attempts', 'tests', 'acs', 'repeatedFailures']) assert.equal(k in met, false, k);
  assert.deepEqual(runMetrics(undefined).missing.length, 8);
  const html = renderHtml({ runId: 'bare' }, null);
  assert.match(html, /Not available \(left out\): stages, attempts\.tests/);
  assert.doesNotMatch(html, /Attempts: tests/);
  // An open window is not a duration: it is null, shown as "not measured", never 0.
  const open = runMetrics({ phases: [{ phase: '07-present', from: '2026-10-23T10:00:00Z' }] });
  assert.deepEqual(open.stages, { '07-present': null });
  assert.match(renderHtml({ runId: 'o', phases: [{ phase: '07-present', from: '2026-10-23T10:00:00Z' }] }, null), /<td>07-present<\/td><td>not measured<\/td>/);
  const cli = spawnSync(process.execPath, [path.join(SCRIPTS, 'run_metrics.mjs'), path.join(os.tmpdir(), 'no-such-run-2272')], { encoding: 'utf8' });
  assert.equal(cli.status, 1);
});
