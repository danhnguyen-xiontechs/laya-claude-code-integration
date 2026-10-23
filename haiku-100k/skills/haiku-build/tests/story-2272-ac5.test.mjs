// Story 2272 AC5 manual: a person running haiku-build by hand gets the v3 helpers from the command line.
// status.mjs record fail --log stores a diagnostics entry; trace.mjs <runDir> stores the AC trace of spec.md in manifest.json;
// context_bundle.mjs <runDir> writes evidence/context-bundle.json and a second call with unchanged sources
// reuses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, readJson } from '../../haiku-build-auto/tests/fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(here, '..', 'scripts');
const STATUS = path.join(SCRIPTS, 'status.mjs');
const TRACE = path.join(SCRIPTS, 'trace.mjs');
const BUNDLE = path.join(SCRIPTS, 'context_bundle.mjs');

const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const line = r.stdout.trim().split('\n').at(-1) ?? '';
  return { code: r.status, json: line ? JSON.parse(line) : null };
};

const SPEC_MD = [
  '# Spec: manual', '', '## 6. Tasks & Acceptance Criteria',
  '- AC1: flag works (`src/a.mjs` add the flag; checked by `node --test tests/a.test.mjs`)',
  '- AC2: default is off (`src/a.mjs` default; checked by `node --test tests/a.test.mjs`)', '',
].join('\n');

function runFolder() {
  const dir = path.join(tmpDir('haiku-build-2272-manual-'), 'run');
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ status: 'BUILT', attempts: [], task: 'manual' }, null, 2));
  fs.writeFileSync(path.join(dir, 'spec.md'), SPEC_MD);
  return dir;
}

test('2272 AC5 manual: status record fail --log stores a diagnostics entry in manifest.json', () => {
  const dir = runFolder();
  const log = path.join(dir, 'evidence', 'unit-tests.log');
  fs.writeFileSync(log, 'not ok 1 - flag works\n# pass 2\n# fail 1\n');
  const r = run(STATUS, dir, 'record', 'fail', '--log', log);
  assert.equal(r.code, 0);
  const m = readJson(path.join(dir, 'manifest.json'));
  assert.equal(m.diagnostics.length, 1);
  assert.equal(m.diagnostics[0].stage, 'test');
  assert.equal(m.diagnostics[0].attempt, 'T1');
  assert.equal(m.diagnostics[0].failed, 1);
});

test('2272 AC5 manual: trace.mjs prints the AC counts and stores the trace in manifest.json', () => {
  const dir = runFolder();
  const r = run(TRACE, dir);
  assert.equal(r.code, 0);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.total, 2);
  assert.equal(r.json.unmapped, 0);
  const m = readJson(path.join(dir, 'manifest.json'));
  assert.equal(m.trace.acs.length, 2);
  assert.deepEqual(m.trace.unmapped, []);
});

test('2272 AC5 manual: context_bundle.mjs writes the bundle once and reuses it with unchanged sources', () => {
  const dir = runFolder();
  fs.writeFileSync(path.join(dir, 'evidence', 'diff.patch'), 'diff --git a/src/a.mjs b/src/a.mjs\n+x\n');
  const first = run(BUNDLE, dir, '--stage', 'review');
  assert.equal(first.code, 0);
  assert.equal(first.json.reused, false);
  assert.ok(fs.existsSync(path.join(dir, 'evidence', 'context-bundle.json')));
  const second = run(BUNDLE, dir, '--stage', 'review');
  assert.equal(second.json.reused, true);
  assert.equal(second.json.file, first.json.file);
});

test('2272 AC5 manual: a changed diff.patch makes context_bundle.mjs rebuild and name the diff', () => {
  const dir = runFolder();
  fs.writeFileSync(path.join(dir, 'evidence', 'diff.patch'), 'diff --git a/src/a.mjs b/src/a.mjs\n+x\n');
  run(BUNDLE, dir, '--stage', 'review');
  fs.writeFileSync(path.join(dir, 'evidence', 'diff.patch'), 'diff --git a/src/a.mjs b/src/a.mjs\n+y\n');
  const r = run(BUNDLE, dir, '--stage', 'review');
  assert.equal(r.json.reused, false);
  assert.ok(r.json.invalidated.some((k) => /diff/.test(k)));
});
