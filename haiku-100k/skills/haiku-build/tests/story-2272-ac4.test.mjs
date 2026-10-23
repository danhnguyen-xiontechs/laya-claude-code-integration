// Story 2272 AC4: renderHtml on a manifest with no phase `to` and no `tests` renders without "NaN" or
// "undefined" and leaves those rows out of the Run metrics section; repeated failures are listed; unmapped ACs
// are marked as not evidence in the AC traceability section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMetrics, renderHtml, measure } from '../scripts/build_report.mjs';

function section(html, title) {
  const start = html.indexOf(`<h2>${title}</h2>`);
  assert.notEqual(start, -1, `missing section ${title}`);
  const rest = html.slice(start + `<h2>${title}</h2>`.length);
  const end = rest.indexOf('<h2>');
  return end === -1 ? rest : rest.slice(0, end);
}

test('2272 AC4 missing: a phase with no to, or an invalid date, gives ms null and a valid phase gives its ms', () => {
  const m = runMetrics({
    phases: [
      { phase: 'plan', from: '2026-10-23T10:00:00Z' },
      { phase: 'build', from: 'not-a-date', to: '2026-10-23T10:00:00Z' },
      { phase: 'test', from: '2026-10-23T10:00:00Z', to: '2026-10-23T10:00:30Z' },
    ],
    attempts: [],
  });
  const byPhase = Object.fromEntries(m.stages.map((s) => [s.phase, s.ms]));
  assert.equal(byPhase.plan, null);
  assert.equal(byPhase.build, null);
  assert.equal(byPhase.test, 30000);
});

test('2272 AC4 missing: runMetrics with no tests, no phases and no trace gives null for each and does not throw', () => {
  const m = runMetrics({});
  assert.deepEqual(m.stages, []);
  assert.equal(m.tests, null);
  assert.equal(m.trace, null);
  assert.deepEqual(m.repeatedFailures, []);
  assert.equal(m.attempts.total, 0);
});

test('2272 AC4 missing: renderHtml with no phase to and no tests has no NaN or undefined and omits those rows', () => {
  const html = renderHtml({
    runId: 'r',
    task: 'add trace',
    attempts: [{ attempt: 'T1', ok: true }],
    phases: [{ phase: 'plan', from: '2026-10-23T10:00:00Z' }],
  }, null);
  assert.doesNotMatch(html, /NaN/);
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /<h2>Run metrics<\/h2>/);
  const metrics = section(html, 'Run metrics');
  assert.doesNotMatch(metrics, /<td>plan<\/td>/);
  assert.doesNotMatch(metrics, /NaN|undefined/);
});

test('2272 AC4 missing: repeated failures are listed in Run metrics with their fingerprint and count', () => {
  const diagnostics = [
    { stage: 'test', attempt: 'T1', fingerprint: 'abc123def456', category: 'assertion', failed: 1, progress: 'first', repeatCount: 1, at: 'x' },
    { stage: 'test', attempt: 'T2', fingerprint: 'abc123def456', category: 'assertion', failed: 1, progress: 'repeated', repeatCount: 2, at: 'x' },
    { stage: 'test', attempt: 'T3', fingerprint: 'ffff00001111', category: 'timeout', failed: 1, progress: 'first', repeatCount: 1, at: 'x' },
  ];
  const m = runMetrics({ diagnostics, attempts: [] });
  assert.deepEqual(m.repeatedFailures, [{ fingerprint: 'abc123def456', category: 'assertion', count: 2 }]);
  const html = renderHtml({ runId: 'r', diagnostics, attempts: [] }, null);
  const metrics = section(html, 'Run metrics');
  assert.match(metrics, /abc123def456/);
  assert.doesNotMatch(metrics, /ffff00001111/);
});

test('2272 AC4 missing: AC traceability marks an unmapped AC as UNMAPPED, not evidence', () => {
  const trace = {
    acs: [{ id: 'AC1', text: 'flag works', status: 'unmapped', target: null, verify: null, missing: ['target', 'verify'] }],
    mapped: 0, unmapped: ['AC1'], ok: false,
  };
  const html = renderHtml({ runId: 'r', trace, attempts: [] }, null);
  const traceSection = section(html, 'AC traceability');
  assert.match(traceSection, /AC1/);
  assert.match(traceSection, /UNMAPPED.*not evidence/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('2272 AC4 missing: runMetrics trace is null without a manifest trace and has mapped and unmapped counts with one', () => {
  assert.equal(runMetrics({ attempts: [] }).trace, null);
  const m = runMetrics({ attempts: [], trace: { acs: [], mapped: 2, unmapped: ['AC3'], ok: false } });
  assert.deepEqual(m.trace, { mapped: 2, unmapped: 1 });
});

test('2272 AC4 missing: measure adds metrics and keeps status and haiku fields', () => {
  const out = measure({ runId: 'r', attempts: [{ attempt: 'T1', ok: true }], phases: [] }, {
    haiku: { request_count: 1, requests_over_100k: 0 },
  });
  assert.equal(out.haiku.haiku_request_count, 1);
  assert.equal(typeof out.status, 'string');
  assert.ok(Array.isArray(out.metrics.stages));
  assert.equal(out.metrics.attempts.total, 1);
});
