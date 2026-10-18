# Improvements: round 4 (weak checks, harder cases)

## Diagnosis
Both arms passed the hidden strict check 12/12 with 0 silent misses and 0 escalations, so the weak-check question was never tested: Haiku passed every case first time, which the frozen design names as INSUFFICIENT_EVIDENCE. B used +47% paired tokens (439437 to 648395) with no extra passes, which also trips the bad-result rule. The -93.9% price figure rests on Haiku rates that look about 20x cheaper than Sonnet, which is unverified and decides the ADOPT threshold.

## Suggestions (ranked)
1. **cases/ (redesign) + Haiku-only pilot.** Change: keep only cases where Haiku fails strict 30-60% of the time while passing visible. Why: the cascade was never stressed. Expected effect: a testable set with at least 4 weak-check cases. Verify: 3 Haiku-only reps per candidate case.
2. **scripts/pricing.mjs + summary aggregation.** Change: verify the Haiku rate against the current table; document raw vs paired (raw = 2 x paired); assert in a unit test. Why: -93.9% does not fit +47% tokens at a 3x price ratio. Expected effect: a trustworthy priceChange, possibly -50% to -85%. Verify: recompute one A and one B run by hand.
3. **Forced-escalation control case.** Change: a case Haiku is known to fail visibly. Why: escalation had 0 live runs. Expected effect: live evidence that escalation reaches Sonnet and costs both attempts. Verify: escalations=1, attempt 2 on sonnet.
4. **Driver turn logging (scripts/run_cascade.mjs).** Change: log route, visible-check and wrapper turns separately. Why: the extra B turns are unattributed. Verify: per-run breakdown sums to the total.
5. **Reps 3-4 on the redesigned set.** Why: with n=12 the 1/12 tolerance cannot be resolved. Verify: a CI on strictPass(B) minus strictPass(A).

Top suggestion: redesign the case set so Haiku actually fails some strict checks, and audit the pricing before any verdict.
