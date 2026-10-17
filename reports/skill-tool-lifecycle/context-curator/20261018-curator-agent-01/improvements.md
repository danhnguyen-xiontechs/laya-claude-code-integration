# Improvements (bad-result review, step 7b)

**Diagnosis.** B cost 3.56M tokens vs 2.58M for A (+38%, B higher in all 8 pairs) with 8/8 passes in both arms. The curated view was only 17-44% smaller than the log (evidence/_logs: 71-77 chunks omitted out of 174-408, reduction 0.17-0.44 of the characters), so the saving was small, yet B agents ran 57 turns vs 42 and received 1.5-2x larger tool results; A agents saved the full log and grepped for the one line. Jev answered every call (11 runs, ok, about 1.1 s) and no gold line was lost, so the engine was safe but did not reduce what the agent needed. The cases were also easy (1-2 KB sources). Open review findings (accepted for this run, not fixed): the threshold is in-sample (tuned on these same scenarios), WARNING lines are not in alwaysKeep although h02/h04 evidence is a WARNING, and an omitted chunk may contain text Jev never saw.

1. **Do not replace the log with the curated view; return a short ranked pointer list instead.**
   - **change:** `jev_advisor/curator.py::render` (and the wrapper): print the status line plus the top-N kept chunks with line ranges, and leave the full log on disk.
   - **why:** a 60-80% view is still far above what an agent reads; B agents ran more turns (57 vs 42; whether they read omitted ranges back was not measured).
   - **expected effect:** tool output of a few KB instead of 80-270 KB.
   - **how to verify:** rerun h02/h04/h06/h07: B tokens <= A, passes equal.
2. **Raise the cut to a level that matters, protect WARNING lines.**
   - **change:** `curator.py` `DEFAULTS["alwaysKeep"]` add `^WARNING` / parser KEYWORDS; evaluate `omitMaxP` on held-out scenarios, not the 19 used to pick it.
   - **why:** the release gate (0 lost) was met in-sample; h02 and h04 gold lines are WARNING lines kept only by p > 0.2.
   - **expected effect:** safe at higher cuts; removes the in-sample caveat.
   - **how to verify:** `curate-eval` on new scenarios; 0 gold patterns lost at the chosen threshold.
3. **Only curate logs larger than the agent's output limit.**
   - **change:** skip curation under about 200 KB (these logs were 135-316 KB and Claude Code truncates long output anyway).
   - **why:** the benefit appears only when the raw log would not fit; below that the curator adds a Jev call and turns.
   - **expected effect:** fewer cases where B is worse.
   - **how to verify:** tokens per case vs log size.
4. **Drop the curator until a version cuts at least 70% of the log without losing the gold line**; the advisor alone already writes the full log to a file.
