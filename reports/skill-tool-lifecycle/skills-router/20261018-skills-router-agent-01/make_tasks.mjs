#!/usr/bin/env node
// Builds the agent work folders for 20261018-skills-router-agent-01.
// Usage: node make_tasks.mjs --base <baseDir> --scratch <scratchDir> --tool <abs path of the real skills-router folder> [--reps 2]
//
// <base>/src is a scrubbed `git archive HEAD` (commands in design.md): no reports/, no skills-router eval/, tests/ or README.md
// (they hold the gold scenarios and near copies of the case requests). Per case, arm and repetition this makes
//   <base>/w/<caseId>-<hex>/{repo,pick.mjs,request.txt}   (repo = full copy of src; hex id hides the arm)
// and writes the exact prompts to <scratch>/workmap.json (not into any work folder). cases.json (the answer key) is never copied.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = opt('--base'), scratch = opt('--scratch'), tool = opt('--tool');
const reps = Number(opt('--reps', 2));
if (!base || !scratch || !tool) { console.error('Usage: node make_tasks.mjs --base B --scratch S --tool T [--reps 2]'); process.exit(2); }
const here = import.meta.dirname;
const src = path.join(base, 'src');
if (!fs.existsSync(path.join(src, '.claude', 'skills'))) { console.error('scrubbed snapshot missing: ' + src); process.exit(1); }
const cases = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')).cases;
const fwd = (p) => p.split(path.sep).join('/');

fs.rmSync(path.join(base, 'w'), { recursive: true, force: true });
fs.rmSync(path.join(scratch, '_logs'), { recursive: true, force: true });
fs.rmSync(path.join(scratch, 'first'), { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'w'), { recursive: true });
fs.mkdirSync(path.join(base, 'lib'), { recursive: true });
fs.mkdirSync(scratch, { recursive: true });
for (const f of ['common.mjs', 'a.mjs', 'b.mjs']) fs.copyFileSync(path.join(here, 'helpers', f), path.join(base, 'lib', f));
const tpl = fs.readFileSync(path.join(here, 'helpers', 'pick.mjs.tpl'), 'utf8');

const map = [];
for (let rep = 1; rep <= reps; rep++) for (const c of cases) for (const arm of ['A', 'B']) {
  const hex = crypto.randomBytes(3).toString('hex');
  const work = path.join(base, 'w', `t-${hex}`); // neutral name: the case id is the answer key
  const repo = path.join(work, 'repo');
  fs.mkdirSync(work, { recursive: true });
  fs.cpSync(src, repo, { recursive: true });
  fs.writeFileSync(path.join(work, 'request.txt'), c.request + '\n');
  const key = `${c.id}.${arm}.r${rep}`;
  const opaque = hex; // what the helper file knows; collect.mjs maps it back through workmap.json
  fs.copyFileSync(path.join(base, 'lib', arm === 'A' ? 'a.mjs' : 'b.mjs'), path.join(work, '_h.mjs'));
  fs.copyFileSync(path.join(base, 'lib', 'common.mjs'), path.join(work, 'common.mjs'));
  fs.writeFileSync(path.join(work, 'pick.mjs'), tpl
    .replace('__TOOLDIR__', JSON.stringify(fwd(tool)))
    .replace('__LIB__', JSON.stringify(fwd(path.join(work, '_h.mjs'))))
    .replace('__REPO__', JSON.stringify(fwd(repo)))
    .replace('__LOGDIR__', JSON.stringify(fwd(path.join(scratch, '_logs'))))
    .replace('__FIRSTDIR__', JSON.stringify(fwd(path.join(scratch, 'first'))))
    .replace('__KEY__', JSON.stringify(opaque)));
  const toolLine = arm === 'A'
    ? 'No skills-router (or any other routing tool) is available in this task: decide yourself from the list; do not use or run the skills-router skill or its scripts.'
    : 'The helper command above also prints the output of the skills-router tool (a BM25 shortlist and one Jev decision). It is a hint only: you make the final call.';
  const prompt = [
    `Work folder: ${fwd(work)}`,
    `Pick-a-skill task (read-only; do not do the request itself, do not run any skill). A user of the repo at ${fwd(repo)} wrote this request:`,
    `"${c.request}"`,
    `Decide which ONE installed skill, slash command or subagent of this setup best fits the request, or "none" when no dedicated skill is needed and Claude should simply answer or do it directly. The helper prints the installed list: run \`node "${fwd(path.join(work, 'pick.mjs'))}"\`. You may read files in the repo to check a skill.`,
    toolLine,
    'Reply with exactly two lines: `PICK: <skill name exactly as listed, or none>` and one sentence of reasoning.',
  ].join('\n');
  map.push({ caseId: c.id, arm, rep, key, opaque, workDir: fwd(work), prompt });
}
fs.writeFileSync(path.join(scratch, 'workmap.json'), JSON.stringify(map, null, 2));
console.log(map.length + ' work folders');
