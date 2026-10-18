#!/usr/bin/env node
// build_units.mjs — units (change sets) of ess-be → gold files, PR text, snapshots at the parent commit.
// Writes only under --data (default D:/cte-r3); ess-be is read-only. See design.md section 3.
//   node build_units.mjs [--repo D:/XionTechs/ess-be] [--data D:/cte-r3] [--no-snap]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const REPO = arg('repo', 'D:/XionTechs/ess-be');
const DATA = arg('data', 'D:/cte-r3');
const SNAP = !process.argv.includes('--no-snap');

// design.md section 3 (frozen): merge = PR merge commit (diff against ^1), commit = single commit (diff against ^)
export const UNITS = [
  ['e01', 'e80552a3', 'merge'], ['e02', '991a4f87', 'merge'], ['e03', '7faa2e41', 'merge'], ['e04', '583c8c3a', 'merge'],
  ['e05', '1b357ed5', 'commit'], ['e06', 'ee6d2b2d', 'commit'], ['e07', '1d6d5102', 'commit'], ['e08', '0b02b833', 'merge'],
  ['e09', 'dd99bb9b', 'merge'], ['e10', '9d8dd278', 'merge'], ['e11', '73390274', 'commit'], ['e12', '9ec51510', 'commit'],
];
export const NOT_GOLD = /test|migration|designer|snapshot/i;

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export function goldFrom(nameStatus) {
  return nameStatus.split('\n').filter(Boolean).map((l) => l.split('\t'))
    .filter(([s, p]) => s === 'M' && p.endsWith('.cs') && !NOT_GOLD.test(p)).map(([, p]) => p);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  fs.mkdirSync(path.join(DATA, 'snap'), { recursive: true });
  const out = [];
  for (const [id, sha, kind] of UNITS) {
    const full = git('rev-parse', sha).trim();
    const parent = git('rev-parse', `${full}^1`).trim();
    const gold = goldFrom(git('diff', '--name-status', '--no-renames', parent, full));
    const subject = git('log', '-1', '--format=%s', full).trim();
    const body = git('log', '-1', '--format=%b', full).trim();
    const date = git('log', '-1', '--format=%cI', full).trim();
    const snapDir = path.join(DATA, 'snap', id);
    if (SNAP && gold.length && !fs.existsSync(snapDir)) {
      fs.mkdirSync(snapDir, { recursive: true });
      const tar = path.join(DATA, 'snap', `${id}.tar`);
      git('archive', '--format=tar', '-o', tar, parent);
      execFileSync(process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar', ['-xf', tar, '-C', snapDir]);
      fs.rmSync(tar);
    }
    out.push({ id, sha: full, kind, parent, date, subject, body, gold, dropped: gold.length ? null : 'no modified non-test .cs file' });
    console.log(`${id} gold=${gold.length}${gold.length ? '' : ' DROPPED'}`);
  }
  fs.writeFileSync(path.join(DATA, 'units.json'), JSON.stringify(out, null, 2));
}
