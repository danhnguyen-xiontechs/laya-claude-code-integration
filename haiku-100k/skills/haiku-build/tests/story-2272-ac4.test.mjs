// Story 2272 AC4: runMetrics and the report list stage ms, attempts, test outcomes and repeats; open windows are not measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMetrics } from '../scripts/v3.mjs';
import { renderHtml } from '../scripts/build_report.mjs';

const T0 = '2026-10-22T10:00:00.000Z';
const T1 = '2026-10-22T10:00:05.000Z';
const T2 = '2026-10-22T10:00:09.000Z';
const base = { schemaVersion: 1, runId: 'ac4', tool: 'haiku-build', task: 't', opusCalls: [], haiku: {} };

test('2272 AC4 report lists run metrics', () => {
  const done = {
    ...base, status: 'REPORTED', finalStatus: 'done',
    phases: [{ phase: '02-plan', from: T0, to: T1 }, { phase: '03-implement', from: T1, to: T2 }],
    attempts: [{ attempt: 'T1', model: 'haiku', ok: false }, { attempt: 'T2', model: 'haiku', ok: true }],
    tests: { passed: 3, failed: 0 },
    diagnostics: [{ attempt: 'T1', fingerprint: 'abc', repeated: true }],
  };
  const m = runMetrics(done);
  assert.deepEqual(m.stages.map((s) => [s.phase, s.ms]), [['02-plan', 5000], ['03-implement', 4000]]);
  assert.equal(m.attempts.total, 2);
  assert.equal(m.attempts.failed, 1);
  assert.deepEqual(m.tests, { passed: 3, failed: 0 });
  assert.equal(m.repeats, 1);

  const html = renderHtml(done, {});
  assert.match(html, /Run metrics/);
  assert.match(html, /5000/);

  const blocked = {
    ...base, status: 'INCOMPLETE', finalStatus: 'blocked',
    phases: [{ phase: '04-test', from: T0 }],
    attempts: [{ attempt: 'T1', model: 'haiku', ok: false }],
    tests: null,
  };
  const bm = runMetrics(blocked);
  assert.equal(bm.stages[0].ms, null);
  assert.equal(bm.tests, null);
  const bhtml = renderHtml(blocked, {});
  assert.match(bhtml, /Run metrics/);
  assert.match(bhtml, /not measured/);
});

test('2272 AC4 report uses stored manifest metrics instead of recomputing', () => {
  const stored = {
    stages: [{ phase: '05-review', ms: 7777 }],
    attempts: { total: 4, failed: 3, byModel: { haiku: 3, sonnet: 1 } },
    tests: { passed: 9, failed: 0 },
    repeats: 2,
  };
  const m = { ...base, status: 'REPORTED', phases: [{ phase: '02-plan', from: T0, to: T1 }], attempts: [], metrics: stored };
  const html = renderHtml(m, {});
  assert.match(html, /05-review<\/td><td>7777/);
  assert.doesNotMatch(html, /02-plan<\/td><td>5000/);
  assert.match(html, /Repeated failure fingerprints: 2/);
});

test('2272 AC4 capDiff is shared from v3.mjs and re-exported by build_report.mjs', async () => {
  const v3 = await import('../scripts/v3.mjs');
  const br = await import('../scripts/build_report.mjs');
  assert.equal(br.capDiff, v3.capDiff);
  assert.equal(br.DIFF_MAX_BYTES, v3.DIFF_MAX_BYTES);
});
