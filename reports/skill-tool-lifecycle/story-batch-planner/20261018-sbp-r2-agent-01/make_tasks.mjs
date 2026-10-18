#!/usr/bin/env node
// make_tasks.mjs — work folders, neutral plan.mjs wrappers and prompts for 20261018-sbp-r2-agent-01.
// 3 harder batches (cases/*.json, no answer key inside; the gold lives in grade.mjs, written after the run),
// 2 repetitions, arms A (no planner) and B (planner, Jev shadow on). Everything is written under SCRATCH.
// Usage: node make_tasks.mjs
import fs from 'node:fs';
import path from 'node:path';

const EXP = import.meta.dirname;
const TOOL_PLAN = path.resolve(EXP, '..', '..', '..', '..', '.claude', 'skills', 'story-batch-planner', 'scripts', 'plan.mjs');
const SCRATCH = process.env.SBP_SCRATCH;
if (!SCRATCH) { console.error('set SBP_SCRATCH'); process.exit(2); }
const LOGS = path.join(SCRATCH, '_logs');
const HOMES = path.join(SCRATCH, '_home');
const CASES = ['h1-payroll', 'h2-portal', 'h3-hr'];
const REPS = ['r1', 'r2'];

const PROMPT = 'Here is a batch of stories (JSON in {FILE}). Decide which stories can be implemented in parallel by separate agents and in what order. Answer with one JSON object {"waves": [[ids...]], "needs_decision": [ids...]} and one line of reasoning.';
const A_SENTENCE = 'No planner tool is available in this task: decide from the JSON yourself. Do not look for or use any skill, planner or script.';
const B_SENTENCE = 'A planner tool is available: run `node plan.mjs --summary` in this folder.';
const WRAPPER_A = "#!/usr/bin/env node\nconsole.log('planner disabled');\n";
const wrapperB = (key) => `#!/usr/bin/env node
// Neutral wrapper, arm B: real story-batch-planner on this folder's batch (Jev shadow on); logs one line per call.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const KEY = ${JSON.stringify(key)};
const PLANNER = ${JSON.stringify(TOOL_PLAN)};
const LOGS = ${JSON.stringify(LOGS)};
const HOME = ${JSON.stringify(path.join(HOMES, key))};
const here = import.meta.dirname;
fs.mkdirSync(LOGS, { recursive: true }); fs.mkdirSync(HOME, { recursive: true });
const planJson = path.join(LOGS, KEY + '.plan.json');
const r = spawnSync(process.execPath, [PLANNER, '--in', path.join(here, 'batch.json'), '--out', planJson, '--jev', '--summary'], { encoding: 'utf8', env: { ...process.env, HOME, USERPROFILE: HOME } });
if (r.status !== 0) { process.stderr.write(r.stderr || 'planner failed\\n'); process.exit(r.status ?? 1); }
process.stdout.write(r.stdout);
const plan = JSON.parse(fs.readFileSync(planJson, 'utf8'));
const jev = plan.edges.filter((e) => e.jev_suggestion).map((e) => ({ pair: e.pair, deterministic: e.relation, jev: e.jev_suggestion.label, p: e.jev_suggestion.p ?? null, valid: e.jev_suggestion.valid, error: e.jev_suggestion.error ?? null }));
fs.appendFileSync(path.join(LOGS, KEY + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), key: KEY, waves: plan.waves.map((w) => w.stories), jev_shadow: plan.jev_shadow ?? null, jev }) + '\\n');
`;
fs.rmSync(path.join(SCRATCH, 'work'), { recursive: true, force: true });
fs.rmSync(LOGS, { recursive: true, force: true });
fs.mkdirSync(path.join(SCRATCH, 'prompts'), { recursive: true });
for (const c of CASES) for (const rep of REPS) for (const arm of ['A', 'B']) {
  const key = `${c}.${arm}.${rep}`;
  const dir = path.join(SCRATCH, 'work', key);
  fs.mkdirSync(dir, { recursive: true });
  const { expected, ...batch } = JSON.parse(fs.readFileSync(path.join(EXP, 'cases', `${c}.json`), 'utf8'));
  fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify(batch, null, 2));
  fs.writeFileSync(path.join(dir, 'plan.mjs'), arm === 'A' ? WRAPPER_A : wrapperB(key));
  const prompt = `Work folder: ${dir}\n${PROMPT.replace('{FILE}', path.join(dir, 'batch.json'))}\n${arm === 'A' ? A_SENTENCE : B_SENTENCE}`;
  fs.writeFileSync(path.join(SCRATCH, 'prompts', `${key}.txt`), prompt);
}
console.log('ok', fs.readdirSync(path.join(SCRATCH, 'prompts')).length, 'prompts');
