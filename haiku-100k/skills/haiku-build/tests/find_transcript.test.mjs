import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTranscript, projectDirName } from '../scripts/find_transcript.mjs';

function setup() {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-proj-'));
  const dir = path.join(projects, projectDirName('D:\\Work\\app'));
  fs.mkdirSync(dir);
  return { projects, dir };
}

function write(p, text, mtimeSec) {
  fs.writeFileSync(p, text);
  fs.utimesSync(p, mtimeSec, mtimeSec);
}

test('project folder name replaces every non-alphanumeric character', () => {
  assert.equal(projectDirName('D:\\Laya'), 'D--Laya');
  assert.equal(projectDirName('/home/u/my.app'), '-home-u-my-app');
});

test('picks the transcript that mentions the run id, not just the newest one', () => {
  const { projects, dir } = setup();
  write(path.join(dir, 'mine.jsonl'), '{"m":"run 20261019-x-01"}\n', 1000);
  write(path.join(dir, 'other-newer.jsonl'), '{"m":"something else"}\n', 2000);
  assert.equal(findTranscript('20261019-x-01', { cwd: 'D:\\Work\\app', projects }), path.join(dir, 'mine.jsonl'));
});

test('the run session (most mentions) beats a newer session that only mentions the run once', () => {
  const { projects, dir } = setup();
  write(path.join(dir, 'run.jsonl'), 'r-04 r-04 r-04\n', 1000);
  write(path.join(dir, 'control.jsonl'), 'started r-04\n', 2000);
  assert.equal(findTranscript('r-04', { cwd: 'D:\\Work\\app', projects }), path.join(dir, 'run.jsonl'));
});

test('a tie on mentions goes to the newest transcript', () => {
  const { projects, dir } = setup();
  write(path.join(dir, 'old.jsonl'), 'r-01\n', 1000);
  write(path.join(dir, 'new.jsonl'), 'r-01\n', 2000);
  assert.equal(findTranscript('r-01', { cwd: 'D:\\Work\\app', projects }), path.join(dir, 'new.jsonl'));
});

test('falls back to every project folder when the cwd folder has no match', () => {
  const { projects } = setup();
  const elsewhere = path.join(projects, 'D--Other');
  fs.mkdirSync(elsewhere);
  write(path.join(elsewhere, 's.jsonl'), 'r-02\n', 1000);
  assert.equal(findTranscript('r-02', { cwd: 'D:\\Nowhere', projects }), path.join(elsewhere, 's.jsonl'));
});

test('returns null when no transcript mentions the run id', () => {
  const { projects, dir } = setup();
  write(path.join(dir, 'a.jsonl'), 'nothing\n', 1000);
  assert.equal(findTranscript('r-03', { cwd: 'D:\\Work\\app', projects }), null);
  assert.equal(findTranscript('', { cwd: 'D:\\Work\\app', projects }), null);
});
