# Idea brief (retro round 2) — integration-verifier, run 20261018-integration-verifier-r2-agent-01

This is round 2 of the retro loop. The tool exists (`.claude/skills/integration-verifier/`); round 1 (`20261018-integration-verifier-agent-01`, baseline) gave REWORK with its top two suggestions: a verdict-first report, and a check that an AC-coverage row's test exists. Steps 1-3 were skipped on the user's instruction; Gate B (final decision) stays with the user.

**Baseline.** Round 1: pass A 10/12, B 10/12; tokens A 7.03M -> B 8.99M (+28%); 114 -> 138 model turns, 141 -> 169 tool calls; c6 wrong in both arms, and the tool said PASS for S2 on an uncited test.

**Question this run answers.** Did the two round-1 changes (verdict-first report, coverage row must cite an existing test) remove the token overhead of the verifier arm without losing correctness, and does the tool change c6 for the better?

**Hypothesis.** A short verdict the agent can stop on removes the re-check turns that cost B the extra tokens; the coverage-row check makes the tool agree with what the careful agents already did.

**What Jev decides.** Nothing that changes a status (shadow only). Jev was not changed in round 2 and was called only in c5.

**Success criteria (same as round 1, fixed before data).** B passes at least as many cases as A with no case worse, and does not cost more tokens than A.

**Same case set and rules.** c1-c6, same prompts, same gold (c6 gold is inherited and kept; see deviations), same two arms, Haiku 5.5 with effort xhigh, 2 repetitions, A and B of a case launched together (repetition 2 B first), at most 6 case agents in flight. Arm A forbidden-call check: 0 in all 12 A transcripts.
