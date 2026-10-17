# Idea brief (retro): jev_advisor (test wrapper with Jev hints)

Retro run 2026-10-18, no new implementation. The tool already exists in the JEV repo (PILOT in the Laya/Jev report); steps 1-3 are skipped by the user's brief. This file only fixes the question this run answers.

**Question:** on a failing pytest run with a long log (130-310 KB, 16 lookalike loggers, handled tracebacks, the real clue in a plain INFO/DEBUG line), does `jev_advisor` with Jev live make Haiku 5.5 find the root cause with fewer tokens, without getting any case wrong?

**Tool:** wrapper that runs a trusted test profile, streams the output unchanged, and appends [local]/[jev] hints that point at log lines. Arm B here is the C arm of docs/runs/abc (Jev hints shown); arm A is plain pytest output.
**Jev decides:** per-chunk Noul question "does this log chunk help explain the failure" (model typesafe/jev-1.13, OpenRouter decisions API).
**When Jev is wrong / slow / down:** advisor falls back to local anchors only; curator omits nothing (Jev answers missing = keep).
**Success criteria (fixed before data):** B passes every case A passes (no worse case) AND B total tokens < A total tokens (paired by case and repetition). Directional only: 4 cases x 2 repetitions.
**Non-goals:** fixing the tool, tuning thresholds, any other runner than pytest.
