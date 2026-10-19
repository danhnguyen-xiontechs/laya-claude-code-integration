// FIXTURE TEST for the review save path (saveReview) and the save_opus.mjs CLI. The texts are hand-written
// stand-ins, NOT Opus output: they prove the checks, files and opusCalls entry, not a real Opus call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveReview, wordCount } from '../scripts/build_report.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'save_opus.mjs');

function runDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-review-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, runId: 'review-save-fixture', tool: 'haiku-build', status: 'TESTS_PASS', task: 'fixture',
    opusCalls: [], phases: [], haiku: {},
  }, null, 2));
  return dir;
}
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const REVIEW = '[{"severity":"Minor","lens":"verification-gap","finding":"no test for the empty case","ref":"a.cs:3","resolution":"open"}]';

test('fixture: a valid review is saved raw and parsed, with measured words (never 0 for real text)', () => {
  const dir = runDir();
  const r = saveReview(dir, REVIEW);
  assert.equal(r.ok, true);
  assert.equal(r.findings, 1);
  const m = readManifest(dir);
  assert.equal(m.status, 'REVIEWED');
  assert.equal(m.review.findings[0].resolution, 'open');
  const call = m.opusCalls.at(-1);
  assert.equal(call.step, '04-review');
  assert.equal(call.words, wordCount(REVIEW));
  assert.ok(call.words > 0);
  assert.match(call.sha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(path.join(dir, 'evidence', 'review-raw.json'), 'utf8'), REVIEW + '\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'evidence', 'review.json'), 'utf8')).length, 1);
});

test('fixture: an empty review array is a valid review with no findings', () => {
  const dir = runDir();
  const r = saveReview(dir, '[]');
  assert.equal(r.ok, true);
  assert.equal(readManifest(dir).review.findings.length, 0);
});

test('fixture: prose instead of JSON is a failed call; raw text kept, no review recorded', () => {
  const dir = runDir();
  const r = saveReview(dir, 'Looks fine to me.');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not parseable JSON');
  const m = readManifest(dir);
  assert.equal(m.review, undefined);
  assert.equal(m.opusCalls.at(-1).ok, false);
  assert.ok(fs.existsSync(path.join(dir, 'evidence', 'review-raw.json')));
});

test('fixture: an empty hand-back is a failed call with reason "empty output"', () => {
  const dir = runDir();
  const r = saveReview(dir, '  ');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty output');
});

test('CLI: save_opus review prints one JSON line and exits 0; a bad kind exits non-zero', () => {
  const dir = runDir();
  const file = path.join(dir, 'hand-back.txt');
  fs.writeFileSync(file, REVIEW);
  const out = execFileSync(process.execPath, [CLI, 'review', dir, file], { encoding: 'utf8' });
  assert.equal(JSON.parse(out.trim()).ok, true);
  assert.equal(readManifest(dir).opusCalls.at(-1).attempt, 1);
  assert.throws(() => execFileSync(process.execPath, [CLI, 'nope', dir, file], { stdio: 'pipe' }));
});

test('CLI: a retry records the user approval and time on its opusCalls entry', () => {
  const dir = runDir();
  const file = path.join(dir, 'hand-back.txt');
  fs.writeFileSync(file, REVIEW);
  execFileSync(process.execPath, [CLI, 'review', dir, file, '--attempt', '2', '--approved-by', 'R, retry'], { encoding: 'utf8' });
  const call = readManifest(dir).opusCalls.at(-1);
  assert.equal(call.attempt, 2);
  assert.equal(call.retryApprovedBy, 'R, retry');
  assert.match(call.retryAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('CLI: a retry without --approved-by is refused and records nothing', () => {
  const dir = runDir();
  const file = path.join(dir, 'hand-back.txt');
  fs.writeFileSync(file, REVIEW);
  assert.throws(() => execFileSync(process.execPath, [CLI, 'review', dir, file, '--attempt', '2'], { stdio: 'pipe' }));
  assert.equal(readManifest(dir).opusCalls.length, 0);
});
