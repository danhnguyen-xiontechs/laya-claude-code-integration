# Final decision: integration-verifier

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-integration-verifier-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** On 6 two-story git batches (2 repetitions) plain Haiku 5.5 and Haiku with the verifier give the same answers (10 of 12 runs right in both arms; c6 wrong in all 4 runs), but the verifier arm spends 28% more tokens (7.03M -> 8.99M) because the agents re-checked the repo after reading the report; no case is worse. In c6 the tool said PASS for a story whose AC-coverage row cites a test that does not exist, and the agents overruled it. Top fix: print a short verdict-first report the agent can stop on, and check that a coverage row's test exists.

## What REWORK means here
The tool stays as it is and is not adopted. It is changed along the top suggestions of `improvements.md` and measured again before any adoption decision.

## Next
- Apply the top suggestions in `improvements.md` (first the one in the headline).
- Re-measure on harder cases where plain Claude can actually fail, with 2-3 repetitions, in a new experiment id.
