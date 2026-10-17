#!/usr/bin/env node
// Arm A re-run (run 2). In run 1, three of four arm-A agents called the story-batch-planner skill themselves (every
// subagent sees the session's skill list), so arm A was not plain. New folders <case>.A2 (new path, so transcripts
// are not matched to run 1) and an A prompt that states the planner is not available. Everything else is unchanged.
// Usage: node make_rerun_a.mjs   -> writes <SCRATCH>/work/<case>.A2/{batch.json,plan.mjs}, <SCRATCH>/prompts/<case>.A2.txt
import fs from 'node:fs';
import path from 'node:path';

const SCRATCH = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\claude\\D--XionTechs-Laya--claude-worktrees-skill-build-workflow-review-af9324\\82e30143-e152-4ee9-b306-ffbd1654c94d\\scratchpad\\sbp';
const CASES = ['03-api-dto', '04-migration', '06-explicit', '07-cycle'];
const PROMPT = 'Here is a batch of stories (JSON in {FILE}). Decide which stories can be implemented in parallel by separate agents and in what order. Answer with one JSON object {"waves": [[ids...]], "needs_decision": [ids...]} and one line of reasoning.';
const A_SENTENCE = 'No planner tool is available in this task: decide from the JSON yourself. Do not look for or use any skill, planner or script.';

for (const c of CASES) {
  const dir = path.join(SCRATCH, 'work', `${c}.A2`);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SCRATCH, 'work', `${c}.A`, 'batch.json'), path.join(dir, 'batch.json'));
  fs.writeFileSync(path.join(dir, 'plan.mjs'), "#!/usr/bin/env node\n// Neutral wrapper, arm A: the planner is not available to this arm.\nconsole.log('planner disabled');\n");
  const prompt = `Work folder: ${dir}\n${PROMPT.replace('{FILE}', path.join(dir, 'batch.json'))}\n${A_SENTENCE}`;
  fs.writeFileSync(path.join(SCRATCH, 'prompts', `${c}.A2.txt`), prompt);
}
console.log('A2 folders and prompts written');
