// A factory story spanning several repos (XT_FACTORY_REPOS): the builder runs in a story folder that is in
// none of them, often inside another, dirty repo (the factory umbrella). start checks every listed worktree
// and never the repo around the folder; finish commits each changed worktree with the same message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { workRepos, gitIsCleanAll, gitCommitRepos, gitDiffAll } from '../scripts/auto.mjs';
import { tmpDir } from './fixture.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'feature/2316');
  git(dir, 'config', 'user.email', 'fixture@example.test');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

test('multi-repo: XT_FACTORY_REPOS lists the worktrees; without it the working folder stands alone', () => {
  assert.deepEqual(workRepos({ XT_FACTORY_REPOS: ['a', 'b'].join(path.delimiter) }, '/x'), ['a', 'b']);
  assert.deepEqual(workRepos({}, '/x'), ['/x']);
  assert.deepEqual(workRepos({ XT_FACTORY_REPOS: '' }, '/x'), ['/x']);
});

test('multi-repo: clean check and commit use the listed worktrees, never the dirty repo around the story folder', () => {
  const umbrella = repo(tmpDir('haiku-build-auto-umbrella-'));
  fs.writeFileSync(path.join(umbrella, 'report.md'), 'untracked, not the story\'s\n');
  const story = path.join(umbrella, '.worktrees', '2316');
  const be = repo(path.join(story, 'ess-be'));
  const fe = repo(path.join(story, 'ess-fe'));
  const repos = workRepos({ XT_FACTORY_REPOS: [be, fe].join(path.delimiter) }, story);
  assert.equal(gitIsCleanAll(repos), true, 'the umbrella is dirty, the worktrees are clean');
  fs.writeFileSync(path.join(be, 'b.cs'), 'be\n');
  fs.writeFileSync(path.join(fe, 'f.ts'), 'fe\n');
  git(be, 'add', '-N', 'b.cs');
  git(fe, 'add', '-N', 'f.ts');
  assert.equal(gitIsCleanAll(repos), false);
  assert.match(gitDiffAll(repos), /# repo: .*ess-be[\s\S]*b\.cs[\s\S]*# repo: .*ess-fe[\s\S]*f\.ts/);
  const runDir = path.join(story, 'reports', 'haiku-build', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  const r = gitCommitRepos(repos, 'Courses: deadline\n\nhaiku-build-auto run r1: done', { exclude: [runDir] });
  assert.equal(r.committed, true);
  assert.deepEqual(r.files.sort(), ['ess-be/b.cs', 'ess-fe/f.ts']);
  assert.equal(git(be, 'log', '-1', '--format=%s'), 'Courses: deadline');
  assert.equal(git(fe, 'log', '-1', '--format=%s'), 'Courses: deadline');
  assert.equal(git(umbrella, 'log', '--oneline').split('\n').length, 1, 'nothing committed in the umbrella');
  assert.match(git(umbrella, 'status', '--porcelain'), /report\.md/);
  // Only one worktree changed: it alone gets a commit.
  fs.writeFileSync(path.join(fe, 'g.ts'), 'fe2\n');
  const again = gitCommitRepos(repos, 'second');
  assert.deepEqual(again.repos.map((x) => x.committed), [false, true]);
  assert.deepEqual(gitCommitRepos(repos, 'third'), { committed: false, reason: 'clean', repos: again.repos.map((x) => ({ dir: x.dir, committed: false, reason: 'clean', skipped: [] })), skipped: [] });
});
