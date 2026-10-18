#!/usr/bin/env node
// finalize.mjs — writes manifest.json after grade.mjs. Run once.
import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const model = 'haiku (claude-haiku-5-5), forced by the user; the router would have said sonnet/opus';
const m = {
  schemaVersion: 1, experimentId: '20261018-integration-verifier-r2-agent-01',
  tool: { name: 'integration-verifier', kind: 'skill', provider: 'JEV', commit: 'f612ca1', branch: 'main' },
  status: 'WAITING_FOR_USER_FINAL_REVIEW', recommendation: 'REWORK', confidence: 'LOW',
  headline: 'On 6 two-story git batches (2 repetitions) plain Haiku 5.5 and Haiku with the verifier give the same answers (10 of 12 runs right in both arms; c6 wrong in all 4 runs), but the verifier arm spends 28% more tokens (7.03M -> 8.99M) because the agents re-checked the repo after reading the report; no case is worse. In c6 the tool said PASS for a story whose AC-coverage row cites a test that does not exist, and the agents overruled it. Top fix: print a short verdict-first report the agent can stop on, and check that a coverage row\'s test exists.',
  approvals: { ideaApprovedAt: null, finalDecision: null, finalDecisionAt: null },
  arms: [
    { id: 'A', name: 'Plain Claude (inspects manifests, logs and branches itself; verify-batch.mjs prints "verifier disabled")', candidateEnabled: false, engineEnabled: false, model, effort: 'xhigh' },
    { id: 'B', name: 'Claude + integration-verifier (verify-batch.mjs runs verifyBatch with --jev and prints report.md)', candidateEnabled: true, engineEnabled: true, model, effort: 'xhigh', engineVersion: 'typesafe/jev-1.13 via OpenRouter decisions API, shadow only (statuses never change)' },
  ],
  evaluation: {
    planVersion: 'design.md (frozen before step 6; the review changed where the answer key is kept, see deviations)',
    datasetVersion: 'fixtures c1-c6 built by make_tasks.mjs (5 from the tool\'s own fixture batches); gold written by hand before the run',
    caseCount: 6, repetitions: 2, criteriaFrozenAt: null,
    tokenScope: 'all tokens of each case agent\'s session (input + output + cache read + cache write), from its subagent transcript',
    deviations: [
      'Steps 1-3 (brainstorm, Gate A, implementation) were skipped on the user\'s instruction: retro measurement of an existing tool (commit f612ca1). The tool and workflow were read from this checkout after merging main into the branch.',
      'The independent review (opus) found 4 Major tool findings (self-written evidence can reach PASS; log_path not confined to the batch folder; timeouts crash the run on Windows; Jev failure signature not redacted) and 6 Minor ones. They are accepted for this run per the brief and not fixed (agent-review.json).',
      'Measurement-design findings: the answer key was reachable from arm A\'s parent folder -> fixed (gold, prompts, pristine fixtures and B logs moved to a private folder; collect.mjs --forbid also flags A calls that touch them; 0 flagged). Still open: 5 of 6 cases are the tool\'s own fixtures and gold was checked against the tool before the run (c3 was rebuilt when they disagreed), and the shared prompt gives arm A the tool\'s status rules, so the run measures carrying the rules out, not knowing them. Two-story batches are too easy for any tool to show value.',
      'Arm A contamination check: 0 forbidden calls (integration-verifier, verify.mjs, gold, logs, B folders) in all 12 arm-A transcripts; no re-run was needed. In arm A the wrapper was never run, so evidence/texts for A is the first tool result of the agent (a folder listing), not a verifier output.',
      'c6 fixture flaw (inherited from the tool\'s own fixture): the AC-coverage row for S2 cites tests/count.test.js, which exists in no commit. Gold (from the tool) says S2 PASS; all 4 runs (both arms) answered REVIEW_REQUIRED and fail the gold, and the B agents overruled the tool\'s report. c6 is "fail in both arms", not a win or loss for the tool; arguably the agents were right and the tool wrong.',
      'c3 gold is debatable (recorded exit 1, committed code green); every run answered S2 FAIL as gold says, so it did not matter in practice.',
      'Jev was live but called only in c5 (1 call per run, 2 in total, label code_regression, 0.76 s and 1.2 s); no other case has an unclassified combined failure. Jev is shadow-only and cannot change a status.',
      'All case agents ran on Haiku 5.5 with effort xhigh by the user\'s decision; the reviewer ran on opus. At most 6 agents in flight; A and B of a case launched together (rep 2: B first), except that c1.A.r1 was launched one message before the other five of its batch (no effect on results).',
      'unit-tests.json counts one test file (10 fixtures + rule asserts) three ways and does not cover timeouts, merge conflicts or forged evidence.',
    ],
  },
  artifacts: { ideaBrief: 'idea-brief.md', design: 'design.md', experimentPlan: null, unitTestReport: 'unit-tests.json', agentReview: 'agent-review.json', perToolReport: 'report.html', perToolHtmlReport: 'report.html', mainReport: '../../index.html',
    runDirectories: ['runs/A-claude/r1', 'runs/A-claude/r2', 'runs/B-claude-jev/r1', 'runs/B-claude-jev/r2'],
    rawResults: ['evidence/texts', 'evidence/answers', 'evidence/subagent-usage.json', 'evidence/run-index.json', 'evidence/forbidden.json', 'evidence/grades.json', 'evidence/gold.json', 'evidence/_logs', 'improvements.md'], executionLogs: [] },
};
fs.writeFileSync(path.join(here, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('manifest written');
