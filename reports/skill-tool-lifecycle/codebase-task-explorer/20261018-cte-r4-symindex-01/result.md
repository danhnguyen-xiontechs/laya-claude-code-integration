# Result — 20261018-cte-r4-symindex-01 (symindex, offline)

Branch `claude/cte-r3`: engine `8f3bdfb` (frozen run), hidden-dir fix `5218b0f` (re-run). Raw: `compare-frozen.json` (frozen run), `compare-fix.json` (after the fix); ids and numbers only, ess-be data in `D:/cte-r3`, `D:/cte-r4`.

## Verdict
**Gate not passed** by the frozen rule, in both runs. After the fix, symindex passes every criterion except one: on the held-out ess-be units, plain `rg` beats it (and every other engine). Speed is solved: **~90 ms per call instead of 15 s**, with recall equal to or better than codemap on ess-be, and equal on Laya in codemap order.

## Numbers after the fix (`compare-fix.json`), Recall@8 / Hit@8 / p50 latency
| Set | codemap, codemap order | codemap, rules | **symindex, rules** | symindex, codemap order | rg |
|---|---|---|---|---|---|
| ess-be r3, 8 hard units | 0.412 / 6 / 16.0 s | 0.537 / 6 / 16.0 s | **0.583 / 7 / 75 ms** | 0.599 / 7 / 75 ms | 0.120 / 4 / 0.4 s |
| ess-be held-out, 8 units | 0.278 / 5 / 0.9 s | 0.296 / 5 / 0.9 s | **0.377 / 5 / 7 ms** | 0.216 / 4 / 7 ms | **0.518 / 6** / 0.2 s |
| Laya, 11 tasks | 0.788 / 10 / 15.7 s | 0.621 / 9 / 15.7 s | **0.576 / 8 / 94 ms** | 0.788 / 10 / 94 ms | — |

| Criterion (frozen) | Value | Pass |
|---|---|---|
| symindex latency p50 < 2 s, max < 5 s | 89 ms / 137 ms | yes |
| First index build < 30 s | max 2.4 s (1,420-file ess-be snapshot) | yes |
| Recall@8 symindex+rules ≥ codemap+rules − 0.05, each set | r3 0.583 vs 0.537; held-out 0.377 vs 0.296; Laya 0.576 vs 0.621 | yes (all 3) |
| Hit@8 ≥ codemap+rules − 1 task, each set | 7 vs 6; 5 vs 5; 8 vs 9 | yes (all 3) |
| Held-out: symindex+rules ≥ rg + 0.15 | 0.377 vs 0.518 | **no** |
| Default order (pooled held-out + Laya) | codemap 0.547 vs rules 0.492 | → codemap order |

## The frozen run (`compare-frozen.json`) and the bug
In the frozen run, symindex lost on Laya (0.485 vs 0.621, Hit 6 vs 9). Cause: **ast-grep skips dot-directories by default**, and all Laya skills live in `.claude/`, so 0 of their files had symbols (476 symbols in all of Laya, vs 1,575 after the fix). The fix is `--no-ignore hidden`, plus a version in the cache key so stale indexes are not reused. It is a coverage bug, not a tuned parameter. ess-be results did not change: the `.cs` code is not in hidden folders.

## What the numbers say
- **Latency is solved.** About 90 ms from cache and at most 2.4 s for a first build, against codemap's 15-25 s. This was the only reason round 3 failed.
- **Recall: symindex ≥ codemap on ess-be, = codemap on Laya in codemap order.** symindex in codemap order reproduces codemap on Laya exactly (0.788 / 10).
- **The best order still differs by repo.** On ess-be, rules order wins for symindex on held-out (0.377 vs 0.216) and the two are about equal on r3. On Laya, codemap order wins (0.788 vs 0.576). The frozen pooled rule picks codemap order (0.547 vs 0.492), but that is driven by Laya. On the ess-be held-out units it would lose 0.16. Directional, 8-11 tasks per set.
- **On the held-out units grep is best (rg 0.518, Hit 6/8).** These units were not hardness-filtered (design choice: only 8). They come from the small early snapshots (83-175 files), where the task words appear in the code. On the hard r3 units it is the other way round: symindex 0.583 vs rg 0.12. The tool helps on tasks where grep fails, and costs recall where grep already works. The frozen criterion "≥ rg + 0.15 on held-out" assumed held-out would be hard. It was not, so this result says more about the task mix than about the engine.

## Deviations
- A second, labelled run after the hidden-dir fix (`5218b0f`). The verdict uses the frozen rule on both runs; the post-fix numbers are the ones to plan with.
- Held-out units were not hardness-filtered (design.md section 3, decided before data).
- Windows: the two unit tests that fake a hanging or failing ast-grep run only on Linux/macOS (Node cannot spawn a `.cmd` shim without a shell). The live tests (`SYMINDEX_LIVE=1`) ran here: 12/12.

## Options (user decision)
1. **Adopt symindex as the engine behind a flag and run the agent A/B on hard ess-be tasks.** Latency and recall vs codemap pass. The open question is whether the agent spends fewer turns on hard tasks. Combine it with a simple guard: when grep finds the task words in few files, show rg's top hits first.
2. **Order:** pick per repo by a cheap signal, or keep rules (safer on ess-be, the repo the user works in) and keep `--order codemap` available. Do not tune on these sets: decide on a new held-out set.
3. Re-run the held-out check on hard-filtered units (needs more ess-be units; only 12 + 8 exist with clean subjects).
