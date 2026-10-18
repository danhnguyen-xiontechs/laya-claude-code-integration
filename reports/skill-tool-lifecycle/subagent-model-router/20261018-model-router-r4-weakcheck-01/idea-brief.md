# Idea Brief: subagent-model-router, round 4 (weak checks, harder cases)

- Experiment: `20261018-model-router-r4-weakcheck-01` (Track E, P1 `N/A (existing tool)`)
- Baseline experiment: `20261018-model-router-r3-agent-01` (PILOT, user 2026-10-18)
- Tool under test: the `checked` cascade policy (`route.mjs --cascade`), unchanged from main `52f6583`
- Question chosen by the user: "Check yếu + ca khó" (2026-10-18)

## Question this run answers
Round 3 showed the cascade keeps 16/16 at -82% price, but only with **good** checks and cases Haiku mostly passes. The cascade escalates only when the check fails, so a **weak check** (passes on subtly wrong work) hides a Haiku miss. Does the cascade still match all-Sonnet on *real* correctness when the check the cascade sees is weak and the tasks are harder?

## Arms
- **A (plain Claude):** every case agent on Sonnet, no routing.
- **B (Claude + router):** tier from `route.mjs --cascade`, then one escalation to Sonnet when the **visible (weak) check** fails. Escalation driven by a script (`run_cascade.mjs` style), not by hand.

## What is measured
- Final correctness on a **hidden strict check** (the agent and the cascade never see it).
- **Silent misses:** visible check passes, hidden check fails. Counted per arm.
- Price-weighted cost incl. escalations (same pricing as round 3: `scripts/pricing.mjs`).
- Raw tokens and turns, reported but not the headline.

## Not in scope
- No change to the router code (P2 builds only the case set, grader and the escalation driver in the experiment folder).
- PreToolUse hook path, Jev gate on unchecked tasks, real stories.
