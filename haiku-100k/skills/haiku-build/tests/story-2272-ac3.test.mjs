// Story 2272 AC3: Plan and Review inputs share one structured context bundle (evidence/context-bundle.json):
// unchanged sections are reused, changed inputs rebuild only the sections that depend on them, and the bundle
// stays within its byte bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  bundleSources, prepareBundle, renderBundle, useBundle, readBundle, diffLocations, fitSection,
  BUNDLE_MAX_BYTES, BUNDLE_DIFF_MAX_BYTES, SECTION_MAX_BYTES,
} from '../scripts/context_bundle.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const SPEC = [
  '## 1. Goal & Intent', 'Add a flag.', '', '## 6. Tasks & Acceptance Criteria',
  '- AC1: `--flag` sets the flag — target: `src/a.mjs`; verify: `node --test test/a.test.mjs`',
  '- AC2: help lists it', '', '## 7. Red Checks', 'red: x', '', '## 8. Verification', 'node --test test/a.test.mjs', '',
].join('\n');
const DIFF = 'diff --git a/src/a.mjs b/src/a.mjs\n--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1,2 +1,3 @@\n const a = 1;\n+export const flag = true;\n@@ -20,1 +21,2 @@\n+// more\n';

function runDir({ spec = SPEC, diff = DIFF, m = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac3-'));
  fs.mkdirSync(path.join(dir, 'evidence'));
  if (spec != null) fs.writeFileSync(path.join(dir, 'spec.md'), spec);
  if (diff != null) fs.writeFileSync(path.join(dir, 'evidence', 'diff.patch'), diff);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'ac3', task: 'add a flag', ...m }));
  return dir;
}
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('2272 AC3 bundle: one bundle with ACs, code locations, diff and evidence', () => {
  const m = { task: 'add a flag', tests: { command: 'node --test test/a.test.mjs', passed: 2, failed: 1 }, attempts: [{ attempt: 'T1', ok: false, passed: 2, failed: 1 }],
    failures: [{ kind: 'test', stage: '04-test', attempt: 'T1', fingerprint: 'abcd', category: 'assertion', progress: 'first', repeatCount: 1, failed: 1 }] };
  const dir = runDir({ m });
  const r = prepareBundle(dir, bundleSources(dir, m, { facts: 'src/a.mjs exports a' }), { stage: '05-review' });
  const b = JSON.parse(fs.readFileSync(path.join(dir, 'evidence', 'context-bundle.json'), 'utf8'));
  assert.equal(b.version, 1);
  assert.deepEqual(Object.keys(b.sections), ['acs', 'codeLocations', 'diff', 'evidence']);
  for (const s of Object.values(b.sections)) assert.match(s.sourceHash, /^[0-9a-f]{16}$/);
  assert.deepEqual(b.sections.acs.data.acs.map((a) => [a.id, a.target]), [['AC1', 'src/a.mjs'], ['AC2', null]]);
  assert.deepEqual(b.sections.acs.data.unmapped, ['AC2']);
  assert.deepEqual(b.sections.codeLocations.data.files, [{ file: 'src/a.mjs', hunks: [1, 21] }]);
  assert.deepEqual(b.sections.codeLocations.data.targets, [{ id: 'AC1', target: 'src/a.mjs' }]);
  assert.equal(b.sections.codeLocations.data.facts, 'src/a.mjs exports a');
  assert.equal(b.sections.diff.data.text, DIFF);
  assert.deepEqual(b.sections.diff.data.omitted, []);
  assert.equal(b.sections.evidence.data.tests.failed, 1);
  assert.equal(b.sections.evidence.data.failures[0].fingerprint, 'abcd');
  assert.deepEqual(r.rebuilt, ['acs', 'codeLocations', 'diff', 'evidence']);
  assert.deepEqual(b.uses, [{ stage: '05-review', reused: [], rebuilt: r.rebuilt, bytes: r.bytes }]);
  const text = fs.readFileSync(path.join(dir, 'evidence', 'context-bundle.txt'), 'utf8');
  assert.equal(text, r.text);
  assert.match(text, /ACCEPTANCE CRITERIA:\n- AC1: `--flag` sets the flag — target: src\/a\.mjs; verify: node --test test\/a\.test\.mjs\n- AC2: help lists it — target: MISSING; verify: MISSING \[unmapped\]/);
  assert.match(text, /- src\/a\.mjs \(hunks at 1, 21\)/);
  assert.match(text, /DIFF \(1 file\(s\)\):\ndiff --git/);
  assert.match(text, /attempts: T1 fail \(failed 1\)/);
});

