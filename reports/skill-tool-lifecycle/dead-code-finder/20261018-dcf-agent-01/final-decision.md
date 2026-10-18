# Final decision: dead-code-finder

- **Decision:** REWORK
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-dcf-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** Plain Haiku 5.5 passes 7 of 8 runs and Haiku with the scanner 8 of 8 (the one A failure listed a "disabled with reason" decoy in the in-sample demo), but B costs 61% more tokens (2.01M -> 3.23M, higher in 8 of 8 pairs) for 1-5 extra turns reading a long report, and in dcf-04 both B runs missed 2 dead items that A found (6/8 vs 8/8). Jev's Tier A was precise (0 live items in Tier A of 25 unused-code candidates) but covers only 24 of 41 dead items. Top suggestion: make the report short (Tier A and B only, Tier C as a count).

## What REWORK means here
The tool stays as it is and is not adopted. It is changed along the top suggestions of `improvements.md` and measured again before any adoption decision.

## Next
- Apply the top suggestions in `improvements.md` (first the one in the headline).
- Re-measure on harder cases where plain Claude can actually fail, with 2-3 repetitions, in a new experiment id.
