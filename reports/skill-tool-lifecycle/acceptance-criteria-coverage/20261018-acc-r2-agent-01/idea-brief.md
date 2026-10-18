# Retro round 2: acceptance-criteria-coverage (20261018-acc-r2-agent-01)

**Question.** Does a reading list that prints each candidate's assertions and helper calls, and hides the skippable pairs, make Haiku read fewer tests on suites where reading everything is costly (60-90 test items per story)?

**Baseline.** [20261018-acc-agent-01](../20261018-acc-agent-01/): 4 small suites of 8-15 tests; both arms 8/8; tokens 2.30M -> 2.27M. The last improvements.md said the cases were too easy, and that a bigger suite is needed before any shortlist can show value.

**What changed this round.** A `digest` subcommand (top stays 5) and four harder stories. Nothing has been measured. The user chose to stop before the case agents, to review the fixtures and the cost first.

**Success criteria (fixed before data).** The tool helps if, in at least 6 of 8 B runs, B opens at most half of the test files; paired B tokens are at most 0.8 x A with B lower in at least 6 of 8 pairs; B's criteria right is at least A's in every case; and B has no more false Covered than A.
