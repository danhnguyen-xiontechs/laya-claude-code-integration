# Final decision: subagent-model-router, round 4

- **Decision:** INSUFFICIENT_EVIDENCE
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-model-router-r4-weakcheck-01 (Track E; baseline 20261018-model-router-r3-agent-01; branch `claude/model-router-round4-p4-efbcb5`)
- **Based on:** 6 cases (5 with a weak visible check, 1 control) × 2 arms × 2 repetitions. Both arms passed the hidden strict check 12/12, with 0 silent misses and 0 escalations. Paired tokens went from 439,437 to 648,395 (+47%). The price change is an estimate: -93.9% at the `pricing.mjs` rate, -59.6% at a 1:3 Haiku:Sonnet ratio. The frozen precondition fired (Haiku passed strict first time on every case), so the weak-check question was not tested.

## What this means
- The router stays at **PILOT** from round 3: `checked` stays opt-in, and the hook path does not change.
- Nothing in round 4 counts for or against the cascade under weak checks.

## Next round (if any)
- Use cases that have been tried first and that Haiku really fails: run a cheap Haiku pre-test, and keep only the cases where Haiku misses the strict check.
- Check the Haiku 5.5 / Sonnet 5.5 prices against official pricing before the next headline.
- `run_cascade.mjs` now logs each step per run; use that log to explain the turn gap (B 66 vs A 47).
