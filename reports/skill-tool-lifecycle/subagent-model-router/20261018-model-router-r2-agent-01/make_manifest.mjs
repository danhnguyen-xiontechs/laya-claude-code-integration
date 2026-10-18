// Writes manifest.json for round 2 from evidence/cost.json and top-suggestion.txt (the one-sentence top suggestion from improvements.md).
// Run: node make_manifest.mjs
import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const c = JSON.parse(fs.readFileSync(path.join(here, 'evidence/cost.json'), 'utf8'));
const top = fs.readFileSync(path.join(here, 'top-suggestion.txt'), 'utf8').trim();
const rec = (fs.readFileSync(path.join(here, 'recommendation.txt'), 'utf8').trim()).split(/\s+/);
const pct = ((1 - c.totals.relCostBvsA) * 100).toFixed(0);
const tokA = c.totals.A.tokens, tokB = c.totals.B.tokens;
const pairs = {};
for (const r of c.perCase) (pairs[r.case + '|' + r.rep] ||= {})[r.arm] = r.tokens;
let pa = 0, pb = 0;
for (const k in pairs) { pa += pairs[k].A; pb += pairs[k].B; }
const tokPct = (((pb - pa) / pa) * 100).toFixed(1);
const m = {
  schemaVersion: 1,
  experimentId: '20261018-model-router-r2-agent-01',
  baseline: '../20261018-model-router-agent-01/',
  tool: { name: 'subagent-model-router', kind: 'skill', provider: 'JEV', commit: '8974a9e', branch: 'claude/model-router-round2' },
  status: 'WAITING_FOR_USER_FINAL_REVIEW',
  recommendation: rec[0],
  confidence: rec[1] ?? 'LOW',
  headline: `Round 2 (top round-1 fixes applied: ruleTier pinned by a test, checked rule ignores test globs; one Major from review fixed before measuring): both arms passed 12/12 on the first attempt, with no escalation. B cost $${c.totals.B.costUsd.toFixed(2)} against $${c.totals.A.costUsd.toFixed(2)} for all-Sonnet (-${pct}%, price-weighted; round 1: -35%), and raw tokens went ${tokA.toLocaleString('en-US')} -> ${tokB.toLocaleString('en-US')} (+${tokPct}% paired; within the run-to-run noise, mostly Sonnet-vs-Sonnet pairs). The saving is again the two lookup tasks on Haiku; the rule fix does not change any routed tier, because gate+sc takes the maximum with Jev, which still votes Sonnet for f1, d3, d5 and r1. ${top}`,
  approvals: { ideaApprovedAt: null, finalDecision: null, finalDecisionAt: null },
  arms: [
    { id: 'A', name: 'Every case agent on Sonnet 5.5 (default), no router', candidateEnabled: false, engineEnabled: false, model: 'sonnet (claude-sonnet-5-5)', effort: 'xhigh' },
    { id: 'B', name: 'Model per case from route.mjs (rules + Jev live, gate+sc, k=3, apply) with escalate-once cascade', candidateEnabled: true, engineEnabled: true, model: 'router output: haiku (e1-locate, e2-count), sonnet (r1-rename, f1-paginate, d3-maplimit, d5-deps)', effort: 'xhigh', engineVersion: 'typesafe/jev via OpenRouter decisions API' },
  ],
  evaluation: {
    planVersion: 'design.md (round-1 design, unchanged; frozen before this run)',
    datasetVersion: 'bench/tasks e1-locate, e2-count, r1-rename, f1-paginate, d3-maplimit, d5-deps (agents get files/ only)',
    caseCount: 6,
    repetitions: 2,
    criteriaFrozenAt: null,
    tokenScope: "all tokens of each case agent's session (input + output + cache read + cache write) from its subagent transcript; usage.cost is the same tokens at the tool's list prices (scripts/pricing.mjs: Haiku 0.10/0.50, Sonnet 2/10 USD per MTok; Haiku:Sonnet per-token ratio 1:20). The report's token card is the raw unweighted sum; the price-weighted cost is in evidence/cost.json and the headline.",
    deviations: [
      'Exception to the retro brief, kept from round 1 by the user\'s instruction: the case agents\' model is the variable, not forced to Haiku. A = all Sonnet 5.5; B = the tier route.mjs returned for each exact prompt (Jev live, gate+sc, k=3, apply); effort xhigh in both. The reviewer ran on opus.',
      `Price-weighted cost A $${c.totals.A.costUsd.toFixed(3)} -> B $${c.totals.B.costUsd.toFixed(3)} (-${pct}%). Raw tokens ${tokA.toLocaleString('en-US')} -> ${tokB.toLocaleString('en-US')} (+${tokPct}% paired). The raw difference sits in pairs that ran the same model (Sonnet in both arms for r1, f1, d3, d5: the pairs differ by up to 26% from run to run); the Haiku pairs differ by -20% to +26%. So the raw token change is noise, not a router effect.`,
      'The round-2 rule fix moves f1-paginate, d3-maplimit and d5-deps from Sonnet to Haiku in the rules-only route (route.mjs --provider none); r1-rename was already Haiku by rules. Under the measured policy (gate+sc: maximum of rules and 3 Jev votes) Jev votes Sonnet for all four (r1 included), so the routed B tiers are identical to round 1. This measurement therefore re-tests round-1 routing with the fixed code; it does not measure the fix\'s effect on routed tiers.',
      'B differs from A in only 4 of 12 pairs (e1-locate and e2-count, both repetitions, on Haiku). In the other 8 pairs B ran on Sonnet like A. The saving rests on two lookup tasks, as in round 1.',
      'Cascade: no escalation in any run. All 24 agents passed the task check on the first attempt; the pass rate is first-attempt for both arms.',
      'Answer key: subagent_usage found 0 forbidden tool calls for all 24 agents. One leak-scan hit (d3-maplimit arm B, repetition 2) was not an answer-key read: it was the harness "current working directory" note in an error from a mistyped prompt path in the spawn message (the path had a typo, and the agent completed its task in its own work folder). The run was kept; the hit is in evidence/leak-scan.json.',
      'Workflow scripts (shared with other experiments, not changed): the shared subagent_usage.mjs only matches a work folder followed by a line break, quote or space, and the spawn prompts here end the path with a period, so it found no transcript. The round uses subagent_usage_local.mjs in this folder (identical except it also accepts a period). The shared scan_results keys on a "work/" folder name; scan_results_local.mjs matches the full work folder. Both local copies are in this folder.',
      'Round-2 fix commits: 3ee2749 (ruleTier pin, checked rule ignores test globs; route-none and route-jev benchmark results re-run; route-jev answers re-fetched live, so their p/latency/cost values changed, tiers did not) and 8974a9e (review fix: bold file names are not globs). Tests: 32 pass, 0 fail (unit-tests.json).',
      'Review (opus, read-only, fresh context): 0 Critical, 1 Major (fixed in 8974a9e before measuring), 4 Minor, 2 Suggestion; the open ones are in agent-review.json and are not blocking.',
      'Route side effect: the route.mjs runs wrote about 6 entries to the user\'s router log (pre-existing DEFAULT_LOG behaviour, not part of the diff).',
      'Known issues for the next run, found while building this one (not affecting these 24 runs, which had no escalation): build_results.mjs hard-codes escalated false and escalations 0; the period terminator in subagent_usage_local.mjs also matches an escalation folder (<case>.B.r<n>.esc), so an escalated first attempt would get null usage. Output tokens for Haiku look low (38-59 vs 209-405 for Sonnet on the same tasks; possibly a partial streaming record); the effect on cost is under 1 cent per run, and outputTokens should not be quoted as-is.',
      'Orchestrator tokens and the Jev routing calls (about $0.00003 each, 36 calls) are not in either arm\'s cost; both favour B and would not change the sign.',
    ],
  },
  artifacts: {
    ideaBrief: 'idea-brief.md', design: 'design.md', experimentPlan: null, unitTestReport: 'unit-tests.json', agentReview: 'agent-review.json',
    improvements: 'improvements.md',
    perToolReport: 'report.html', perToolHtmlReport: 'report.html', mainReport: '../../index.html',
    runDirectories: ['runs/A-claude/r1', 'runs/A-claude/r2', 'runs/B-claude-jev/r1', 'runs/B-claude-jev/r2'],
    rawResults: ['evidence/texts', 'evidence/answers', 'evidence/routes', 'evidence/subagent-usage.json', 'evidence/cost.json', 'evidence/grades.json', 'evidence/leak-scan.json', 'evidence/run-index.json'],
    executionLogs: [],
  },
};
fs.writeFileSync(path.join(here, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('manifest written; recommendation', m.recommendation, m.confidence);
