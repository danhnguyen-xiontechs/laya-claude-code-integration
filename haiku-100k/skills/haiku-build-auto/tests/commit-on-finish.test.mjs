// A run that ends done or done_with_findings commits its working tree on the current branch (never pushed,
// no PR, as bmad-build-auto does), so a factory story branch carries the change; a blocked run and
// commit: false leave the tree alone, and a commit error blocks the run as `commit failed`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runAuto, commitRun, commitMessage, gitCommitAll, CONDITIONS } from '../scripts/auto.mjs';
import { AUTO_CLI, MINOR, SPEC, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A temp git repo with one commit, user configured locally, no hooks. */
function tmpRepo() {
  const dir = tmpDir('haiku-build-auto-commit-');
  git(dir, 'init', '-q', '-b', 'feature/test');
  git(dir, 'config', 'user.email', 'fixture@example.test');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function specFolder() {
  const dir = tmpDir('haiku-build-auto-commit-spec-');
  fs.mkdirSync(path.join(dir, 'stories'));
  return dir;
}

const TITLE = 'haiku-build v3: shared AC traceability';

test('commit: a done run under folder+id dispatch commits once, with the story title, and records the sha', async () => {
  const calls = [];
  const deps = baseDeps({
    task: null, specFolder: specFolder(), storyId: '2272', title: TITLE,
    ...fakeAgent(), ...fakeTests([true]),
    gitCommit: (message) => { calls.push(message); return { committed: true, sha: 'abc1234', files: ['src/a.mjs'] }; },
  });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^haiku-build v3: shared AC traceability\n\nhaiku-build-auto run 20261022-fixture-01: done$/);
  assert.deepEqual(res.commit, { committed: true, sha: 'abc1234', reason: null });
  assert.deepEqual(readJson(path.join(deps.runDir, 'result.json')).commit, res.commit);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.auto.commit.sha, 'abc1234');
  assert.deepEqual(m.auto.commit.files, ['src/a.mjs']);
  assert.equal(m.auto.commit.message, calls[0]);
});

test('commit: done_with_findings commits too; the status is in the message', async () => {
  const calls = [];
  const deps = baseDeps({
    task: null, specFolder: specFolder(), storyId: '2272', title: TITLE,
    ...fakeAgent({ review: (req) => (req.lens === 'verification-gap' ? JSON.stringify([MINOR]) : '[]') }), ...fakeTests([true]),
    gitCommit: (message) => { calls.push(message); return { committed: true, sha: 'def5678' }; },
  });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done_with_findings');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /: done_with_findings$/);
});

test('commit: a blocked run never commits', async () => {
  let calls = 0;
  const count = () => { calls += 1; return { committed: true, sha: 'x' }; };
  for (const over of [
    { ...fakeAgent(), ...fakeTests([false]) },
    { ...fakeAgent(), ...fakeTests([true]), gitClean: () => false },
    { agent: async () => { throw new Error('no Agent tool'); }, ...fakeTests([true]) },
  ]) {
    const deps = baseDeps({ task: null, specFolder: specFolder(), storyId: '2272', title: TITLE, ...over, gitCommit: count });
    const res = await runAuto(deps);
    assert.equal(res.status, 'blocked');
    assert.equal(res.commit, null);
  }
  assert.equal(calls, 0);
});

test('commit: a free-intent run commits too; only commit: false makes no call', async () => {
  for (const [commit, expected] of [[false, 0], [true, 1], [undefined, 1]]) {
    let calls = 0;
    const deps = baseDeps({ ...fakeAgent(), ...fakeTests([true]), gitCommit: () => { calls += 1; return { committed: true, sha: 'y' }; }, ...(commit === undefined ? {} : { commit }) });
    const res = await runAuto(deps);
    assert.equal(res.status, 'done');
    assert.equal(calls, expected, `commit=${String(commit)}`);
    assert.equal(res.commit?.sha ?? null, expected ? 'y' : null);
  }
  let calls = 0;
  const deps = baseDeps({ task: null, specFolder: specFolder(), storyId: '2272', title: TITLE, ...fakeAgent(), ...fakeTests([true]), commit: false, gitCommit: () => { calls += 1; return { committed: true }; } });
  assert.equal((await runAuto(deps)).status, 'done');
  assert.equal(calls, 0);
});

test('commit: a git error blocks the run `commit failed` with the git message, recorded in the manifest', async () => {
  const deps = baseDeps({
    task: null, specFolder: specFolder(), storyId: '2272', title: TITLE, ...fakeAgent(), ...fakeTests([true]),
    gitCommit: () => { const e = new Error('git failed'); e.stderr = 'fatal: unable to write new index file\n'; throw e; },
  });
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, CONDITIONS.commitFailed);
  assert.equal(res.exitCode, 1);
  assert.match(res.reason, /^commit failed: fatal: unable to write new index file$/);
  const m = readJson(path.join(deps.runDir, 'manifest.json'));
  assert.equal(m.finalStatus, 'blocked');
  assert.equal(m.auto.commit.committed, false);
  assert.match(m.auto.commit.reason, /unable to write new index file/);
});

