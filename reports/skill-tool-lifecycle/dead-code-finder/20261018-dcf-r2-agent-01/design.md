# Design: dead-code-finder round 2 (20261018-dcf-r2-agent-01)

Frozen before any round-2 case agent ran (`evaluation.criteriaFrozenAt` in manifest.json). The design is the round-1 design ([../20261018-dcf-agent-01/design.md](../20261018-dcf-agent-01/design.md)) with the changes below; the cases, prompts, pass rule, wrapper and grader are unchanged, and the harness is a copy of round 1's with only paths changed (`harness/common.mjs`).

## Arms
| Arm | What runs |
|---|---|
| A | plain Claude, Haiku 5.5 effort xhigh; prompt says no tool is available; `node tool.mjs` prints "tool disabled" |
| B | same prompt + one sentence about the tool; `node tool.mjs` runs the skill's real `scan .` with Jev live, **with the round-2 report** (short), prints report.md |

Both arms are measured again in this folder (not reused from round 1), so the comparison is paired within one run. 4 cases x 2 arms x 2 repetitions = 16 case agents, Haiku 5.5 effort xhigh, at most 6 in flight; A and B of a case in the same message; repetition 2 launches B first.

## Cases and pass rule
Same as round 1: dcf-01-demo (in-sample JEV demo, gold from its gold.json), dcf-02-ordersapi, dcf-03-pluglib, dcf-04-shopapp (own fixtures, keys in `evidence/answer-key/`, kept away from the agents). Pass = 0 wrong items (decoys or unlisted) and recall of dead items >= 75% (rounded up). Neutral items count neither way. The grader amendments of round 1 apply (commented blocks, neutral transitively dead imports).

## Tokens and evidence
Real tokens per case agent from its subagent transcript (`subagent_usage.mjs`), plus turns and tool calls. `evidence/texts/<case>.<A|B>.txt`: the first output each agent saw. Engine decisions per call in `evidence/_logs/`. Scoring by script, never by the agent's own claim. `forbiddenCalls` checked on both arms; a contaminated run is discarded and re-run as `<case>.A2`.

## Tool check before the runs
- `pytest tests/test_dead_code.py`: 13 passed in the changed copy (12 in the baseline copy plus the new test). Output in `unit-tests.json`.
- Independent review (Opus, read-only): see `agent-review.json`; Critical/Major findings were fixed before the runs.
- Smoke test: one B wrapper run on dcf-02 with Jev live (1 request, $0.000182; 7 Tier A, 2 Tier B, 20 Tier C shown as a count; short layout as intended).

## Out of scope
Suggestions 2-5 of the round-1 improvements; the model router; large real repositories.
