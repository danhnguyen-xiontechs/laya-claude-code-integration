# Final decision: subagent-model-router

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-model-router-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** On 6 small checked tasks x 2 repetitions both arms passed 12/12 on the first attempt (no escalation needed), and the router's tier choice cost $0.97 against $1.51 for all-Sonnet (-35%, price-weighted; raw tokens the same, 3.25M). The whole saving is the two lookup tasks sent to Haiku (-95%); in the other 8 pairs B ran on Sonnet like A, and Jev never lowered a tier. The README's "14% of opus cost" is stale (current rules route 11 of 18 bench prompts to Sonnet), so it is not reproduced. Top fix: re-run the routing benchmark on the current prompts and pin ruleTier to it with a test, then make the "checked" rule ignore test globs.

## What REWORK means here
The tool stays as it is and is not adopted. It is changed along the top suggestions of `improvements.md` and measured again before any adoption decision.

## Next
- Apply the top suggestions in `improvements.md` (first the one in the headline).
- Re-measure on harder cases where plain Claude can actually fail, with 2-3 repetitions, in a new experiment id.
