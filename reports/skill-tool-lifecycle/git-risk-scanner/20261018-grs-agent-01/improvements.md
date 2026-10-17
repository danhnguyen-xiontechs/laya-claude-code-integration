# Improvements (step 7b): git-risk-scanner, run 20261018-grs-agent-01

**Diagnosis.** B was not worse and not better: 8/8 against 8/8 passes, tokens 4.70M -> 4.48M (-4.5%, B lower in 5 of 8 pairs; a single A case varies 2.5x between repetitions, grs-04: 574k vs 229k), so the difference is noise. The engine did what it should: Jev p 0.95 on the fix-heavy file (formula 5.5 -> 6.85), p 0.97 on the workaround file (3.21 -> 4.62, crossing the threshold, the only flip it can cause), p 0.06 on the cosmetic-fix file (1.98 -> 0.66). Behaviour changed too: in 4 of 8 B runs the agent followed the Defensive-mode block (read the fixes, added characterization tests), in 0 of 8 A runs. But plain Haiku with effort xhigh already kept every planted guard in all 8 A runs, by reading git log or by running its own old-versus-new fuzz comparison, so there was nothing for the tool to rescue. The case set is too easy for the value of the skill to show.

## Suggestions, ranked by expected effect
1. **Measure where history is the only clue.**
   - **Change:** no tool change; a new experiment (new id) in which the guard looks dead in the code, no test covers it, and the reason is only in a commit message (for example a retry that exists because of one incident), with files long enough that fuzzing old-versus-new is not enough; use at least one real repository file with a long history.
   - **Why:** A kept the guards here because Haiku fuzzed old against new and treated every un-provably-redundant check as live.
   - **Expected effect:** plain Haiku fails some of these, B follows the Defensive-mode step and passes them; or A still passes and the tool is shown to be insurance only.
   - **How to verify:** same harness (harness/make_grs.py generator extended), hidden tests as the gold.
2. **Make the characterization-test step conditional.**
   - **Change:** `jev_skills/git_risk/risk.py` guidance(): step 3 says "run the tests that cover this file; add a characterization test only if none exist".
   - **Why:** 4 of 8 B runs wrote new test files although covering tests existed; it costs turns and was not rewarded (all 8 A runs passed without).
   - **Expected effect:** about 1-2 fewer turns on flagged files, no loss of safety.
   - **How to verify:** grs-01/grs-02 turns and tool calls in B.
3. **Fix the fix-regex.**
   - **Change:** `jev_skills/git_risk/risk.py:15-25`: `COSMETIC_RX` must not veto a subject that also names a real failure (crash, wrong, regression), and `FIX_RX` should match fixing/resolve/correct and stop counting "add regression tests" or "bump patch version".
   - **Why:** review finding (Major, accepted for this run): "fix crash when comment is empty" and "fix wrong currency format" score as not-a-fix; the fix ratio carries the largest weight (3 of 10).
   - **Expected effect:** fewer false negatives on exactly the hidden-fragility files Jev is meant to catch.
   - **How to verify:** unit tests on those subjects plus the backtest on a real repository.
4. **Widen the margin where Jev decides.** Jev flips grs-02 only above p 0.93 (adjustment at most 1.5 against a threshold 1.3 above the formula). Either re-derive the threshold with the backtest on a real repo or let Jev's kind (workaround_or_hack, revert_or_incident) set a floor instead of a bounded adjustment. Verify with the backtest `--with-jev`.
5. **Keep both parts; do not drop Jev:** it moved the right file over the threshold and the cosmetic file down, at $0.00003-0.0001 per scan and under 1 s.
