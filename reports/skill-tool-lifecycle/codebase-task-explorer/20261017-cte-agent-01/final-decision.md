# Final decision: codebase-task-explorer

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-17
- **Experiment:** 20261017-cte-agent-01 (Haiku 5.5 subagents, effort xhigh, 4 cases, 1 repetition)
- **Based on:** same codemap pool in raw order 4/4 against the tool's rules + Jev ranking 3/4 (t3-refactor-decide missed a group), +11% tokens (2.89M -> 3.22M); eight Major findings accepted for the run but not fixed.

## What REWORK means here
The tool stays as it is and is not adopted. It is fixed and measured again before any adoption decision.

## Before the next measurement
- Fix the failure paths: a malformed or non-JSON Jev answer must fall back and say so; a guard tripping on the first call must show its reason; a failed global rerank must return the rules order.
- Fix the fallback: pass --hidden to rg, check spawn errors, make the order deterministic; narrow the JUNK filter so packages/ and bin/ stay.
- Re-measure on harder tasks (queries not written with the answer in mind, bigger repos), a rules-only arm to separate Jev's share, and 2-3 repetitions.

## Notes for the next run
- Run it with the fixed build-skill-tool-workflow (patch in `reports/skill-tool-lifecycle/pending/build-skill-tool-workflow-fixes.patch`): answer key kept away from both arms, arm A checked mechanically for use of the tool (`subagent_usage.mjs --forbid`).
