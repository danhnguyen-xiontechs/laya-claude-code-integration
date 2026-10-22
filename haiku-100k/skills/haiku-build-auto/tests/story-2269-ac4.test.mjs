// Story 2269 AC4: every run that ends writes <runDir>/result.json with status and condition; under
// folder+id dispatch the story spec gets its status updated and "## Auto Run Result" appended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAuto, specFileFor, writeBackSpec, writeResult, halt } from '../scripts/auto.mjs';
import { AUTO_CLI, MINOR, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

const TITLE = 'haiku-build-auto: unattended haiku-build v2 with scripted stages';
const SLUG_FILE = '2269-haiku-build-auto-unattended-haiku-build-v2-with-scripted-stages.md';

function specFolder(files = {}) {
  const dir = tmpDir('haiku-build-auto-2269-spec-');
  fs.mkdirSync(path.join(dir, 'stories'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'stories', name), text);
  return dir;
}

test('2269 AC4 result: a finished run writes result.json with status and a null condition', async () => {
  const deps = baseDeps({ ...fakeAgent({ review: (req) => (req.lens === 'verification-gap' ? JSON.stringify([MINOR]) : '[]') }), ...fakeTests() });
  await runAuto(deps);
  const r = readJson(path.join(deps.runDir, 'result.json'));
  assert.equal(r.status, 'done_with_findings');
  assert.equal(r.condition, null);
  assert.equal(r.exitCode, 0);
  assert.equal(r.runId, '20261022-fixture-01');
});

test('2269 AC4 result: a halted run writes result.json with blocked and the condition, even before intake', async () => {
  const deps = baseDeps({ gitClean: () => false, ...fakeAgent(), ...fakeTests() });
  await runAuto(deps);
  const r = readJson(path.join(deps.runDir, 'result.json'));
  assert.deepEqual([r.status, r.condition, r.exitCode], ['blocked', 'dirty working tree', 1]);
  assert.throws(() => writeResult(tmpDir(), { status: 'ready-for-dev' }), /not a terminal status/);
});

test('2269 AC4 result: CLI finish writes result.json and manifest.finalStatus; blocked exits 1', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'fin', tool: 'haiku-build', status: 'REVIEWED', task: 't', opusCalls: [], phases: [], haiku: {}, attempts: [{ attempt: 'T1', ok: true }], tests: { passed: 1, failed: 0 } }));
  const r = spawnSync(process.execPath, [AUTO_CLI, 'finish', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.status, 'blocked');
  assert.match(out.condition, /missing required artifact: spec\.md/);
  assert.equal(readJson(path.join(dir, 'result.json')).status, 'blocked');
  assert.equal(readJson(path.join(dir, 'manifest.json')).finalStatus, 'blocked');
});

test('2269 AC4 spec: folder+id updates the existing story spec status and appends Auto Run Result', async () => {
  const before = '---\ntitle: x\nstatus: in-progress\nreview_loop_iteration: 0\n---\n\n## Intent\n\nbody\n\n## Verification\n\n- node --test\n';
  const folder = specFolder({ [SLUG_FILE]: before, '2270-other.md': '---\nstatus: draft\n---\n' });
  const deps = baseDeps({ task: null, specFolder: folder, storyId: '2269', title: TITLE, ...fakeAgent(), ...fakeTests() });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  const file = path.join(folder, 'stories', SLUG_FILE);
  assert.equal(res.specFile, file);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^---\ntitle: x\nstatus: done\nreview_loop_iteration: 0\n---\n/);
  assert.ok(text.includes('## Intent\n\nbody\n'));
  assert.match(text, /## Auto Run Result\n\nStatus: done\nBlocking condition: none\n/);
  assert.equal(fs.readFileSync(path.join(folder, 'stories', '2270-other.md'), 'utf8'), '---\nstatus: draft\n---\n');
  assert.equal(readJson(path.join(deps.runDir, 'manifest.json')).task, TITLE);
});