test('2272 AC3 bundle: plan time (no spec, no diff) uses the task; missing sources give null sections', () => {
  const dir = runDir({ spec: null, diff: null });
  const r = prepareBundle(dir, bundleSources(dir, { task: 'AC1: x — target: `a.mjs`; verify: `node --test t.mjs`' }), { stage: '02-plan' });
  assert.equal(r.bundle.sections.acs.data.acs[0].target, 'a.mjs');
  assert.equal(r.bundle.sections.codeLocations, null);
  assert.equal(r.bundle.sections.diff, null);
  assert.equal(r.bundle.sections.evidence, null);
  assert.deepEqual(r.rebuilt, ['acs']);
  assert.match(r.text, /CODE LOCATIONS:\nnone/);
  assert.match(r.text, /DIFF:\nnone/);
  assert.match(r.text, /EVIDENCE:\nnone/);
  const empty = prepareBundle(runDir({ spec: null, diff: null }), {}, { stage: '02-plan' });
  assert.equal(empty.bundle.sections.acs, null);
  assert.match(empty.text, /ACCEPTANCE CRITERIA:\nnone/);
});

test('2272 AC3 bundle: useBundle logs each use in manifest.contextBundle; CLI writes the manifest', () => {
  const dir = runDir();
  const m = manifest(dir);
  useBundle(dir, m, { stage: '02-plan' });
  useBundle(dir, m, { stage: '05-review' });
  assert.equal(m.contextBundle.file, 'evidence/context-bundle.json');
  assert.deepEqual(m.contextBundle.uses.map((u) => [u.stage, u.rebuilt.length, u.reused.length]), [['02-plan', 3, 0], ['05-review', 0, 3]]);
  const facts = path.join(dir, 'facts.txt');
  fs.writeFileSync(facts, 'new fact');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'context_bundle.mjs'), dir, '06-fix', '--facts', facts], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout.trim());
  assert.deepEqual([out.stage, out.rebuilt, out.reused], ['06-fix', ['codeLocations'], ['acs', 'diff']]);
  assert.equal(manifest(dir).contextBundle.uses.at(-1).stage, '06-fix');
  assert.equal(spawnSync(process.execPath, [path.join(SCRIPTS, 'context_bundle.mjs')]).status, 2);
});

test('2272 AC3 reuse: Review reuses the sections built for Plan; a changed input rebuilds only its dependents', () => {
  const m = { task: 't', tests: { passed: 1, failed: 0 } };
  const dir = runDir({ m });
  const first = prepareBundle(dir, bundleSources(dir, m), { stage: '02-plan' });
  const again = prepareBundle(dir, bundleSources(dir, m), { stage: '05-review' });
  assert.deepEqual(again.reused, ['acs', 'codeLocations', 'diff', 'evidence']);
  assert.deepEqual(again.rebuilt, []);
  assert.deepEqual(again.bundle.sections, first.bundle.sections);
  // Stale diff: diff and code locations are rebuilt, ACs and evidence reused.
  fs.writeFileSync(path.join(dir, 'evidence', 'diff.patch'), DIFF + 'diff --git a/src/b.mjs b/src/b.mjs\n@@ -0,0 +1 @@\n+x\n');
  const d = prepareBundle(dir, bundleSources(dir, m), { stage: '06-fix' });
  assert.deepEqual(d.rebuilt, ['codeLocations', 'diff']);
  assert.deepEqual(d.reused, ['acs', 'evidence']);
  assert.deepEqual(d.bundle.sections.diff.data.files, ['src/a.mjs', 'src/b.mjs']);
  // Stale spec: ACs and code locations rebuilt.
  fs.writeFileSync(path.join(dir, 'spec.md'), SPEC.replace('help lists it', 'help lists it — target: `src/h.mjs`; verify: `node --test h.mjs`'));
  const s = prepareBundle(dir, bundleSources(dir, m), { stage: '06-fix' });
  assert.deepEqual(s.rebuilt, ['acs', 'codeLocations']);
  assert.deepEqual(s.bundle.sections.acs.data.unmapped, []);
  // New test evidence: only evidence rebuilt.
  const e = prepareBundle(dir, bundleSources(dir, { ...m, tests: { passed: 0, failed: 2 } }), { stage: '06-fix' });
  assert.deepEqual(e.rebuilt, ['evidence']);
  assert.equal(readBundle(dir).uses.length, 5);
});

