# Final decision: acceptance-criteria-coverage

- **Decision:** INSUFFICIENT_EVIDENCE
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-acc-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** On 4 small suites (8-15 tests, 6-7 criteria) plain Haiku 5.5 and Haiku with the tool pass every run (8/8 vs 8/8, identical verdicts in all 8 pairs); tokens 2.30M -> 2.27M (-1%, B lower in 4 of 8 pairs), which is noise. Jev marked 118 of 210 pairs skippable and no agent used a skipped test as evidence, but it also labelled the cart "name-only" trap partial_coverage (p 0.76-0.80), which both arms ignored. The suites are too small for any helper to show value; top suggestion: re-measure on a suite of 60+ tests where reading everything is costly.

## What INSUFFICIENT_EVIDENCE means here
No adoption decision either way. The cases were too easy for plain Claude to fail, so this run cannot show a benefit or a harm. The tool stays as it is until a harder set gives a difference.

## Next
- Build a harder case set where the baseline can fail or loop (see `improvements.md`) and re-measure in a new experiment id.
- Fix any false block or wrong output named in `improvements.md` first; they hold whatever the new numbers say.
