# Final decision: story-batch-planner

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-17
- **Experiment:** 20261017-sbp-agent-01 (Haiku 5.5 subagents, effort xhigh, 4 cases, 1 repetition)
- **Based on:** plain Haiku 4/4 and Haiku with the planner 4/4 on four small fixtures, planner arm 2.5 times the tokens (429k -> 1,093k); one Critical (layer() inverts an incomplete prerequisite) and four Major findings accepted for the run but not fixed.

## What REWORK means here
The tool stays as it is and is not adopted. It is fixed and measured again before any adoption decision.

## Before the next measurement
- Fix the open Critical: a story whose prerequisite is incomplete must not be scheduled before it (planner.mjs layer()).
- Fix or consciously accept the Major findings (mutual dependency as a cycle, batch policy turning Jev on, no penalty for over-serialising, in-sample tests).
- Re-measure on larger and harder batches (10+ stories, mixed contracts, migrations, an incomplete story), where plain Claude can actually go wrong, and with 2-3 repetitions.

## Notes for the next run
- Run it with the fixed build-skill-tool-workflow (patch in `reports/skill-tool-lifecycle/pending/build-skill-tool-workflow-fixes.patch`): answer key kept away from both arms, arm A checked mechanically for use of the tool (`subagent_usage.mjs --forbid`).
