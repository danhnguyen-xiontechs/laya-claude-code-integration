#!/usr/bin/env node
// finalize.mjs - writes manifest.json for the retro run. Usage: node finalize.mjs adv|cur
import fs from 'node:fs';
import path from 'node:path';
const EXP = import.meta.dirname;
const TOOL = process.argv[2];
const adv = TOOL === 'adv';
const MODEL = 'haiku (claude-haiku-5-5), forced by the user';
const dev = [
  'Retro run of an already-built PILOT tool: steps 1-3 skipped by the user\'s brief; idea-brief.md and design.md only fix the question and the measurement. Nothing in the tool was changed.',
  'Tool code = JEV worktree claude/review-5-plans-idea-folder-ce4d36 at e551872 plus its UNCOMMITTED files (jev_advisor/curator.py and the curate branch of jev_advisor/__main__.py); a copy of the jev_advisor package in scratch is the engine. All 84 tests of that worktree pass.',
  'Open Critical/Major review findings were pre-accepted by the user for this run (2026-10-18) and are not fixed (see agent-review.json): ' + (adv ? 'redaction misses prefixed secret names.' : 'the omitMaxP threshold was tuned on the same 19 scenarios (in-sample), alwaysKeep does not protect WARNING lines (the gold evidence of h02 and h04 is a WARNING), a chunk can be omitted although Jev saw only a truncated part of it, and the advisor redaction finding.'),
  'The reviewer\'s measurement-design findings were fixed before the run: arm A also saves its full log to .tool-output/last.log (so the saved log is not credited to the tool), and the key-access check also flags reads of the JEV repo folders (docs/runs/hard/README.md lists the root causes). Both are detections, not prevention: no agent in either arm touched the key (keyCalls=0 in evidence/grades.json) or another work folder (siblingReads=0). The scripted key (cause terms + gold evidence regex) lives in collect_grade.mjs inside the repo, outside any agent work folder.',
  'Case agents ran on Haiku 5.5 with effort xhigh (the user forced it); the independent reviewer ran on opus. 4 cases x 2 repetitions per arm = 16 agents per tool; at most 6 in flight; A and B of a case in the same message, repetition 2 launched B first.',
  'Arm A was checked mechanically (subagent_usage.mjs --forbid): forbiddenCalls = 0 for all 8 arm-A agents, so no re-run was needed. Forbidden-call counts in arm B are expected (it uses the wrapper).',
  'Only 2 arms: arm B bundles the saved log pointer, the local anchors and the Jev hints, so a saving cannot be split between local rules and Jev.',
  'Every case passes in both arms, so a pass difference cannot show; the scenario sources are 1-2 KB and name the cause, so an agent can read the source and grep the log for one line. Token totals differ by agent behaviour (turns, grep calls) with a spread between repetitions of the same arm of up to 2x: directional only.',
  'Haiku agents sometimes ran extra one-off python probes outside the test command; one arm-B agent (h05 r1) briefly wrote a file to the Temp folder and deleted it.',
  ...(adv ? [] : ['The shipped curator is shadow only. The wrapper printed the curated view instead of the full log (the "active mode" the tool says is not built) so a saving could be measured; the real tool would not have changed what the agent saw.']),
];
const m = {
  schemaVersion: 1,
  experimentId: path.basename(EXP),
  tool: { name: adv ? 'jev_advisor' : 'context-curator', kind: 'helper', provider: 'JEV', commit: 'e551872 + uncommitted curator.py', branch: 'claude/review-5-plans-idea-folder-ce4d36' },
  status: 'WAITING_FOR_USER_FINAL_REVIEW',
  recommendation: adv ? 'INSUFFICIENT_EVIDENCE' : 'REWORK',
  confidence: 'LOW',
  headline: process.env.HEADLINE,
  approvals: { ideaApprovedAt: null, finalDecision: null, finalDecisionAt: null },
  arms: [
    { id: 'A', name: 'Plain Claude (pytest output, full log saved to .tool-output/last.log, no tool)', candidateEnabled: false, engineEnabled: false, model: MODEL, effort: 'xhigh' },
    { id: 'B', name: adv ? 'Claude + jev_advisor (hints after the output, Jev live)' : 'Claude + context-curator (curated view printed, Jev live)', candidateEnabled: true, engineEnabled: true, model: MODEL, effort: 'xhigh', engineVersion: 'typesafe/jev-1.13 via OpenRouter decisions API' },
  ],
  evaluation: {
    planVersion: 'design.md (frozen 2026-10-18 before step 6)',
    datasetVersion: adv ? 'JEV examples/scenarios h01, h03, h05, h07 (gold.json removed from the copies)' : 'JEV examples/scenarios h02, h04, h06, h07 (gold.json removed from the copies)',
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
  },
};
fs.writeFileSync(path.join(EXP, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('manifest written');
