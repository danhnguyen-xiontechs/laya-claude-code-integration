# Round 2 plan: context-curator

**Diagnosis confirmed from round-1 evidence.**
- Tokens: A 2,579,987 vs B 3,562,527 (+38%); B higher in all 8 pairs (e.g. h04 r1 369k vs 593k, h06 r2 235k vs 549k). Passes 8/8 in both arms, so the cost buys nothing.
- What B read (`evidence/texts/*.B.txt`) was 82-269 KB vs 135-316 KB for A: the curated view cut only 17-44% (`_logs`: reduction 0.168 h04, 0.265 h06, 0.368 h02, 0.435 h07). B ran 57 turns vs 42.
- Structural cap, seen in the smoke run on h04: 408 candidate chunks but `maxChunks` = 80 sent to Jev, so 296 chunks never get an answer and are kept by rule. Even a perfect Jev cannot shrink a verbatim view much; the view, not the threshold, is the problem.

**Change chosen: suggestion 1 only.**
- Pointer view as the default output of `curate` (`curator.view: "pointers"`): status line + at most `pointerTop` = 12 one-line pointers + a Read hint; the full log stays on disk. On h04 this is about 1.7 KB instead of 320,309 bytes (0.5%). The old view stays available as `curator.view: "curated"`, identical to round 1 on h04.
- Ranking puts Jev's scores into the printed list (review Major 1): up to 4 failure anchors, then chunks Jev scored above `omitMaxP` by p, then the remaining anchors and regex-pinned noise, then unanswered chunks. On h04 a chunk with p=0.95 is now #5 (it was #45).
- `config.load()` keeps the `curator` object (review Major 2), so the view and `pointerTop` can be set in `.jev-advisor.json`, which makes rollback possible from the CLI.
- Suggestion 2 is deferred. WARNING protection waits for a held-out check: a trial `^WARNING\b` pinned 178 of 408 h04 chunks (38 without it), so it was reverted. `omitMaxP` was not re-tuned and no gold file was opened.

**Deviations from the brief, on purpose.** Failure anchors are listed with the label `anchor`, because without them the list never points at the failing test. The preview of a pinned chunk is the line that pinned it. Regex-pinned chunks are labelled `pinned`.

**Remaining risk.** When Jev scores nothing above the cut, slots 7-12 on h04 are noise ERROR chunks. The review Minors are still open (the Read hint covers only the first pointer, and the status-line wording).

**Verify in the rerun:** h02/h04/h06/h07, B tokens <= A, passes equal.
