// Story 2272 AC3: a second getBundle with unchanged sources reuses evidence/context-bundle.json with the same
// builtAt; a changed diff.patch rebuilds it and names 'diff' as invalidated; the bundle stays within
// BUNDLE_MAX_BYTES; a corrupt or missing bundle file is rebuilt with a reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUNDLE_MAX_BYTES, sourceHashes, buildBundle, getBundle } from '../scripts/context_bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'scripts', 'context_bundle.mjs');
const BUNDLE_REL = 'evidence/context-bundle.json';

const SPEC = [
  '## 6. Tasks & Acceptance Criteria',
  '1. **New: `haiku-build/scripts/trace.mjs`**',
  '- AC1: `buildTrace` maps each AC in `scripts/trace.mjs`. Checked by `story-2272-ac1.test.mjs` "2272 AC1 mapped".',
  '',
  '## 7. Red Checks',
].join('\n');

const DIFF = [
  'diff --git a/haiku-100k/skills/haiku-build/scripts/trace.mjs b/haiku-100k/skills/haiku-build/scripts/trace.mjs',
  '--- a/haiku-100k/skills/haiku-build/scripts/trace.mjs',
  '+++ b/haiku-100k/skills/haiku-build/scripts/trace.mjs',
  '@@ -0,0 +1,2 @@',
  '+export const x = 1;',
  '',
].join('\n');

function makeRun({ diff = DIFF } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac3-'));
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ runId: 'r' }));
  fs.writeFileSync(path.join(dir, 'spec.md'), SPEC);
  fs.writeFileSync(path.join(dir, 'evidence/diff.patch'), diff);
  fs.writeFileSync(path.join(dir, 'evidence/unit-tests.log'), '# pass 1\n# fail 0\n');
  fs.writeFileSync(path.join(dir, 'evidence/review.json'), JSON.stringify({ findings: [] }));
  return dir;
}

test('2272 AC3 reuse: sourceHashes gives a sha256 hex string or null for task, spec, diff, tests and review', () => {
  const dir = makeRun();
  const h = sourceHashes(dir, { task: 'add trace' });
  for (const k of ['task', 'spec', 'diff', 'tests', 'review']) {
    assert.ok(k in h, `missing key ${k}`);
    assert.match(h[k], /^[0-9a-f]{64}$/);
  }
  const none = sourceHashes(fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac3-')), {});
  assert.equal(none.spec, null);
  assert.equal(none.diff, null);
});

test('2272 AC3 reuse: buildBundle returns the documented shape with acs from buildTrace', () => {
  const dir = makeRun();
  const b = buildBundle(dir, { task: 'add trace', maxBytes: BUNDLE_MAX_BYTES });
  assert.equal(b.version, 1);
  assert.equal(typeof b.builtAt, 'string');
  assert.equal(typeof b.truncated, 'boolean');
  assert.equal(b.acs[0].id, 'AC1');
  assert.equal(b.acs[0].status, 'mapped');
  assert.ok(b.locations.includes('haiku-100k/skills/haiku-build/scripts/trace.mjs'));
  assert.ok(Buffer.byteLength(JSON.stringify(b), 'utf8') <= BUNDLE_MAX_BYTES);
});

test('2272 AC3 reuse: a second getBundle with unchanged sources returns reused true and the same builtAt', () => {
  const dir = makeRun();
  const first = getBundle(dir, { stage: 'plan', task: 'add trace' });
  assert.equal(first.reused, false);
  assert.ok(fs.existsSync(path.join(dir, BUNDLE_REL)));
  const before = fs.readFileSync(path.join(dir, BUNDLE_REL), 'utf8');
  const second = getBundle(dir, { stage: 'plan', task: 'add trace' });
  assert.equal(second.reused, true);
  assert.equal(second.bundle.builtAt, first.bundle.builtAt);
  assert.equal(fs.readFileSync(path.join(dir, BUNDLE_REL), 'utf8'), before, 'reused bundle file is not rewritten');
});

test('2272 AC3 reuse: changing diff.patch rebuilds the bundle and reports invalidated diff', () => {
  const dir = makeRun();
  const first = getBundle(dir, { stage: 'review', task: 'add trace' });
  fs.writeFileSync(path.join(dir, 'evidence/diff.patch'), DIFF + '+export const y = 2;\n');
  const second = getBundle(dir, { stage: 'review', task: 'add trace' });
  assert.equal(second.reused, false);
  assert.deepEqual(second.invalidated, ['diff']);
  assert.notEqual(second.bundle.sources.diff, first.bundle.sources.diff);
});

test('2272 AC3 reuse: the bundle stays within BUNDLE_MAX_BYTES even with a huge diff', () => {
  const big = DIFF + Array.from({ length: 4000 }, (_, i) => `+const v${i} = ${i};`).join('\n') + '\n';
  const dir = makeRun({ diff: big });
  const { bundle } = getBundle(dir, { stage: 'plan', task: 'add trace' });
  assert.ok(Buffer.byteLength(JSON.stringify(bundle), 'utf8') <= BUNDLE_MAX_BYTES);
  assert.equal(bundle.truncated, true);
  assert.ok(Buffer.byteLength(fs.readFileSync(path.join(dir, BUNDLE_REL), 'utf8'), 'utf8') <= BUNDLE_MAX_BYTES);
});

test('2272 AC3 reuse fallback: a corrupt bundle file is rebuilt with reused false and a reason', () => {
  const dir = makeRun();
  getBundle(dir, { stage: 'plan', task: 'add trace' });
  fs.writeFileSync(path.join(dir, BUNDLE_REL), '{not json');
  const r = getBundle(dir, { stage: 'plan', task: 'add trace' });
  assert.equal(r.reused, false);
  assert.equal(typeof r.reason, 'string');
  assert.ok(r.reason.length > 0);
  assert.equal(r.bundle.version, 1);
  JSON.parse(fs.readFileSync(path.join(dir, BUNDLE_REL), 'utf8'));
});

test('2272 AC3 reuse fallback: a missing bundle file is rebuilt with reused false and a reason', () => {
  const dir = makeRun();
  const r = getBundle(dir, { stage: 'plan', task: 'add trace' });
  assert.equal(r.reused, false);
  assert.equal(typeof r.reason, 'string');
  assert.ok(fs.existsSync(path.join(dir, BUNDLE_REL)));
});

test('2272 AC3 reuse CLI: context_bundle.mjs <runDir> --stage plan prints one JSON line', () => {
  const dir = makeRun();
  const run = spawnSync(process.execPath, [CLI, dir, '--stage', 'plan', '--task', 'add trace'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const out = JSON.parse(lines[0]);
  assert.equal(out.reused, false);
  assert.ok(out.bytes <= BUNDLE_MAX_BYTES);
});