test('commit: a clean tree is reported, not committed, and the run still ends done', async () => {
  const deps = baseDeps({ task: null, specFolder: specFolder(), storyId: '2272', title: TITLE, ...fakeAgent(), ...fakeTests([true]), gitCommit: () => ({ committed: false, reason: 'clean' }) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done');
  assert.deepEqual(res.commit, { committed: false, sha: null, reason: 'clean' });
});

test('commitMessage: story title first, else the task first line, cut at 72 characters', () => {
  assert.equal(commitMessage({ runId: 'r1', task: 'do x', auto: { dispatch: { title: 'Story T' } } }, 'done'), 'Story T\n\nhaiku-build-auto run r1: done');
  assert.equal(commitMessage({ runId: 'r1', task: 'first line\nsecond' }, 'done_with_findings'), 'first line\n\nhaiku-build-auto run r1: done_with_findings');
  assert.equal(commitMessage({ runId: 'r1', task: 'x'.repeat(100) }, 'done').split('\n')[0].length, 72);
  assert.match(commitMessage({}, 'done'), /^haiku-build-auto change\n\nhaiku-build-auto run \?: done$/);
});

test('gitCommitAll: stages modified, new and nested files one by one, commits on the current branch, no push, clean tree after', () => {
  const repo = tmpRepo();
  const head0 = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  fs.mkdirSync(path.join(repo, 'skills', 'x', 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'skills', 'x', 'tests', 'story-1.test.mjs'), 'export const t = 1;\n');
  fs.writeFileSync(path.join(repo, 'skills', 'x', 'new file.mjs'), 'export const n = 1;\n');
  const r = gitCommitAll(repo, 'Story T\n\nhaiku-build-auto run r1: done');
  assert.equal(r.committed, true);
  assert.deepEqual([...r.files].sort(), ['a.txt', 'skills/x/new file.mjs', 'skills/x/tests/story-1.test.mjs']);
  assert.equal(r.sha, git(repo, 'rev-parse', 'HEAD'));
  assert.notEqual(r.sha, head0);
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/test');
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'Story T');
  assert.equal(git(repo, 'log', '-1', '--format=%b').trim(), 'haiku-build-auto run r1: done');
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '2');
  assert.deepEqual(git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['a.txt', 'skills/x/new file.mjs', 'skills/x/tests/story-1.test.mjs']);
  assert.equal(git(repo, 'remote'), '');
  // A clean tree makes no commit.
  assert.deepEqual(gitCommitAll(repo, 'again'), { committed: false, reason: 'clean', skipped: [] });
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '2');
});

test('gitCommitAll: a run folder inside the repository is left out of the commit (exclude), and stays untracked', () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  const runDir = path.join(repo, 'reports', 'haiku-build', '20261023-x-01');
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'evidence', 'diff.patch'), 'diff');
  const r = gitCommitAll(repo, 'change only', { exclude: [runDir] });
  assert.equal(r.committed, true);
  assert.deepEqual(r.files, ['a.txt']);
  assert.deepEqual([...r.skipped].sort(), ['reports/haiku-build/20261023-x-01/evidence/diff.patch', 'reports/haiku-build/20261023-x-01/manifest.json']);
  assert.deepEqual(git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['a.txt']);
  assert.match(git(repo, 'status', '--porcelain', '--untracked-files=all'), /reports\/haiku-build/);
  // Only the run folder dirty: clean for the commit, the run folder reported as skipped.
  const again = gitCommitAll(repo, 'nothing', { exclude: [runDir] });
  assert.equal(again.committed, false);
  assert.equal(again.reason, 'clean');
  assert.equal(again.skipped.length, 2);
  // An exclude outside the repository changes nothing.
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  assert.deepEqual(gitCommitAll(repo, 'b', { exclude: [tmpDir('haiku-build-auto-elsewhere-')] }).files.sort(), ['b.txt', 'reports/haiku-build/20261023-x-01/evidence/diff.patch', 'reports/haiku-build/20261023-x-01/manifest.json']);
});

test('commitRun: through runAuto the run folder inside the repo is excluded by default', async () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'src.mjs'), 'export const flag = true;\n');
  const prev = process.cwd();
  process.chdir(repo);
  try {
    const { gitCommit: _omit, ...deps } = baseDeps({ task: null, specFolder: specFolder(), storyId: '2272', title: TITLE, ...fakeAgent(), ...fakeTests([true]) });
    deps.runDir = path.join(repo, 'reports', 'haiku-build', '20261023-in-repo-01');
    const res = await runAuto(deps);
    assert.equal(res.status, 'done');
    assert.equal(res.commit.committed, true);
    assert.deepEqual(git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['src.mjs']);
    const m = readJson(path.join(deps.runDir, 'manifest.json'));
    assert.ok(m.auto.commit.skipped.some((f) => f.startsWith('reports/haiku-build/20261023-in-repo-01/')));
  } finally {
    process.chdir(prev);
  }
});