test('2272 AC3 reuse: a large diff keeps the bundle within BUNDLE_MAX_BYTES and names the omitted files', () => {
  const file = (name, kb) => `diff --git a/${name} b/${name}\n@@ -1 +1,${kb * 16} @@\n${`+${'"x\\'.repeat(20)}${'y'.repeat(2)}\n`.repeat(kb * 16)}`;
  const big = [file('src/one.mjs', 20), file('src/two.mjs', 20), file('src/three.mjs', 20), file('src/four.mjs', 20)].join('');
  assert.ok(Buffer.byteLength(big) > BUNDLE_MAX_BYTES);
  const many = Array.from({ length: 300 }, (_, i) => `- AC${i + 3}: ${'behaviour '.repeat(10)}— target: \`src/f${i}.mjs\`; verify: \`node --test t${i}.mjs\``).join('\n');
  const longSpec = SPEC.replace('- AC2: help lists it', `- AC2: help lists it\n${many}`);
  const dir = runDir({ diff: big, spec: longSpec });
  const r = prepareBundle(dir, bundleSources(dir, { task: 't' }, { facts: 'f'.repeat(10_000) }), { stage: '05-review' });
  const bytes = fs.statSync(path.join(dir, 'evidence', 'context-bundle.json')).size;
  assert.ok(bytes <= BUNDLE_MAX_BYTES, `bundle ${bytes} bytes`);
  assert.equal(r.bytes, bytes);
  const d = r.bundle.sections.diff.data;
  assert.ok(Buffer.byteLength(d.text) <= BUNDLE_DIFF_MAX_BYTES);
  assert.ok(d.omitted.length >= 1);
  assert.ok(d.omitted.every((f) => ['src/one.mjs', 'src/two.mjs', 'src/three.mjs', 'src/four.mjs'].includes(f)));
  assert.equal(d.truncated, true);
  assert.match(r.text, /omitted: src\//);
  for (const k of ['acs', 'codeLocations']) assert.ok(Buffer.byteLength(JSON.stringify(r.bundle.sections[k].data)) <= SECTION_MAX_BYTES, k);
  assert.equal(r.bundle.sections.acs.data.trimmed, true);
});

test('2272 AC3 reuse: a corrupt or foreign bundle file is rebuilt whole (fallback)', () => {
  const dir = runDir();
  fs.writeFileSync(path.join(dir, 'evidence', 'context-bundle.json'), '{not json');
  assert.deepEqual(prepareBundle(dir, bundleSources(dir, {}), { stage: '02-plan' }).reused, []);
  fs.writeFileSync(path.join(dir, 'evidence', 'context-bundle.json'), JSON.stringify({ version: 0, sections: {} }));
  assert.deepEqual(prepareBundle(dir, bundleSources(dir, {}), { stage: '02-plan' }).rebuilt, ['acs', 'codeLocations', 'diff']);
  assert.deepEqual(diffLocations(''), []);
  assert.deepEqual(fitSection({ items: Array(2000).fill('z'.repeat(50)) }, 1024).trimmed, true);
  assert.equal(renderBundle(null).includes('ACCEPTANCE CRITERIA:\nnone'), true);
});
