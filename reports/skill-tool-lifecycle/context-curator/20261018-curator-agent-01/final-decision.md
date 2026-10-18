# Final decision: context-curator

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-curator-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** Directional only (4 cases x 2 repetitions, Haiku 5.5): both arms get 8/8 right, but the curated view costs 38% more tokens than the plain log (2.58M -> 3.56M, higher in all 8 pairs); no case got worse. Jev answered every call but the view was only 17-44% smaller than the full log and B agents ran more turns (57 vs 42). Top fix: do not print the curated view as a replacement; keep the full log in a file and give only a ranked pointer list (or drop the curator until it can cut at least 70% of the log).

## What REWORK means here
The tool stays as it is and is not adopted. It is changed along the top suggestions of `improvements.md` and measured again before any adoption decision.

## Next
- Apply the top suggestions in `improvements.md` (first the one in the headline).
- Re-measure on harder cases where plain Claude can actually fail, with 2-3 repetitions, in a new experiment id.
