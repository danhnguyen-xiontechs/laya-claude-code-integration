# Design — integration-verifier, agent run `20261018-integration-verifier-agent-01`

Frozen before step 6. The tool is not changed by this run. Tool read from this checkout, commit f612ca1.

## Tool under test
`scripts/verify.mjs` (`verifyBatch`): reads each story's result manifest from its branch, checks required checks have an exit code and a non-empty log, maps ACs to evidence, finds cross-story conflicts (shared fixture/config/contract, duplicate migration version, declared contract mismatch, config conflict), merges the branches in an isolated worktree, runs the required checks there, clusters failures, and sets PASS / FAIL / BLOCKED / REVIEW_REQUIRED per story and for the batch. With `--jev`, one Jev `choice` call per unclassified failure cluster (max 3); the label is printed but never changes a status.

## Arms (same prompt, model, effort, fixtures)
Both: one fresh subagent per case/arm/repetition, `model: haiku` (claude-haiku-5-5), `effort: xhigh`, own work folder `<case>.<A|B>.r<n>` with a fresh copy of the fixture. A and B of a case launched in the same message; repetition 2 launched B first; at most 6 agents in flight.
- Prompt: the work folder, what `batch.json`/`repo`/`logs` are, "Is this batch safe to merge? Answer with the batch status and a status per story, with one reason each", the four status meanings (identical in both arms), a rule not to touch the repo's branches, and the reply format `BATCH: <status>` + `<id>: <status> - <reason>`.
- A adds: "No integration verifier is available in this task ... do not look for or use any skill, script or helper ...".
- B adds: "An integration verifier is available: run `node verify-batch.mjs` in this folder".
- `verify-batch.mjs` is the same command in both arms. A: prints `verifier disabled`. B: runs the real `verifyBatch` with `jev: true, maxJev: 3`, prints `report.md`, logs one line to `_logs/<case>.B.r<n>.jsonl` (batch/story statuses, Jev calls, label, latency).
- The status meanings in the prompt are the tool's documented rules in plain words; this makes the task well-defined for gold but also hands A the rubric, so the test measures carrying the rules out, not knowing them.

## Cases (small git repos built by `make_tasks.mjs`; gold written by hand from the documented rules before any agent ran)
| Case | Setup | Gold batch | Gold per story |
|---|---|---|---|
| c1 | two independent stories, own tests pass, logs present | PASS | S1 PASS, S2 PASS |
| c2 | S1 claims a passing test but its log file does not exist; S2 clean | BLOCKED | S1 BLOCKED, S2 PASS |
| c3 | S2's recorded test run exited 1 (code fixed after, so combined is green); S1 clean | FAIL | S1 PASS, S2 FAIL |
| c4 | S1 and S2 add migrations with the same version prefix 0002 | FAIL | S1 FAIL, S2 FAIL |
| c5 | S1 changes `getUser(id)` to `getUser({id})`; S2 still calls it with an id; no contracts declared; each story's own tests pass, the combined test fails | FAIL | S1 FAIL, S2 FAIL |
| c6 | S1 has a High review finding (artifact file); S2's AC has no evidence in its manifest but is `covered` in the AC-coverage matrix | REVIEW_REQUIRED | S1 REVIEW_REQUIRED, S2 PASS |
Before the run the tool's output on the 6 fixtures was compared with gold (all match; one first draft of c3 did not: the tool attributes any story whose file name appears in the combined output, so an innocent story got FAIL; c3 was redesigned to a recorded-exit-1 case so gold is unambiguous). Fixtures given to the agents contain no case names, no gold; `batch_id` is `batch-cN`. Gold is in `gold.json`, scoring in `grade.mjs`.

## Pass
A case passes when the answer parses and the batch status and every story status equal gold. Compared only if pass/fail in both arms. Scoring is by script from the hand-back message, never the agent's claim.

## Tokens
`subagent_usage.mjs` on the subagents folder, per work folder (all tokens of the case agent session, including cache). Arm A is checked with `--forbid "integration-verifier|verify.mjs"`; a contaminated A case is discarded and re-run as `<case>.A2.r<n>`.

## Fallback / flag
Without `--jev` the tool is rules only; arm A never runs it. If Jev errors, the report shows `error:` and nothing else changes.

## Known limits
Six tiny batches (2 stories), 2 repetitions: directional. Jev is only called in c5 (the only case with an unclassified combined failure), and can't change statuses anyway. Gold for story statuses in c5 follows the tool's attribution rule.
