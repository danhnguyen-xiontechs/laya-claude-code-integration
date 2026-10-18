# Final decision: skills-router

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-skills-router-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** On 6 pick-a-skill requests (4 with a skill as the answer, 2 needing none) with Haiku 5.5, plain Claude (A) with the full skill list picked right 12 of 12 times and Claude + the router hint (B, Jev live) also 12 of 12, so the hint changed no answer, while B used 72% more tokens (1.49M -> 2.56M) and about twice the turns (25 -> 44); no case got worse. The router itself was right on all 6 requests (0 Jev errors, ~0.8 s per call), but the cases were too easy to show value, and 3 Major tool findings stay open. Top fix: print the hint as one short line instead of a 2k-token JSON after a 30 KB list.

## What REWORK means here
The tool stays as it is and is not adopted. It is changed along the top suggestions of `improvements.md` and measured again before any adoption decision.

## Next
- Apply the top suggestions in `improvements.md` (first the one in the headline).
- Re-measure on harder cases where plain Claude can actually fail, with 2-3 repetitions, in a new experiment id.
