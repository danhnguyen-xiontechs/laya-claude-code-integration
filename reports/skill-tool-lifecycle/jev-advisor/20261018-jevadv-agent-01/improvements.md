# Improvements (bad-result review, step 7b)

**Diagnosis.** B spent 3.63M tokens against 3.38M for A (+7.4%, B higher in 6 of 8 pairs) with 8/8 passes in both arms, while the spread between two repetitions of the same arm reaches 2x (h03 A: 420k vs 606k), so the extra cost is within noise but there is no gain to pay for it. B agents ran slightly more turns (58 vs 54) and received larger tool results (16-25 KB vs 7-33 KB in the cases where A found the line with one grep), and their own notes say the advisor's hint pointed at noise or the symptom in 4 of 8 runs (h03 x2, h05 r2, h01 r2); in h01 r1 the top Jev hint (p=0.73) was the gold line, but A found the same line from the 1-2 KB source plus one grep. The engine worked: 10 Jev calls, all ok, about 1.1 s, 78-80 chunks answered, no fallback. The cases were too easy: the scenario sources name the cause, so no tool can show value. Open review finding: redaction misses prefixed secret names (accepted for this run, not related to the result).

1. **Measure on cases where the cause is not in the source.**
   - **change:** new scenario set (log-only causes: a config value from the environment, a flaky ordering, a value that exists only in the log) with logs over 300 KB; `examples/scenarios`.
   - **why:** with a 1-2 KB source that names the cause, plain Claude greps the log once and finishes; the run cannot separate tools.
   - **expected effect:** A needs more turns or fails on some cases, so a hint can pay for itself.
   - **how to verify:** rerun this experiment with 6 such cases x 3 repetitions; require B passes at least as many cases and uses fewer tokens.
2. **Print at most one [jev] hint, and only when it differs from the local anchor.**
   - **change:** `jev_advisor/advisor.py` `hints()` / `maxJevHints` 3 -> 1 and drop hints whose focus line is a repeated logger source.
   - **why:** 4 of 8 agents judged a hint to be noise; each extra hint costs tokens and a turn to dismiss.
   - **expected effect:** about 100-200 fewer tokens per run and fewer wasted reads.
   - **how to verify:** count hint lines that contain a gold pattern vs not over the 10 saved advice files in evidence/_logs.
3. **Drop the Jev call when the local parser already finds the failure anchor.**
   - **change:** `runner.py::_advise` skip `_spawn_worker` when there is one failure with a clean assertion diff.
   - **why:** the engine added 1.1 s and a Jev call per run and changed nothing the agents used on h07 (the anchor plus source were enough).
   - **expected effect:** no Jev cost on obvious failures; keeps Jev for multi-failure logs.
   - **how to verify:** engine-call count per case drops while passes stay equal.
4. **Drop the tool** if suggestion 1 shows no gain on logs the agent cannot grep with one line.
