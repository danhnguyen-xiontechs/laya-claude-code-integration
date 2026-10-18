# Design: Jev / Laya as the P3 answer grader (offline)

Experiment `20261018-bstw-engine-grader-01`, Track N, offline only (no Claude agent run, no Claude tokens).
Frozen 2026-10-18, before any engine call.

## Question
Can Jev or Laya grade a case agent's free-text answer against a known gold as well as the experiment's own grading script? If so, P3 could use it for tools whose answers need a judgment, instead of a new script per round or a model call.

## Data (frozen list)
Saved answers (`evidence/answers/*.txt`) and their script grades (`runs/<arm>/<rep>/results.json` `status`) from past rounds. A dataset is included only when its `goldOutcome` holds the expected answer itself, and the pass rule needs only the answer text (not code, tests, transcripts or a gold file elsewhere):

| dataset | rows | pass rule given to the engine |
|---|---|---|
| `acceptance-criteria-coverage/20261018-acc-agent-01` | 16 | every criterion's verdict in the answer is in the accepted set of the key (`A|B` means either is accepted) |
| `integration-verifier/20261018-integration-verifier-agent-01` | 24 | the batch verdict and every story's verdict in the answer equal the key |
| `integration-verifier/20261018-integration-verifier-r2-agent-01` | 24 | same |
| `skills-router/20261018-skills-router-agent-01` | 24 | the `PICK:` line (plugin namespace and leading `/` dropped) equals the gold skill id (`none` = no skill) |
| `skills-router/20261018-skills-router-r2-agent-01` | 24 | same |
| `story-batch-planner/20261017-sbp-agent-01` | 8 | every invariant of the key holds in the answer's waves (`order`: earlier wave; `notSameWave`; `cycle`/`blocked` stories not in a wave) |

Left out: codebase-task-explorer and dead-code-finder (gold lists live in other files), git-risk-scanner and subagent-model-router (graded by tests), context-curator, jev-advisor and story-batch-planner 02/r2 (no `goldOutcome`), retry-loop-breaker (the grade also counts test runs).

- **Real rows:** 120 (label = script status).
- **Mismatched rows (negatives):** each real row's answer, graded against the gold of the next case in the same dataset whose gold differs. Label `fail`. 120 rows.
- **Total:** 240.
- Same input to both engines. Answer cut to 1,500 characters (Laya `max_len` 512). The cut is recorded per row.

## Engine call
One System One `choice` question per row through the existing `decision-provider.mjs`:
- state = rule + gold + answer;
- choices `pass` / `fail`; graded `pass` when p(pass) ≥ 0.5.
- A failed call, timeout or malformed answer gives `null` (counted as a miss, never as a grade).

## Success criteria (frozen)
- Agreement with the script on all 240 rows **≥ 95%**.
- **0 false passes** on the real `fail` rows.
- **≤ 2% false passes** on the mismatched rows.
- p50 latency **< 2 s**.

All met → PILOT as a P3 fallback grader for cases without a script, in shadow for one round. Otherwise → REJECT for this use.
