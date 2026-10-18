# Retro round 2: git-risk-scanner (20261018-grs-r2-agent-01)

**Question.** Does the guidance make Haiku keep a planted guard when the reason for it is only in a commit message, where plain Claude kept every guard last round because fuzzing old against new was enough?

**Baseline.** [20261018-grs-agent-01](../20261018-grs-agent-01/): 4 cases, 8/8 both arms, tokens 4.70M -> 4.48M. The last improvements.md said the case set was too easy: the guards changed the output for ordinary inputs, so history was never needed.

**What changed this round.** guidance v2 (a pickaxe step, a characterization test only for changed behaviour, the old text kept as guidanceVersion 1) and four history-only cases. Nothing has been measured; the user stopped the run before the case agents.

**Success criteria (fixed before data).** B keeps all traps in at least 7 of 8 runs; A removes at least one trap in at least 3 of 8 runs; B's tokens are within +15% of A.
