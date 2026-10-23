// Story 2272 AC1: each AC maps to its implementation target and its verification. An unmapped AC is flagged,
// kept, and never counts as evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAcs, buildTrace, traceEvidence } from '../scripts/trace.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'scripts', 'trace.mjs');

const MAPPED_SPEC = [
  '## 6. Tasks & Acceptance Criteria',
  '1. **New: `haiku-build/scripts/trace.mjs`**',
  '   - `parseAcs(specText)`',
  '',
  'Acceptance criteria:',
  '- AC1: `buildTrace` maps each AC to `scripts/trace.mjs`. Checked by `story-2272-ac1.test.mjs` "2272 AC1 mapped".',
  '',
  '## 7. Red Checks',
].join('\n');

test('2272 AC1 parseAcs: reads only "- AC<n>:" lines and returns id and text', () => {
  const spec = '## 6. Tasks & Acceptance Criteria\n- AC1: first one\nnot an AC line\n- AC2: second one\n## 7. Red Checks\n- AC9: outside section six\n';
  assert.deepEqual(parseAcs(spec), [{ id: 'AC1', text: 'first one' }, { id: 'AC2', text: 'second one' }]);
});

test('2272 AC1 mapped: an AC with a target and a verification gets status mapped', () => {
  const t = buildTrace(MAPPED_SPEC);
  assert.equal(t.ok, true);
  assert.equal(t.mapped, 1);
  assert.deepEqual(t.unmapped, []);
  const [ac] = t.acs;
  assert.equal(ac.status, 'mapped');
  assert.equal(ac.target, 'scripts/trace.mjs');
  assert.equal(ac.verify, 'story-2272-ac1.test.mjs "2272 AC1 mapped"');
  assert.deepEqual(ac.missing, []);
});

test('2272 AC1 unmapped: "- AC1: flag works" is flagged with both target and verify missing', () => {
  const t = buildTrace('## 6. Tasks & Acceptance Criteria\n- AC1: flag works\n');
  assert.equal(t.acs[0].status, 'unmapped');
  assert.deepEqual(t.acs[0].missing, ['target', 'verify']);
  assert.deepEqual(t.unmapped, ['AC1']);
  assert.equal(t.ok, false);
});

test('2272 AC1 unmapped: a test path alone is never a target, so the AC is unmapped without a target', () => {
  const t = buildTrace('## 6. Tasks & Acceptance Criteria\n- AC1: it works. Checked by `x.test.mjs`.\n');
  assert.equal(t.acs[0].status, 'unmapped');
  assert.deepEqual(t.acs[0].missing, ['target']);
});

test('2272 AC1 unmapped: traceEvidence never gives an unmapped AC pass, even with green tests', () => {
  const t = buildTrace('## 6. Tasks & Acceptance Criteria\n- AC1: flag works\n');
  assert.deepEqual(traceEvidence(t, { passed: 9, failed: 0 }), [{ id: 'AC1', evidence: 'unmapped' }]);
});

test('2272 AC1 evidence: a mapped AC is pass only with passed > 0 and failed 0, fail with failures, else not run', () => {
  const t = buildTrace(MAPPED_SPEC);
  assert.deepEqual(traceEvidence(t, { passed: 3, failed: 0 }), [{ id: 'AC1', evidence: 'pass' }]);
  assert.deepEqual(traceEvidence(t, { passed: 3, failed: 1 }), [{ id: 'AC1', evidence: 'fail' }]);
  assert.deepEqual(traceEvidence(t, { passed: 0, failed: 0 }), [{ id: 'AC1', evidence: 'not run' }]);
  assert.deepEqual(traceEvidence(t, null), [{ id: 'AC1', evidence: 'not run' }]);
});

test('2272 AC1 target fallback: a task line naming the AC id supplies the target', () => {
  const spec = [
    '## 6. Tasks & Acceptance Criteria',
    '2. **Diagnostics**',
    '   - `scripts/diagnostics.mjs` records the failure for AC2',
    '- AC2: failures get a fingerprint. Checked by `story-2272-ac2.test.mjs`.',
  ].join('\n');
  const [ac] = buildTrace(spec).acs;
  assert.equal(ac.target, 'scripts/diagnostics.mjs');
  assert.equal(ac.status, 'mapped');
});

test('2272 AC1 no ACs: a spec without acceptance criteria gives acs [], ok false and a reason', () => {
  assert.deepEqual(buildTrace('## 6. Tasks & Acceptance Criteria\n- just a task\n'), {
    acs: [], mapped: 0, unmapped: [], ok: false, reason: 'no acceptance criteria',
  });
});

test('2272 AC1 CLI: trace.mjs <runDir> writes manifest.trace and prints one JSON line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac1-'));
  fs.writeFileSync(path.join(dir, 'spec.md'), MAPPED_SPEC + '\n');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ runId: 'r' }));
  const run = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { ok: true, total: 1, mapped: 1, unmapped: 0 });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.trace.acs[0].status, 'mapped');
});

test('2272 AC1 unmapped CLI failure: a run without spec.md exits 1 with a JSON error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac1-'));
  const run = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(JSON.parse(run.stdout.trim()).error, /spec\.md/);
});