test('2269 AC4 spec: a missing story spec is created at <id>-<slug>.md with the blocked result', async () => {
  const folder = specFolder();
  const deps = baseDeps({ task: null, specFolder: folder, storyId: '2269', title: TITLE, gitClean: () => false, ...fakeAgent(), ...fakeTests() });
  await runAuto(deps);
  const text = fs.readFileSync(path.join(folder, 'stories', SLUG_FILE), 'utf8');
  assert.match(text, /^---\nstatus: blocked\n---\n\n# haiku-build-auto: unattended/);
  assert.match(text, /## Auto Run Result\n\nStatus: blocked\nBlocking condition: dirty working tree\n/);
  assert.equal(specFileFor(specFolder(), '7', null).file.endsWith(`${path.sep}7-unresolved.md`), true);
});

test('2269 AC4 spec: more than one match halts ambiguous story file match and leaves the matches untouched', async () => {
  const folder = specFolder({ '2269-a.md': '---\nstatus: draft\n---\n', '2269-b.md': '---\nstatus: draft\n---\n' });
  const a = fakeAgent();
  const deps = baseDeps({ task: null, specFolder: folder, storyId: '2269', title: TITLE, agent: a.agent, ...fakeTests() });
  const res = await runAuto(deps);
  assert.deepEqual([res.status, res.condition, res.exitCode], ['blocked', 'ambiguous story file match', 1]);
  assert.equal(a.calls.length, 0);
  assert.equal(fs.readFileSync(path.join(folder, 'stories', '2269-a.md'), 'utf8'), '---\nstatus: draft\n---\n');
  assert.match(fs.readFileSync(path.join(folder, 'stories', '2269-ambiguous.md'), 'utf8'), /status: blocked[\s\S]*Blocking condition: ambiguous story file match/);
});

test('2269 AC4 spec: an existing Auto Run Result section gets the details under it; CRLF and no frontmatter handled', () => {
  const folder = specFolder();
  const f1 = path.join(folder, 'stories', '1-x.md');
  fs.writeFileSync(f1, '---\r\nstatus: ready-for-dev\r\n---\r\n\r\n## Auto Run Result\r\n\r\nold line\r\n\r\n## Notes\r\n\r\nkeep\r\n');
  writeBackSpec(f1, { status: 'blocked', condition: 'no subagents' });
  const t1 = fs.readFileSync(f1, 'utf8');
  assert.ok(!/[^\r]\n/.test(t1), 'CRLF kept');
  const n1 = t1.replace(/\r\n/g, '\n');
  assert.match(n1, /^---\nstatus: blocked\n---/);
  assert.match(n1, /## Auto Run Result\n\nold line\n\nStatus: blocked\nBlocking condition: no subagents\n[^\n]*\n\n## Notes\n\nkeep\n$/);
  const f2 = path.join(folder, 'stories', '2-y.md');
  fs.writeFileSync(f2, '# Story 2\n');
  writeBackSpec(f2, { status: 'done' });
  assert.match(fs.readFileSync(f2, 'utf8'), /^---\nstatus: done\n---\n\n# Story 2\n\n## Auto Run Result\n\nStatus: done\n/);
});

test('2269 AC4 spec: halt() and the CLI halt read the dispatch from the manifest', () => {
  const folder = specFolder();
  const runDir = path.join(tmpDir(), 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({ runId: 'run', auto: { dispatch: { specFolder: folder, storyId: '42', title: 'Answer things' } } }));
  const r = spawnSync(process.execPath, [AUTO_CLI, 'halt', runDir, 'tests still fail'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const file = path.join(folder, 'stories', '42-answer-things.md');
  assert.equal(JSON.parse(r.stdout.trim()).specFile, file);
  assert.match(fs.readFileSync(file, 'utf8'), /status: blocked[\s\S]*Blocking condition: tests still fail/);
  assert.equal(halt(path.join(tmpDir(), 'r2'), 'intent gap').exitCode, 1);
});