test('gitCommitAll: a deleted tracked file is committed as a deletion; a folder that is not a repo reports no git', () => {
  const repo = tmpRepo();
  fs.rmSync(path.join(repo, 'a.txt'));
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  const r = gitCommitAll(repo, 'delete a');
  assert.equal(r.committed, true);
  assert.deepEqual([...r.files].sort(), ['a.txt', 'b.txt']);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  assert.equal(git(repo, 'ls-files'), 'b.txt');
  assert.deepEqual(gitCommitAll(tmpDir('haiku-build-auto-nogit-'), 'x'), { committed: false, reason: 'no git', skipped: [] });
});

test('commitRun: real repo end to end through runAuto with the default gitCommit, run from the repo cwd', async () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'src.mjs'), 'export const flag = true;\n');
  const prev = process.cwd();
  process.chdir(repo);
  try {
    const { gitCommit: _omit, ...deps } = baseDeps({ task: null, specFolder: specFolder(), storyId: '2272', title: TITLE, ...fakeAgent(), ...fakeTests([true]) });
    const res = await runAuto(deps);
    assert.equal(res.status, 'done');
    assert.equal(res.commit.committed, true);
    assert.equal(res.commit.sha, git(repo, 'rev-parse', 'HEAD'));
    assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');
    assert.equal(git(repo, 'log', '-1', '--format=%s'), TITLE);
  } finally {
    process.chdir(prev);
  }
});

test('CLI finish: commits the cwd, with or without dispatch; --no-commit leaves it', () => {
  const manifest = (dispatch) => ({
    schemaVersion: 1, runId: 'fin', tool: 'haiku-build', status: 'REVIEWED', task: 'cli task', opusCalls: [], phases: [], haiku: {},
    attempts: [{ attempt: 'T1', ok: true }], tests: { passed: 1, failed: 0 }, review: { status: 'done', findings: [] },
    auto: { mode: 'unattended', dispatch, fixRounds: 0, questionsAsked: 0 },
  });
  const runDirFor = (dispatch) => {
    const dir = tmpDir('haiku-build-auto-finish-');
    fs.mkdirSync(path.join(dir, 'evidence'));
    fs.writeFileSync(path.join(dir, 'spec.md'), SPEC);
    fs.writeFileSync(path.join(dir, 'evidence', 'diff.patch'), 'diff --git a/x b/x\n');
    fs.writeFileSync(path.join(dir, 'evidence', 'unit-tests.log'), 'pass 1 fail 0');
    fs.writeFileSync(path.join(dir, 'evidence', 'review.json'), '{"findings":[]}');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest(dispatch)));
    return dir;
  };
  const finish = (cwd, dir, ...flags) => {
    const r = spawnSync(process.execPath, [AUTO_CLI, 'finish', dir, ...flags], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout.trim());
  };
  const dispatch = { specFolder: specFolder(), storyId: '2272', title: TITLE };

  // folder+id dispatch: committed by default.
  let repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'n.txt'), 'n\n');
  let out = finish(repo, runDirFor(dispatch));
  assert.equal(out.status, 'done');
  assert.equal(out.commit.committed, true);
  assert.equal(out.commit.sha, git(repo, 'rev-parse', 'HEAD'));
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(repo, 'log', '-1', '--format=%s'), TITLE);

  // --no-commit: the tree stays dirty.
  repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'n.txt'), 'n\n');
  out = finish(repo, runDirFor(dispatch), '--no-commit');
  assert.equal(out.status, 'done');
  assert.equal(out.commit, null);
  assert.notEqual(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');

  // free intent: committed as well, with the task as subject.
  repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'n.txt'), 'n\n');
  out = finish(repo, runDirFor(null));
  assert.equal(out.commit.committed, true);
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'cli task');
});

test('CLI finish: a blocked run commits nothing even under dispatch', () => {
  const repo = tmpRepo();
  fs.writeFileSync(path.join(repo, 'n.txt'), 'n\n');
  const dir = tmpDir('haiku-build-auto-finish-blocked-');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'fin', tool: 'haiku-build', status: 'REVIEWED', task: 't', opusCalls: [], phases: [], haiku: {}, attempts: [{ attempt: 'T1', ok: true }], tests: { passed: 1, failed: 0 }, auto: { dispatch: { specFolder: specFolder(), storyId: '1', title: 'x' } } }));
  const r = spawnSync(process.execPath, [AUTO_CLI, 'finish', dir], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.status, 'blocked');
  assert.equal(out.commit, null);
  assert.notEqual(git(repo, 'status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1');
});
