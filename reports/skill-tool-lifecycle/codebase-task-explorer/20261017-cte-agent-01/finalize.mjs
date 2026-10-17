#!/usr/bin/env node
// Writes agent-review.json (from the reviewer's last hand-back message) and manifest.json after the A/B run.
// Usage: node finalize.mjs <reviewerTranscript.jsonl>
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const transcript = process.argv[2];
if (!transcript) { console.error('Usage: node finalize.mjs <reviewerTranscript.jsonl>'); process.exit(2); }

// ---- review: the findings JSON at the start of the reviewer's last SubagentHandback message
let msg = null;
for (const l of fs.readFileSync(transcript, 'utf8').split('\n')) {
  let e; try { e = JSON.parse(l); } catch { continue; }
  if (e.type !== 'assistant') continue;
  for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string' && c.input.message.includes('"findings"')) msg = c.input.message;
}
if (!msg) { console.error('no review message found'); process.exit(1); }
const start = msg.indexOf('{');
let depth = 0, end = -1, inStr = false, esc = false;
for (let i = start; i < msg.length; i++) {
  const ch = msg[i];
  if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
  if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) { end = i; break; }
}
const review = JSON.parse(msg.slice(start, end + 1));
const DESIGN_FIXED = [
  [/same pool for both arms|premise is false/i, 'fixed: arm A now uses the tool\'s own codemap pool in codemap order (helpers/f1.mjs v2), design.md v1.2'],
  [/different amounts of text|top 10 rows/i, 'fixed: arm A shows the same top 10 rows as arm B (helpers/f1.mjs v2)'],
  [/success thresholds|B > A|at least as many/i, 'fixed: one threshold in design.md v1.2 (strictly more passes, or equal with higher mean recall, and no case worse)'],
];
for (const f of review.findings) {
  const designRef = /20261017-cte-agent-01/.test(f.ref ?? '');
  const fix = designRef && DESIGN_FIXED.find(([rx]) => rx.test(f.finding));
  if (fix) f.resolution = fix[1];
  else if (['Critical', 'Major'].includes(f.severity)) f.resolution = 'accepted by the user for this run (2026-10-17), not fixed';
  else f.resolution = 'open';
}
fs.writeFileSync(path.join(here, 'agent-review.json'), JSON.stringify(review, null, 2) + '\n');

// ---- manifest
const mf = {
  schemaVersion: 1,
  experimentId: '20261017-cte-agent-01',
  tool: { name: 'codebase-task-explorer', kind: 'skill', provider: 'JEV', commit: '7849acd', branch: 'main' },
  status: 'WAITING_FOR_USER_FINAL_REVIEW',
  recommendation: 'REWORK',
  confidence: 'LOW',
  headline: 'On 4 find-where-to-start tasks with Haiku 5.5, the same codemap pool in raw order (A) got all 4 right, and the pool ranked by the tool\'s rules plus Jev (B) got 3 of 4 (t3-refactor-decide missed the eval/shadow-hook group), using 11% more tokens (2.89M -> 3.22M). B is not better here and one case is worse, which is within agent noise at 4 cases; 8 Major review findings are open. Fix the failure paths, then measure on harder tasks.',
  approvals: { ideaApprovedAt: null, finalDecision: null, finalDecisionAt: null },
  arms: [
    { id: 'A', name: 'Plain Claude + unranked candidate list (codemap pool, raw order, top 10)', candidateEnabled: false, engineEnabled: false, model: 'haiku (claude-haiku-5-5), forced by the user', effort: 'xhigh' },
    { id: 'B', name: 'Claude + codebase-task-explorer (rules + Jev batches, top 10)', candidateEnabled: true, engineEnabled: true, model: 'haiku (claude-haiku-5-5), forced by the user', effort: 'xhigh', engineVersion: 'typesafe/jev-1.13 via OpenRouter decisions API, advisory ranking' },
  ],
  evaluation: {
    planVersion: 'agent-retro-v1.2',
    datasetVersion: 'eval/tasks.json, first 4 tasks, repo copy of main @ 7849acd (answer-key files removed)',
    caseCount: 4,
    repetitions: 1,
    criteriaFrozenAt: null,
    tokenScope: 'all tokens of each case agent\'s session (input + output + cache read + cache write), from its subagent transcript',
    deviations: [
      'Arm A was changed after the independent review: it first listed git ls-files / rg matches, a different retrieval from the tool\'s codemap pool. Now both arms use the same codemap pool and show 10 rows; A is in codemap\'s raw order, B is ranked by rules + Jev. The only difference is ranking and B\'s extra columns (why matched, importers).',
      'The independent review left 8 Major findings open (Jev failure paths reported wrongly, fallback skipping dot-directories and not deterministic, JUNK filter dropping packages/ and bin/, and others). The user accepted them for this run. They concern failure paths and the fallback; this run exercised codemap + Jev on the happy path only (0 Jev fallbacks in 4 cases), so it says nothing about them.',
      'Case agents ran on Haiku 5.5 with effort xhigh by the user\'s decision (the router would have said sonnet or opus); both arms the same. The reviewer ran on opus.',
      'Answers are scored by score.mjs on the numbered list of the agent\'s answer (a path in a preamble or notes does not count); an answer with fewer than five numbered paths falls back to scanning the whole text. Same rule for both arms, written before scoring but after the answers were seen.',
      'Not the real skill: the agents got a helper command in both arms and were not given SKILL.md, so the run measures the script\'s ranking, not Stage 0 (choosing queries; the queries come from the tool author\'s pilot set) or Stage 4 (verification). No agent used the Skill tool or called explore.mjs itself (checked in the transcripts).',
      'Gold file names occur in ordinary code and docs of the repo copy; only answer-key artifacts were removed. An agent can find a gold file by name, in both arms.',
      'Four cases, one repetition: one flip decides the verdict on a case. t3-refactor-decide B put tests/variants.test.mjs and tests/helpers.mjs ahead of shadow-hook.mjs and eval.mjs; its own list, not the helper\'s order, decided that, so this is agent choice as much as ranking.',
      'The tool writes a .codemap/ cache into the repo copy and appends each run to ~/.claude/codebase-task-explorer/runs.jsonl (no opt-out); the 4 smoke runs before the real run used the same copies.',
      'Experiment files were written under the session worktree path as the session\'s edit guard required; the tool and the repo copy were read from the base checkout and a scrubbed git archive.',
    ],
  },
  artifacts: {
    ideaBrief: 'idea-brief.md', design: 'design.md', experimentPlan: null, unitTestReport: 'unit-tests.json', agentReview: 'agent-review.json',
    perToolReport: 'report.html', perToolHtmlReport: 'report.html', mainReport: '../../index.html',
    runDirectories: ['runs/A-claude/r1', 'runs/B-claude-jev/r1'],
    rawResults: ['evidence/texts', 'evidence/answers', 'evidence/logs', 'evidence/usage.scrubbed.json', 'evidence/scores.json'],
    executionLogs: [],
  },
};
fs.writeFileSync(path.join(here, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');
console.log(`review: ${review.findings.length} findings; manifest written`);
