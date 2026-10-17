#!/usr/bin/env node
// Finalizes the manifest and the review file after the A/B run (run 2). Run once: node finalize.mjs
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const mf = path.join(here, 'manifest.json');
const m = JSON.parse(fs.readFileSync(mf, 'utf8'));

m.status = 'WAITING_FOR_USER_FINAL_REVIEW';
m.recommendation = 'REWORK';
m.confidence = 'LOW';
m.headline = 'On 4 small fixtures plain Haiku 5.5 already gets every case right (4/4), and so does Haiku with the planner, but the planner arm spends 2.5 times the tokens (429k -> 1,093k) on extra turns for reading and acting on the planner output. The fixtures are too easy to show any planner value, and one Critical bug is still open (layer() inverts the order when a prerequisite is incomplete). Fix it, then measure on larger, harder batches.';
m.arms[0].model = 'haiku (claude-haiku-5-5), forced by the user; the router would have said sonnet/opus';
m.arms[1].model = m.arms[0].model;
m.evaluation.deviations = [
  'Run 1 of arm A was discarded: 3 of 4 arm-A agents (03-api-dto, 06-explicit, 07-cycle) called the story-batch-planner skill themselves and ran the real planner, because every subagent sees the session\'s skill list. Run 1 is kept in evidence/contaminated-run1/ and is not in any number here.',
  'Arm A was re-run in new folders <case>.A2 with one added sentence ("No planner tool is available in this task: decide from the JSON yourself. Do not look for or use any skill, planner or script."). Arm B differs from A only by its own sentence about the planner. All 4 re-run agents used just a file read and the answer (2 tool calls), so the planner was not used. Arm B (run 1) is unchanged.',
  'The independent review left 1 Critical and 4 Major findings open (planner layer() inverts an incomplete prerequisite; a mutual dependency is not always reported as a cycle; a batch policy can turn on Jev; no penalty for over-serialising; in-sample tests). The user accepted them for this run; none touches what the four measured fixtures check. They are not fixed.',
  'All case agents ran on Haiku 5.5 with effort xhigh by the user\'s decision. The model router, asked for these prompts, said sonnet (03, 06, 07) and opus (04); the reviewer ran on opus.',
  'Four small fixtures (3-5 stories), one repetition: directional only. Every case passes in both arms, so the comparison cannot show whether the planner helps on a hard batch.',
  'TypeSafe Jev is live only on the ambiguous pairs of 03-api-dto and 06-explicit; 04-migration and 07-cycle have no ambiguous pair, so arm B there is rules only. Jev stays in shadow mode and never changes the waves.',
  'In arm B the agents were free to disagree with the planner: on 06-explicit the agent overrode its wave for S-4 and on 03-api-dto it kept the planner\'s serial order. The score is of the agent\'s final answer, not of the planner output.',
  'The 04-migration arm-B log has 3 extra lines from the agent running the wrapper three times (--help, --summary, no args); the token and pass numbers are unaffected, the engine-call count for that case is inflated.',
  'The tool, fixtures and workflow were read from the base checkout D:\\XionTechs\\Laya (commit 7849acd; the tool last changed at 73c4bda). Experiment files were written under the session worktree path, as the session\'s edit guard required.',
  'The subagents folder is flat (agent-*.jsonl files directly in subagents/); subagent_usage.mjs matches each case by the work folder in its prompt.',
];
m.artifacts.perToolReport = 'report.html';
m.artifacts.perToolHtmlReport = 'report.html';
m.artifacts.mainReport = '../../index.html';
m.artifacts.runDirectories = ['runs/A-claude/r1', 'runs/B-claude-jev/r1'];
m.artifacts.rawResults = ['evidence/texts', 'evidence/answers', 'evidence/subagent-usage.json', 'evidence/run-index.json', 'evidence/_logs'];
fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');

// open Critical/Major findings: the user accepted them for this run (the skill's way to close them), text kept
const rf = path.join(here, 'agent-review.json');
const r = JSON.parse(fs.readFileSync(rf, 'utf8'));
for (const f of r.findings)
  if (['Critical', 'Major'].includes(f.severity) && /^open/i.test(f.resolution ?? 'open'))
    f.resolution = `accepted by the user for this run (2026-10-17), not fixed. ${f.resolution.replace(/^open[^:]*:\s*/i, '')}`;
fs.writeFileSync(rf, JSON.stringify(r, null, 2) + '\n');
console.log('manifest and review updated');
