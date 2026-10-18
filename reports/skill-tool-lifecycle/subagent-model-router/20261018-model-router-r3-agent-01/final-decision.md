# Final decision: subagent-model-router, round 3

- **Decision:** PILOT
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-model-router-r3-agent-01 (branch `claude/model-router-round3`; Haiku/Sonnet case agents, effort high, 8 cases x 2 repetitions)
- **Based on:** the `checked` policy (rules only, no Jev call, for tasks with an automatic check; one escalation to Sonnet on a failed check) kept 16/16 after escalation, against 16/16 for all-Sonnet. Price-weighted cost went from $1.682 to $0.298 (-82%) including the two escalations. First attempt on Haiku passed 14/16; d5-deps missed in both repetitions and was fixed by escalation, so that one case cost slightly more than all-Sonnet ($0.202 vs $0.188). Raw tokens went up 81% (Haiku takes more turns), so the saving is in price, not tokens. Details: `results.md`.

## What PILOT means here
- `checked` stays opt-in (`route.mjs --cascade`); it is not the default policy.
- The PreToolUse hook stays on its current path (rules, no provider); it is not switched to the cascade.
- Use it for batches of tasks that have a real automatic check (tests, a check script).

## Open before ADOPT
- The code is on `claude/model-router-round3`, not merged into `main`.
- No independent review of the round-3 diff was run (quota mode); 36/36 unit tests pass.
- Weak checks were not tested: a check that passes on subtly wrong work is invisible to the cascade.
- Escalation was done by hand following the recipe, not by an orchestrator.
- Next measurement: a harder case set with weak checks, and real stories, before making it the default.
