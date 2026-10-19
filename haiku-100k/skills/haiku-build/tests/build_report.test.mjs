import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  wordCount, checkOpusOutput, checkReviewJson, checkSpecSections, capDiff, runStatus, renderHtml, measure,
} from '../scripts/build_report.mjs';

const words = (n) => Array(n).fill('word').join(' ');
const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'spec.md');

test('spec must keep the four required headings', () => {
  const ok = '## 1. Goal & Intent\nx\n## 6. Tasks & Acceptance Criteria\nx\n## 7. Red Checks\nx\n## 8. Verification\nx\n';
  assert.equal(checkSpecSections(ok).ok, true);
  const noVerify = ok.replace('## 8. Verification\nx\n', '');
  const r = checkSpecSections(noVerify);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['Verification']);
  assert.match(r.reason, /Verification/);
  assert.equal(checkSpecSections('Goal & Intent without a heading').ok, false);
});

test('spec template has the nine sections in order and passes its own check', () => {
  const text = fs.readFileSync(templatePath, 'utf8');
  const headings = text.split('\n').filter((l) => /^## \d\./.test(l));
  assert.equal(headings.length, 9);
  assert.deepEqual(headings.map((h) => Number(h.slice(3, 4))), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(checkSpecSections(text).ok, true);
});

test('report lists blocking-question answers under Decisions', () => {
  const html = renderHtml({ runId: 'r', planAnswers: [{ question: 'Keep v1 API?', answer: 'yes', section: '6' }] }, null);
  assert.match(html, /<h2>Decisions<\/h2>/);
  assert.match(html, /Keep v1 API\?/);
  assert.match(renderHtml({ runId: 'r' }, null), /No blocking questions were asked/);
});

test('800 words pass the Opus output limit, 801 fail', () => {
  assert.equal(wordCount(words(800)), 800);
  assert.equal(checkOpusOutput(words(800)).ok, true);
  const over = checkOpusOutput(words(801));
  assert.equal(over.ok, false);
  assert.match(over.reason, /801/);
});

test('review output must be a JSON array of complete findings', () => {
  const good = '[{"severity":"Minor","lens":"blind-hunter","finding":"x","ref":"a.mjs:1","resolution":"open"}]';
  assert.equal(checkReviewJson(good).ok, true);
  assert.equal(checkReviewJson('[]').ok, true);
  assert.equal(checkReviewJson('```json\n[]\n```').ok, true);
  assert.equal(checkReviewJson('not json').ok, false);
  assert.equal(checkReviewJson('{"a":1}').ok, false);
  assert.equal(checkReviewJson('[{"severity":"Huge","finding":"x","ref":"a"}]').ok, false);
  assert.equal(checkReviewJson('[{"severity":"Minor","finding":"x"}]').ok, false);
});

test('capDiff keeps whole files and names the omitted ones', () => {
  const a = 'diff --git a/a.mjs b/a.mjs\n+one\n';
  const b = 'diff --git a/b.mjs b/b.mjs\n' + '+x\n'.repeat(50);
  const cap = capDiff(a + b, { maxBytes: 100, maxLines: 1500 });
  assert.equal(cap.text, a);
  assert.deepEqual(cap.omitted, ['b.mjs']);
  assert.equal(cap.truncated, true);
  assert.equal(capDiff(a).truncated, false);
});

test('runStatus follows the failure order', () => {
  assert.equal(runStatus({ planFailed: true, tests: { failed: 2 } }), 'PLAN_FAILED');
  assert.equal(runStatus({ tests: { failed: 1 } }), 'TESTS_FAIL');
  assert.equal(runStatus({ tests: { failed: 0 }, review: { status: 'skipped' } }), 'REVIEW_SKIPPED');
  assert.equal(runStatus({ decision: 'fix_and_report' }), 'FIXED');
  assert.equal(runStatus({ decision: 'not_approved_report' }), 'REPORTED');
});

test('report shows a skipped review as not independently reviewed', () => {
  const html = renderHtml({ runId: 'r', review: { status: 'skipped' }, tests: { passed: 1, failed: 0 } }, null);
  assert.match(html, /not independently reviewed/);
});

test('report shows missing usage as "not measured", never 0', () => {
  const u = { phases: [{ phase: '02-plan', turns: null, byClass: null, opusCalls: null }], unassigned: null, overlaps: [], haiku: {} };
  const html = renderHtml({ runId: 'r', haiku: { input_limit_verification: 'not_measured' } }, u);
  assert.match(html, /not measured/);
  assert.match(html, /not_measured/);
});

test('report lists the findings table', () => {
  const m = { runId: 'r', review: { status: 'done', findings: [{ severity: 'Major', lens: 'verification-gap', finding: 'no test for X', ref: 'a.mjs:3', resolution: 'open' }] } };
  const html = renderHtml(m, null);
  assert.match(html, /no test for X/);
  assert.match(html, /a\.mjs:3/);
});

test('runStatus: a run with no decision yet is INCOMPLETE, not REPORTED', () => {
  assert.equal(runStatus({ review: { status: 'done', findings: [] }, tests: { failed: 0 } }), 'INCOMPLETE');
  assert.equal(runStatus({ decision: 'not_approved_report', tests: { failed: 0 } }), 'REPORTED');
  assert.equal(runStatus({ decision: 're_verify_only', tests: { failed: 0 } }), 'REPORTED');
  assert.equal(runStatus({ review: { status: 'skipped' }, tests: { failed: 0 } }), 'REVIEW_SKIPPED');
});

test('report shows the resolution reason next to the resolution', () => {
  const m = { runId: 'r', review: { status: 'done', findings: [
    { severity: 'Minor', lens: 'edge-case-hunter', finding: 'casing', ref: 'a.cs:9', resolution: 'rejected', reason: 'dictionary is case-insensitive (a.cs:4)' },
    { severity: 'Minor', lens: 'verification-gap', finding: 'no test', ref: 'b.cs:1', resolution: 'fixed' },
  ] } };
  const html = renderHtml(m, null);
  assert.match(html, /rejected: dictionary is case-insensitive \(a\.cs:4\)/);
  assert.match(html, /<td>fixed<\/td>/);
});

test('schema allows only open, fixed or rejected as a resolution', () => {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'haiku-build-manifest.schema.json');
  const text = fs.readFileSync(schemaPath, 'utf8');
  assert.match(text, /"resolution": \{ "enum": \["open", "fixed", "rejected"\] \}/);
});

test('measure fills the Haiku fields from usage and sets the status', () => {
  const m = measure({ runId: 'r', decision: 'fix_and_report', tests: { failed: 0 } }, {
    haiku: { request_count: 3, requests_over_100k: 0, max_haiku_input_tokens: 64000, input_limit_verification: 'pass' },
  });
  assert.equal(m.status, 'FIXED');
  assert.equal(m.haiku.haiku_request_count, 3);
  assert.equal(m.haiku.haiku_requests_over_100k, 0);
  assert.equal(m.haiku.max_haiku_input_tokens, 64000);
});
