// Builds fresh work folders (outside the repo) + prompt files for every case/arm/repetition,
// then routes the B prompts with the real router (Jev live, gate+sc, apply). Usage: node make_tasks.mjs <workRoot>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadTask, prepare, subagentPrompt } from '../../../../.claude/skills/subagent-model-router/bench/bench.mjs';
const root = path.resolve(process.argv[2]);
const here = import.meta.dirname;
const CASES = ['e1-locate', 'e2-count', 'r1-rename', 'f1-paginate', 'd3-maplimit', 'd5-deps'];
const NOTE = '\n\nOnly use files inside that directory; other folders of the machine hold unrelated material and must not be read.';
const index = [];
for (const rep of [1, 2]) for (const id of CASES) for (const arm of ['A', 'B']) {
  const dir = path.join(root, `${id}.${arm}.r${rep}`);
  prepare(id, dir);
  const prompt = subagentPrompt(loadTask(id), dir) + NOTE;
  const pf = path.join(root, `${id}.${arm}.r${rep}.prompt.txt`);
  fs.writeFileSync(pf, prompt);
  const e = { case: id, arm, rep, dir, promptFile: pf };
  if (arm === 'B') {
    const r = spawnSync(process.execPath, [path.join(here, '../../../../.claude/skills/subagent-model-router/scripts/route.mjs'), '--mode', 'apply', '--provider', 'jev', '--policy', 'gate+sc', '--k', '3', '--task-file', pf, '--type', loadTask(id).type, '--json'], { encoding: 'utf8', env: process.env });
    try { e.route = JSON.parse(r.stdout); } catch { e.route = { error: r.stderr || r.stdout }; }
    e.model = e.route.tier ?? null;
    fs.writeFileSync(path.join(here, 'evidence/routes', `${id}.B.r${rep}.json`), JSON.stringify(e.route, null, 2));
  } else e.model = 'sonnet';
  index.push(e);
  console.log(`${id}.${arm}.r${rep} -> ${e.model}`);
}
fs.writeFileSync(path.join(here, 'evidence/run-index.json'), JSON.stringify(index, null, 2));
