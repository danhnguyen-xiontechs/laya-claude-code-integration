#!/usr/bin/env node
// make_tasks.mjs — builds the work folders, the neutral plan.mjs wrappers and the prompt files for the
// story-batch-planner agent run (20261017-sbp-agent-01). Run once, before step 6.
//
// The tool is read from the base checkout (read only). Nothing is written into the tool or the repo here:
// everything goes under the scratch folder.
//
// Usage: node make_tasks.mjs
// Writes: <SCRATCH>/work/<case>.<A|B>/{batch.json, plan.mjs}, <SCRATCH>/prompts/<case>.<A|B>.txt
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'D:\\XionTechs\\Laya';                                   // base checkout that holds the tool
const TOOL_PLAN = path.join(BASE, '.claude', 'skills', 'story-batch-planner', 'scripts', 'plan.mjs');
const FIXTURES = path.join(BASE, '.claude', 'skills', 'story-batch-planner', 'fixtures');
const SCRATCH = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\claude\\D--XionTechs-Laya--claude-worktrees-skill-build-workflow-review-af9324\\82e30143-e152-4ee9-b306-ffbd1654c94d\\scratchpad\\sbp';
const LOGS = path.join(SCRATCH, '_logs');
const HOMES = path.join(SCRATCH, '_home');
const CASES = [
  { id: '03-api-dto', fixture: '03-api-dto.json' },
  { id: '04-migration', fixture: '04-migration.json' },
  { id: '06-explicit', fixture: '06-explicit.json' },
  { id: '07-cycle', fixture: '07-cycle.json' },
];

const PROMPT = 'Here is a batch of stories (JSON in {FILE}). Decide which stories can be implemented in parallel by separate agents and in what order. Answer with one JSON object {"waves": [[ids...]], "needs_decision": [ids...]} and one line of reasoning.';
const B_SENTENCE = 'A planner tool is available: run `node plan.mjs --summary` in this folder.';

const WRAPPER_A = `#!/usr/bin/env node
// Neutral wrapper, arm A: the planner is not available to this arm.
console.log('planner disabled');
`;

const wrapperB = (id) => `#!/usr/bin/env node
// Neutral wrapper, arm B: runs the real story-batch-planner plan.mjs on this folder's batch (Jev shadow on),
// prints its summary to stdout, and appends one decision line to the run log.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CASE = ${JSON.stringify(id)};
const PLANNER = ${JSON.stringify(TOOL_PLAN)};
const LOGS = ${JSON.stringify(LOGS)};
const HOME = ${JSON.stringify(path.join(HOMES, id))};   // keeps the planner's default Jev log out of the user's home
const here = import.meta.dirname;
fs.mkdirSync(LOGS, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });
const planJson = path.join(LOGS, CASE + '.B.plan.json');
const r = spawnSync(process.execPath, [PLANNER, '--in', path.join(here, 'batch.json'), '--out', planJson, '--jev', '--summary'], {
  encoding: 'utf8',
  env: { ...process.env, HOME, USERPROFILE: HOME },
});
if (r.status !== 0) { process.stderr.write(r.stderr || 'planner failed\\n'); process.exit(r.status ?? 1); }
process.stdout.write(r.stdout);
const plan = JSON.parse(fs.readFileSync(planJson, 'utf8'));
const jev = plan.edges.filter((e) => e.jev_suggestion).map((e) => ({
  pair: e.pair, deterministic: e.relation, jev: e.jev_suggestion.label, p: e.jev_suggestion.p ?? null,
  valid: e.jev_suggestion.valid, error: e.jev_suggestion.error ?? null, latencyMs: e.jev_suggestion.provenance?.latencyMs ?? null,
}));
fs.appendFileSync(path.join(LOGS, CASE + '.B.jsonl'), JSON.stringify({
  t: new Date().toISOString(), case: CASE, arm: 'B', waves: plan.waves.map((w) => w.stories), jev_shadow: plan.jev_shadow ?? null, jev,
}) + '\\n');
`;

fs.rmSync(path.join(SCRATCH, 'work'), { recursive: true, force: true });
fs.mkdirSync(path.join(SCRATCH, 'prompts'), { recursive: true });
for (const c of CASES) for (const arm of ['A', 'B']) {
  const dir = path.join(SCRATCH, 'work', `${c.id}.${arm}`);
  fs.mkdirSync(dir, { recursive: true });
  // the fixture's "expected" block is the answer key: it is removed from the copy both arms read
  const { expected, ...batch } = JSON.parse(fs.readFileSync(path.join(FIXTURES, c.fixture), 'utf8'));
  fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify(batch, null, 2));
  fs.writeFileSync(path.join(dir, 'plan.mjs'), arm === 'A' ? WRAPPER_A : wrapperB(c.id));
  const file = path.join(dir, 'batch.json');
  let prompt = `Work folder: ${dir}\n${PROMPT.replace('{FILE}', file)}`;
  if (arm === 'B') prompt += `\n${B_SENTENCE}`;
  fs.writeFileSync(path.join(SCRATCH, 'prompts', `${c.id}.${arm}.txt`), prompt);
}
// fresh run logs for these cases
fs.mkdirSync(LOGS, { recursive: true });
for (const c of CASES) for (const f of [`${c.id}.B.jsonl`, `${c.id}.B.plan.json`]) fs.rmSync(path.join(LOGS, f), { force: true });
console.log(`work folders and prompts written under ${SCRATCH}`);
