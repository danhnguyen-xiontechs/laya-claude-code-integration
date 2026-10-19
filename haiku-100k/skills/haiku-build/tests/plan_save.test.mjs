// FIXTURE TEST for the plan save path (savePlanSpec). The spec texts below are hand-written stand-ins, NOT Opus output.
// This proves that a returned text is checked, written to spec.md only when it passes, and recorded in opusCalls
// with a hash. It is not evidence that a real Opus call works: that is the rerun of case 1 with a real plan call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { savePlanSpec } from '../scripts/build_report.mjs';

const HEADINGS = ['## 1. Goal & Intent', '## 6. Tasks & Acceptance Criteria', '## 7. Red Checks', '## 8. Verification'];
const fixtureSpec = (extra = '') => [...HEADINGS.map((h) => `${h}\n\nFixture body.\n`), extra].join('\n');

function runDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-plan-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, runId: 'plan-save-fixture', tool: 'haiku-build', status: 'INTAKE', task: 'fixture',
    opusCalls: [], phases: [], haiku: {},
  }, null, 2));
  return dir;
}
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('fixture: a passing text is written to spec.md, status PLANNED, call recorded with its sha256', () => {
  const dir = runDir();
  const text = fixtureSpec();
  const r = savePlanSpec(dir, text, { attempt: 1 });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(dir, 'spec.md'), 'utf8'), text.trim() + '\n');
  const m = readManifest(dir);
  assert.equal(m.status, 'PLANNED');
  assert.equal(m.opusCalls.length, 1);
  assert.deepEqual(
    { step: m.opusCalls[0].step, attempt: m.opusCalls[0].attempt, ok: m.opusCalls[0].ok, reason: m.opusCalls[0].reason },
    { step: '02-plan', attempt: 1, ok: true, reason: null },
  );
  assert.equal(m.opusCalls[0].sha256, crypto.createHash('sha256').update(text.trim()).digest('hex'));
});

test('fixture: empty output is a failed call, writes no spec.md, leaves status alone', () => {
  const dir = runDir();
  const r = savePlanSpec(dir, '   \n', { attempt: 1 });
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'spec.md')), false);
  const m = readManifest(dir);
  assert.equal(m.status, 'INTAKE');
  assert.equal(m.opusCalls[0].ok, false);
  assert.equal(m.opusCalls[0].reason, 'empty output');
  assert.equal(m.opusCalls[0].sha256, null);
});

test('fixture: a missing required heading fails and names the heading', () => {
  const dir = runDir();
  const text = fixtureSpec().replace('## 7. Red Checks', '## Red');
  const r = savePlanSpec(dir, text, { attempt: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /missing heading: Red Checks/);
  assert.equal(fs.existsSync(path.join(dir, 'spec.md')), false);
});

test('fixture: over 800 words fails, nothing is cut', () => {
  const dir = runDir();
  const long = fixtureSpec(Array(820).fill('word').join(' '));
  const r = savePlanSpec(dir, long, { attempt: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^over 800 words/);
  assert.equal(fs.existsSync(path.join(dir, 'spec.md')), false);
});

test('fixture: a retry after a failed call is appended, not overwritten', () => {
  const dir = runDir();
  savePlanSpec(dir, '', { attempt: 1 });
  const r = savePlanSpec(dir, fixtureSpec(), { attempt: 2 });
  assert.equal(r.ok, true);
  const m = readManifest(dir);
  assert.deepEqual(m.opusCalls.map((c) => [c.attempt, c.ok]), [[1, false], [2, true]]);
});
