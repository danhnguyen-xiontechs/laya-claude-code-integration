// One folder per review run, so re-reviews of a PR never overwrite each other.
// Run: node --test .claude/skills/<skill>/tests/run-folder.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultPaths, runStamp } from '../scripts/pr-fetch.mjs';
import { latestPerPr } from '../scripts/laya-eval.mjs';

const SKILL = path.basename(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rpl-run-'));

describe('run folder', () => {
  const now = new Date(2026, 9, 12, 14, 30, 5);
  it('stamp is local YYYYMMDD-HHmmss', () => assert.equal(runStamp(now), '20261012-143005'));
  it('paths live in reviews/<repo-id>/pr-<id>/<stamp>[-label]/', () => {
    const h = home();
    const p = defaultPaths('github.com__o__r', 42, { env: { XT_SKILLS_HOME: h }, now, label: 'jev run/2' });
    assert.equal(p.dir, path.join(h, SKILL, 'reviews', 'github.com__o__r', 'pr-42', '20261012-143005-jev-run-2'));
    assert.equal(p.json, path.join(p.dir, 'pr-42.json'));
    assert.equal(p.report, path.join(p.dir, 'pr-42.md'));
  });
  it('a second run in the same second gets a suffix instead of reusing the folder', () => {
    const h = home();
    const a = defaultPaths('r', 1, { env: { XT_SKILLS_HOME: h }, now });
    fs.mkdirSync(a.dir, { recursive: true });
    const b = defaultPaths('r', 1, { env: { XT_SKILLS_HOME: h }, now });
    assert.equal(b.dir, `${a.dir}-2`);
  });
});

describe('collect keeps the newest run per PR', () => {
  it('drops older logs of the same PR, keeps other PRs', () => {
    const d = home();
    const w = (name, pr, createdAt) => { const f = path.join(d, name); fs.writeFileSync(f, JSON.stringify({ pr, createdAt, results: [] })); return f; };
    const files = [
      w('a.laya.json', { repoId: 'r', id: 1 }, '2026-10-01T00:00:00Z'),
      w('b.laya.json', { repoId: 'r', id: 1 }, '2026-10-02T00:00:00Z'),
      w('c.laya.json', { repoId: 'r', id: 2 }, '2026-10-01T00:00:00Z'),
    ];
    const { logs, skipped } = latestPerPr(files);
    assert.equal(skipped, 1);
    assert.deepEqual(logs.map((l) => path.basename(l.file)).sort(), ['b.laya.json', 'c.laya.json']);
  });
});
