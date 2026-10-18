# codebase-task-explorer — improvements after 20261017-cte-agent-02

## Diagnosis

B's extra 1.14M tokens (10.76M -> 11.90M, +11%) come from **20 extra model turns** (130 -> 150; B had more turns in 9 of 12 pairs, fewer in 1) at roughly the same context per turn (A 82.8k, B 79.3k tokens/turn). They do not come from tool calls (201 -> 191) or from reading the helper output: B's markdown is about 1.7 KB vs 0.8 KB for A, around 250 extra tokens per read, so under about 50k tokens over all 12 cases. The ~3 min helper time is not Jev. Jev latency was 1.8-3.6 s per case (46 calls, 0 fallbacks). The other 72-214 s of `elapsedMs` was codemap: one `spawnSync` `codemap find` per query, run in series, with 12 agents running at once. A runs the same `explore.mjs --provider none` retrieval, so A pays this too. Jev changed the rules #1 in 3 of 6 tasks. It was right on n3 (build_tool_report.mjs, which rules put outside its top 5 offline) and on-target at #1 in n1/n2/n4 (agreeing with rules, p 0.59-0.98). It was wrong on n5 (log-hook.js, p 0.38/0.40) and n6 (report.js, p 0.28/0.31; gold only at #5). Those are exactly the 4 B answers that call the helper "not useful" and replace it with their own grep. The cases are at the ceiling: in 4 of 6 tasks, codemap's raw order (arm A) already has the gold file at #1, and both arms pass 12/12 by reading code. This set cannot show a ranking gain. It can only show the cost of the extra rows that agents check and then reject in their answers.

## Suggestions (ranked by expected effect)

### 1. Gate the output on Jev's global top-1 probability and cut the noise rows

- **change:** `scripts/explore.mjs`, about 35 lines.
  - In `explore()`, after `jevRank`, compute `const p1 = jev.global?.order?.[0]?.p ?? null;` and `result.confidence = !jev.called || jev.fallback ? 'rules' : (jev.global.noneWon || p1 < 0.5) ? 'low' : 'high';`. Attach `p` to each `top` row from `jev.global.order`, and write `confidence` and `p1` to the `runs.jsonl` record.
  - In `toMarkdown()`:
    - `high`: print only the rows until cumulative p ≥ 0.9, at most 5, with a `p` column.
    - `low`: print a first line `LOW CONFIDENCE (Jev top p=0.31): these are vocabulary hits, not starting points — search with new terms`, then only the top 3, labelled "weak".
    - `rules` (Jev skipped or fell back): print the top 5, unchanged.
  - `SKILL.md` Stage 4, 3 lines: "If confidence is high, open #1 first and do not audit rows the tool did not print. If it is low, skip to your own search or the one rerun with new vocabulary."
- **why:** In this run, top-1 p splits right from wrong with no overlap. On-target #1 had p 0.59-0.98 (8 runs: n1-n4). Off-target #1 had p 0.28-0.40 (4 runs: n5, n6). Today the helper prints 10 rows whatever the confidence. Every B answer spends text, and turns, rejecting ranks 3-10 ("noise", "unrelated", "I replaced them with my own grep"). On n5/n6 the agent also opens the off-target files before falling back to grep.
- **expected effect:** Fewer turns in B: about −1 to −3 per case on n1-n4, where agents stop checking rows that were not printed, and about −2 per case on n5/n6, where agents skip the bad picks. That should close most of the +20 turns, so B tokens come out at or below A, with pass unchanged at 12/12. The 0.5 threshold is in-sample: 12 runs from 6 tasks.
- **how to verify:**
  - Re-run the same 6 tasks × 2 reps, Haiku 5.5 at xhigh, with the same harness and the same blind queries.
  - Primary measures: B `modelTurns` and total tokens vs A from `scores.json` (target: B ≤ A), with pass rate unchanged.
  - Check `runs.jsonl`: `confidence` should be `low` on exactly n5 and n6, and `high` on n1-n4.
  - Also run `offline_score.mjs` on `eval/tasks.json` with p1 logged, to check the threshold out of sample.

### 2. Replace or extend the case set so a ranking gain can show

- **change:** Two files in the next experiment folder.
  - `tasks-new.json`: add at least 4 tasks where the gold file is in the pool but not in codemap's raw top 10. Pick them with `offline_score.mjs` before any agent runs; n3-like tasks, where many near-duplicate `build_report.mjs` copies crowd out the real file, are the pattern. Keep one or two n5-like retrieval misses as controls.
  - `score.mjs`: add "turns until first gold file opened", which needs the transcripts kept under `evidence/`. This run kept only usage totals, so the extra turns cannot be traced back to individual tool calls.
