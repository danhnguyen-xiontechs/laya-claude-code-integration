// Builds fresh work folders (outside the repo) and prompt files for every case/arm/repetition, then routes
// the B arm with the real router in cascade mode (route.mjs --cascade, Jev live, apply).
// Arm A is always sonnet. Usage: node make_tasks.mjs <workRoot>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadTask, prepare, subagentPrompt } from '../../../../.claude/skills/subagent-model-router/bench/bench.mjs';
const root = path.resolve(process.argv[2]);
const here = import.meta.dirname;
const ROUTE = path.join(here, '../../../../.claude/skills/subagent-model-router/scripts/route.mjs');
const CASES = ['e1-locate', 'e2-count', 'r1-rename', 'f1-paginate', 'd3-maplimit', 'd5-deps', 'd1-lru', 'd4-expr'];
const NOTE = '\n\nOnly use files inside that directory; other folders of the machine hold unrelated material and must not be read.';
const index = [];
for (const rep of [1, 2]) for (const id of CASES) for (const arm of ['A', 'B']) {
  const dir = path.join(root, `${id}.${arm}.r${rep}`);
  prepare(id, dir);
  const task = loadTask(id);
  const prompt = subagentPrompt(task, dir) + NOTE;
  const pf = path.join(root, `${id}.${arm}.r${rep}.prompt.txt`);
  fs.writeFileSync(pf, prompt);
  const e = { case: id, kind: task.kind, arm, rep, dir, promptFile: pf };
  if (arm === 'B') {
    const r = spawnSync(process.execPath, [ROUTE, '--cascade', '--mode', 'apply', '--provider', 'jev', '--k', '3', '--task-file', pf, '--type', task.type, '--json'], { encoding: 'utf8', env: process.env });
    try { e.route = JSON.parse(r.stdout); } catch { e.route = { error: r.stderr || r.stdout }; }
    e.model = e.route.tier ?? null;
    fs.writeFileSync(path.join(here, 'evidence/routes', `${id}.B.r${rep}.json`), JSON.stringify(e.route, null, 2));
  } else e.model = 'sonnet';
  index.push(e);
  console.log(`${id}.${arm}.r${rep} -> ${e.model}${e.route ? ` (applied ${e.route.applied}, providerCalls ${e.route.providerCalls})` : ''}`);
}
fs.writeFileSync(path.join(here, 'evidence/run-index.json'), JSON.stringify(index, null, 2));
