# Design: acceptance-criteria-coverage round 3 (20261018-acc-r3-agent-01)

**Status: measured. Verdict INSUFFICIENT_EVIDENCE (low confidence). Gate B is the user's.**

## Starting point
Branch `claude/acc-round3` from `claude/acc-round2` (1418222). Tool code is in the JEV repo (read-only); worked from scratch copies: round-2 tree plus `diff/tool-change-r3.diff`.

## Changes
1. **Flagged criteria (measurement design, not tool):** six criteria from the round-2 fixture review resolved by the author: see manifest `deviations` and `diff/fixture-key-fixes.diff`. Fixtures frozen in `fixtures/`; keys in `evidence/`.
2. **Tool:** `candidates --top` default 5 -> 3. Digest already hides skippable pairs (round 2), unchanged.
3. **Cases:** the four round-2 stories (acc-11 to acc-14), 9-10 criteria, 81-89 tests in 15-18 files, 1,109-1,118 test lines.

## Offline recall (before the agent run)
`recall/offline-recall.txt`: with top 3 from `candidates` (no Jev), all decisive tests were in the shortlist for 24 of 37 criteria with decisive gold; none for 11; some for 2. Rule for stopping was "gold missing for most criteria": not met (65% hit), so the run went ahead. The misses are the real finding: the shortlist is weak on exactly the trap types (vocabulary, parametrised, helper-based).

## Measurement
- Arms: A plain Claude (no tool); B Claude + `tool.mjs` (candidates, classify with Jev live, digest). Same prompt apart from one sentence.
- 4 cases x 2 repetitions, Haiku effort high, at most 4 in flight.
- Opus: 0 calls. Haiku reviewer: 1 (diff only).
- Scoring by script against the frozen key (`grades.md`).

## Results (summary)
- Verdicts right: A 72/76, B 74/76. Runs fully right: A 4/8, B 6/8. False Covered: 0 and 0.
- Tokens (subagent_tokens): A 754,955, B 786,678 (+4.2%); paired per-run differences from -3,129 to +12,364.
- Per-run token totals of 88k-109k are almost all fixed agent overhead; a shortlist saves little at this size.

## Deviations
See manifest `deviations` (fixture fixes, tool default, arm-A contamination and A2 reruns, forbid check method, token counting method, no build_tool_report, no Opus call).
