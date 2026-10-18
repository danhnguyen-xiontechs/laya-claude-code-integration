#!/usr/bin/env node
// finalize.mjs - writes manifest.json for the round-2 retro run of context-curator. Usage: node finalize.mjs cur
// Needs env HEADLINE (plain headline with the top suggestion in one sentence at the end).
import fs from 'node:fs';
import path from 'node:path';
const EXP = import.meta.dirname;
const MODEL = 'haiku (claude-haiku-5-5), forced by the user';
const dev = [
  'Round 2 of the PILOT retro loop: the top suggestion of round 1 (improvements.md: print a ranked pointer list instead of the curated view, keep the full log on disk) was applied as a flag-controlled change. Tool code: JEV review worktree claude/review-5-plans-idea-folder-ce4d36 at e551872 plus its uncommitted round-1 files, as a scratch engine copy plus the round-2 patch in tool-change/curator-r2.patch (committed here on claude/context-curator-round2). Nothing was committed or changed in the JEV repo.',
  'Only suggestion 1 was applied. Suggestion 2 part (protect WARNING lines in alwaysKeep) was tried, then REVERTED: the noise generator writes WARNING lines, so it pinned 178 of 408 h04 chunks and cut less. The omitMaxP threshold was not re-evaluated on held-out scenarios (not done this round).',
  'Opus review of the round-2 diff (agent-review.json): two Majors (Jev scores could not reach the printed pointers; config.load() dropped the curator key) were FIXED before measuring and re-checked. Open at measurement time, not fixed (accepted for this run by the orchestrator, not by the user): one Minor (bad curator config values crash the CLI) and one Suggestion (failures past the fourth anchor may go unlisted). Round-1 open findings are unchanged: the threshold is in-sample, and an omitted chunk may hold text Jev never saw.',
  'Arm A prompt and command are the same as round 1. The one B sentence about the tool was rewritten to describe the pointer list; the B wrapper command is the same. Arm A checked mechanically (subagent_usage.mjs --forbid): forbiddenCalls = 0 in all 8 arm-A runs, so no re-run. Arm-B forbidden hits are the wrapper call (expected).',
  'Answer key kept away: the grader (collect_grade.mjs) lives in the repo folder, outside every work folder; keyCalls = 0 in all runs; siblingReads = 0.',
  'Case agents ran on Haiku 5.5 with effort xhigh (forced by the user); Opus was used for the change, the diff review and this improvements review. 4 cases x 2 repetitions per arm = 16 agents; at most 6 in flight; A and B of a case in the same message, repetition 2 launched B first.',
  'Every case passes in both arms, so pass counts cannot separate the arms. Token totals vary between repetitions of the same arm by up to 2x (h04 A: 446k and 312k), so the +7% is within the noise. Directional only: 4 cases x 2 repetitions.',
  'Jev answered all 80 questions per B run (adv=ok, about 1.0-1.3 s). Some run records show jevState "pending" at the time the wrapper printed; the advice file was complete (answers = 80) in every run.',
];
const m = {
  schemaVersion: 1,
  experimentId: path.basename(EXP),
  tool: { name: 'context-curator', kind: 'helper', provider: 'JEV', commit: 'round-1 state e551872 + uncommitted curator.py; round-2 patch tool-change/curator-r2.patch', branch: 'claude/context-curator-round2 (this repo)' },
  status: 'WAITING_FOR_USER_FINAL_REVIEW',
  recommendation: 'INSUFFICIENT_EVIDENCE',
  confidence: 'LOW',
  headline: process.env.HEADLINE,
  approvals: { ideaApprovedAt: null, finalDecision: null, finalDecisionAt: null },
  arms: [
    { id: 'A', name: 'Plain Claude (pytest output, full log saved to .tool-output/last.log, no tool)', candidateEnabled: false, engineEnabled: false, model: MODEL, effort: 'xhigh' },
    { id: 'B', name: 'Claude + context-curator (round 2: ranked pointer list printed, full log on disk, Jev live)', candidateEnabled: true, engineEnabled: true, model: MODEL, effort: 'xhigh', engineVersion: 'typesafe/jev-1.13 via OpenRouter decisions API' },
  ],
  evaluation: {
    planVersion: 'design.md (round 1, unchanged for round 2)',
    datasetVersion: 'JEV examples/scenarios h02, h04, h06, h07 (gold.json removed from the copies); same as round 1',
    caseCount: 4, repetitions: 2, criteriaFrozenAt: '2026-10-18',
    tokenScope: 'all tokens of each case agent\'s session (input + output + cache read + cache write), from its subagent transcript',
    deviations: dev,
  },
  artifacts: {
    ideaBrief: 'idea-brief.md', design: 'design.md', experimentPlan: null, unitTestReport: 'unit-tests.json', agentReview: 'agent-review.json',
    perToolReport: 'report.html', perToolHtmlReport: 'report.html', mainReport: '../../index.html',
    runDirectories: ['runs/A-claude/r1', 'runs/A-claude/r2', 'runs/B-claude-jev/r1', 'runs/B-claude-jev/r2'],
    rawResults: ['evidence/texts', 'evidence/answers', 'evidence/usage.json', 'evidence/run-index.json', 'evidence/_logs', 'evidence/grades.json'],
    executionLogs: [],
    baseline: 'reports/skill-tool-lifecycle/context-curator/20261018-curator-agent-01 (round 1, linked from idea-brief.md)',
    toolChange: 'tool-change/curator-r2.patch, tool-change/CHANGES.md',
  },
};
fs.writeFileSync(path.join(EXP, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('manifest written');