- **why:** In 4 of 6 tasks arm A already had gold at #1. With Recall@5 at 12/12 vs 12/12, only the cost side of the tool is measurable.
- **expected effect:** The next A/B can show a pass or recall difference, or prove there is none, in a range where the offline Jev advantage is real (offline: 4/5 vs 1/5, 5/6 vs 3/6).
- **how to verify:** Before the agent run, the offline score should show codemap-only failing on the new tasks while Jev passes on at least half. Then run 2 reps and compare pass and turns-to-gold.

### 3. Run the codemap queries in parallel

- **change:** In `scripts/explore.mjs`, `codemapFind()` and `run()`: replace the serial `spawnSync` loop with async `spawn` under `Promise.all`, at most 4 at a time. Keep the hits in query order so the result stays deterministic. About 20 lines.
- **why:** About 98% of the helper's 72-214 s is the serial codemap calls (task + 4-6 queries); Jev is 2-4 s of it. The 3 min is over the 120 s default Bash timeout, so the call goes to the background and the agent needs extra turns to poll (n3.r1.B: "it ran in the background"; A answers mention it too).
- **expected effect:** Helper wall time drops by about 3-4× under the same load, with fewer background/poll turns in both arms. That saves time, not much B-vs-A token difference.
- **how to verify:** Compare `elapsedMs` in the B logs and `runs.jsonl` against this run, with the same 12 parallel agents. Count answers that mention "background" or a wait.

### 4. Cut wasted Jev calls: merge small tail batches, drop survivors when none_of_these wins

- **change:** In `scripts/explore.mjs`, `jevRank()`, about 8 lines.
  - Merge the last batch into the previous one when it has fewer than `opts.batch/2` members and the request stays under `maxPayload`.
  - Do not add `kept` from a batch where `noneP ≥ 0.9` to the survivors.
- **why:** In n1, the 27-candidate pool became 24 + 3. The 3-member batch scored `none_of_these` p = 1, yet its 3 files still went to the global rerank. Pools 27, 59, 33 and 82 all have small tails.
- **expected effect:** Jev calls go from 46 to 34 (−26%) on the same 12 runs: n1 and n5 drop to 1 call each, n2 and n6 lose 1 each. Rankings stay the same, because the dropped calls only scored tail candidates.
- **how to verify:** Run `node --test tests/explore.test.mjs` with 2 new stub tests (tail merge, noneWon drop). Then re-run `offline_score.mjs` on both task sets: the summary pass counts should stay at 4/5 and 5/6 with lower `jevCalls`.

### 5. Close the open Minor review findings as one hygiene patch (no measured effect)

- **change:**
  - (a) `readBatch()`: if `answer.probabilities` is not an object of finite numbers, return an error, and have `jevRank` treat that as a failure.
  - (b) `jevRank()`: add `if (!ranked.length) return { order: [], jev }`.
  - (c) `fallbackFind()`: report rg exit 2 even when there is stdout ("partial: some files unreadable").
  - (d) `JUNK`: re-add `(^|\/)bin\/(Debug|Release)\/` and `(^|\/)out\/` when there is a sibling `src/` or `*.csproj`, or at least add `bin/Debug|Release` back.
  - (e) Numeric CLI options: add upper bounds (`--max-calls ≤ 12`, `--batch ≤ 40`, `--max-pool ≤ 200`).
  - (f) Copy the `decision-provider.mjs` hardening to the 12 other skills, or move it into one shared module.
  - The "guard reason shown" finding is already fixed and needs no change.
- **why:** 7 Minor findings are open in `20261017-cte-agent-02/agent-review.json`. None of them affected this measurement: 0 fallbacks in 46 calls, codemap engine, no empty pools.
- **expected effect:** Robustness only. No change to pass rate or tokens on these 6 tasks.
- **how to verify:** Add 1 unit test per item in `tests/explore.test.mjs`, plus the reviewer's suggested fixture test that runs the real `rg`. All tests should pass, and the next agent-review should list these findings as resolved.

### On "drop the engine call / drop the tool"

- **Keep rules only: not supported.** Offline, rules alone (3/6) did worse than codemap's raw order (4/6) on the new tasks, and Jev rescued n3 and n6.
- **Drop the Jev call when rules and Jev agree: not possible.** Jev agreed with rules at #1 in 3 of 6 tasks, but that is only known after the call.
- **Drop the tool: conditional.** If suggestion 1 plus a re-run of the same 6 tasks still shows B tokens > A at 12/12 vs 12/12, then for Haiku-level agents on this repo the tool is cost without benefit. In that case, drop the tool from the default flow, or ship it with `--provider none` and confidence-gated output only, until suggestion 2 shows a gain.
