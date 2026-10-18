#!/usr/bin/env node
// Builds the agent-run work folders for 20261017-cte-agent-02 (codebase-task-explorer, rework re-measure).
//
// Usage: node make_tasks.mjs --base <baseDir> --scratch <scratchCteDir>
//                            [--tasks tasks-new.json] [--rg <rg.exe>] [--reps 2]
//
// Scrubbed source (run once, by hand, before this script; the commands used):
//   git archive <measured commit> | tar -x -C <base>/src
//   cd <base>/src && rm -rf reports report HANDOFF*.md .xt-skills \
//     .claude/skills/codebase-task-explorer/eval .claude/skills/codebase-task-explorer/tests
//   git init -q && git add -A && git -c user.name=cte -c user.email=cte@local commit -qm "scrubbed snapshot"
//
// Writes, per case (first N of tasks.json) and per arm (A = plain candidate list, B = the tool):
//   <base>/w/<caseId>-<hex>/repo   a full copy of the scrubbed snapshot (own git index for git ls-files)
//   <base>/w/<caseId>-<hex>/find.mjs  the helper, same text in both arms except the lib it loads
//   <base>/lib/f1.mjs (A) and <base>/lib/f2.mjs (B), <base>/bin/rg.exe (ripgrep for both helpers)
//   <scratch>/workmap.json  case, arm, work folder and the exact prompt for each subagent (not in the work folder)
// The hex id is random, so the work folder names do not say which arm they are.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = opt('--base');
const scratch = opt('--scratch');
const tasksFile = opt('--tasks', path.join(import.meta.dirname, 'tasks-new.json'));
const rgSrc = opt('--rg', 'C:/Users/ADMIN/AppData/Local/Programs/Microsoft VS Code/16507d91be/resources/app/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/win32-x64/rg.exe');
const reps = Number(opt('--reps', 2));
if (!base || !scratch) {
  console.error('Usage: node make_tasks.mjs --base <baseDir> --scratch <scratchCteDir> [--tasks f] [--rg f] [--cases 4]');
  process.exit(2);
}
const here = import.meta.dirname;
const src = path.join(base, 'src');
if (!fs.existsSync(path.join(src, '.git'))) {
  console.error(`scrubbed snapshot missing or not a git repo: ${src} (see the header for the commands)`);
  process.exit(1);
}

const gold = JSON.parse(fs.readFileSync(tasksFile, 'utf8')).tasks;
const mode = (t) => t.mode;

// fresh folders each time (logs and first outputs too: they must only hold what the agents produce)
fs.rmSync(path.join(base, 'w'), { recursive: true, force: true });
fs.rmSync(path.join(scratch, '_logs'), { recursive: true, force: true });
fs.rmSync(path.join(scratch, 'first'), { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'w'), { recursive: true });
fs.mkdirSync(path.join(base, 'lib'), { recursive: true });
fs.mkdirSync(path.join(base, 'bin'), { recursive: true });
fs.mkdirSync(scratch, { recursive: true });
fs.copyFileSync(path.join(here, 'helpers', 'f1.mjs'), path.join(base, 'lib', 'f1.mjs'));
fs.copyFileSync(path.join(here, 'helpers', 'f2.mjs'), path.join(base, 'lib', 'f2.mjs'));
fs.copyFileSync(rgSrc, path.join(base, 'bin', 'rg.exe'));

const tpl = fs.readFileSync(path.join(here, 'helpers', 'find.mjs.tpl'), 'utf8');
const fwd = (p) => p.split(path.sep).join('/');
const map = [];
for (let rep = 1; rep <= reps; rep++) for (const t of gold) {
  for (const [arm, lib] of [['A', 'f1'], ['B', 'f2']]) {
    const key = `${t.id}.r${rep}`;
    const hex = crypto.randomBytes(3).toString('hex');
    const work = path.join(base, 'w', `${t.id}-${hex}`);
    const repo = path.join(work, 'repo');
    fs.mkdirSync(work, { recursive: true });
    fs.cpSync(src, repo, { recursive: true });
    const helper = tpl
      .replace('__BIN__', JSON.stringify(fwd(path.join(base, 'bin'))))
      .replace('__LIB__', JSON.stringify(fwd(path.join(base, 'lib', `${lib}.mjs`))))
      .replace('__REPO__', JSON.stringify(fwd(repo)))
      .replace('__MODE__', JSON.stringify(mode(t)))
      .replace('__CASE__', JSON.stringify(key))
      .replace('__LOGDIR__', JSON.stringify(fwd(path.join(scratch, '_logs'))))
      .replace('__FIRSTDIR__', JSON.stringify(fwd(path.join(scratch, 'first'))));
    fs.writeFileSync(path.join(work, 'find.mjs'), helper);
    const helperCmd = `node "${fwd(path.join(work, 'find.mjs'))}" "${t.task}" "${t.queries.join('|')}"`;
    const prompt = [
      `Work folder: ${fwd(work)}`,
      `Read-only task in the repo at ${fwd(repo)}. ${t.task}. Find where to start: answer with the 5 most relevant file paths, most relevant first, one line of reasoning each. You may search and read files; do not modify anything. A helper exists: run \`${helperCmd}\` and use its output as a starting point. ${arm === 'A' ? 'No codebase-task-explorer skill is available in this task: decide yourself; do not look for or use any skill or other script.' : 'The helper runs the codebase-task-explorer ranking (rules + Jev); do not use any other skill.'}`,
    ].join('\n');
    map.push({ caseId: t.id, rep, key, mode: mode(t), arm, workDir: fwd(work), repo: fwd(repo), helper: fwd(path.join(work, 'find.mjs')), prompt });
  }
}
fs.writeFileSync(path.join(scratch, 'workmap.json'), JSON.stringify(map, null, 2));
console.log(JSON.stringify(map.map(({ key, arm, workDir }) => ({ key, arm, workDir })), null, 2));
