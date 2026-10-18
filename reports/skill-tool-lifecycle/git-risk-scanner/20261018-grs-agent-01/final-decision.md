# Final decision: git-risk-scanner

- **Decision:** INSUFFICIENT_EVIDENCE
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-grs-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** Plain Haiku 5.5 and Haiku with the scanner both pass all 8 runs (visible and hidden tests green), tokens 4.70M -> 4.48M (-4.5%, B lower in 5 of 8 pairs; run-to-run noise on a single A case is 2.5x): the plain agent already read git history or fuzzed old against new and kept every planted guard. Jev changed the outcome where it was meant to (grs-02 formula 3.2 -> 4.6, flagged; grs-03 2.0 -> 0.7), and in 4 of 8 B runs the agent followed the defensive-mode step and added characterization tests (0 of 8 in A), but no case got a different result. Top suggestion: measure on tasks where the reason for a guard exists only in commit messages and the code gives no hint.

## What INSUFFICIENT_EVIDENCE means here
No adoption decision either way. The cases were too easy for plain Claude to fail, so this run cannot show a benefit or a harm. The tool stays as it is until a harder set gives a difference.

## Next
- Build a harder case set where the baseline can fail or loop (see `improvements.md`) and re-measure in a new experiment id.
- Fix any false block or wrong output named in `improvements.md` first; they hold whatever the new numbers say.
