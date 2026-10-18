# Offline gate — 20261018-cte-r3-gate-01 — FAILED on latency, agent run not started

Repo: ess-be (C#, private). 12 units from real fix/feat changes, gold = modified non-test `.cs` files at the parent commit, task texts written by a Haiku agent from the PR subject/body only (0 leaks by the mechanical check). Hardness filter (no gold in `rg` top 3): 7 hard units + 1 easy control = 8. K = 8. Raw: `gate-offline.json` (ids and numbers only; texts, paths and engine outputs stay in `D:/cte-r3/`).

## Result
| Engine | Recall@8, filtered (8) | Hit@8, filtered | Recall@8, all (12) | p50 / max latency (filtered) |
|---|---:|---:|---:|---|
| `rg` on task words (reference) | 0.120 | 4/8 | 0.358 | 0.8 s / 2.0 s |
| **codemap** (explore.mjs, provider none, codemap order) | **0.412** | **6/8** | **0.497** | **15.8 s / 25.7 s** |
| ck hybrid (bge-small) | 0.000 | 0/8 | 0.000 | 1.0 s / 5.2 s |
| ck semantic (info only) | 0.000 | 0/8 | 0.000 | 0.4 s / 0.6 s |
| aider repo-map (RepoMapper) | 0.031 | 1/8 | 0.021 | 2.6 s / 3.7 s |

Gate rule (frozen): recall ≥ rg + 0.15 **and** p50 < 5 s, max < 15 s.
- codemap: recall passes (0.412 ≥ 0.270), latency fails (15.8 s). **Gate fails**, so no agent run or Opus call is made.
- ck, repomap: fail on recall.

## Why
- **codemap is slow because each `codemap find` rescans the whole repo.** One query on a 2,821-file snapshot takes 9.3 s. The time stays at 9.4 s with the `codemap --watch` daemon running, and no reusable index is kept. 5 queries at 4 in parallel take about 2 rounds, i.e. 25 s. On the small old snapshots (e07-e12) the same call takes 1.3-1.8 s. Parallel queries (this round's fix) cut the serial time (~45 s) roughly in half but cannot reach 5 s on ess-be.
- **ck returns docs, not code.** Its top 8 on the large snapshots are `AGENTS.md`, `CLAUDE.md` and `docs/*.md` chunks. Those describe the features in plain words, so the embeddings match the task text better than the C# does.
- **repomap ranks by graph centrality and ignores the task words.** PageRank over the whole repo puts central DTO/service files first. `--mentioned-idents` only helps when the task names exact identifiers, which these tasks cannot (by design).
- **The hard tasks are hard.** On 2 of 8 filtered units (e07, e08) no engine has gold in the top 8.

## Guardrail and tests
- Laya `eval/tasks.json`, Recall@5: codemap order 0.633 vs old rules order 0.467, so the new default loses nothing (`guardrail-laya.json`).
- Unit tests: 28/28 pass on `claude/cte-r3` `a424c9c` (`unit-tests.json`).

## Deviations
- ck adapter fixed after the first run, before scoring. ck prints absolute `\\?\D:\…` paths, which never matched the gold, and `--topk` counts chunks, not files (50 chunks gave 3 files). The fix makes paths relative and uses `--topk 400` so the contract (8 distinct files) can be met. ck still scores 0.
- ck index time for e01 was not captured (the index was built in a timing probe whose log was cut). The others are in `indexMs`: ck 107-151 s on the large snapshots, 10-46 s on the small ones.
- The rg baseline ran while the ck index of e01 was building, so rg latencies are a little high. They are not part of the decision.
- No agent session was used to build the gold. One Haiku agent wrote the task texts (≈57k tokens).

## Options for the next round (each needs its own Gate A)
1. **Fast lexical engine with the codemap signal.** Recall comes from path + symbol-name matching, which is what codemap does. Build that index once per repo (`git ls-files` + a symbol list from `ast-grep`/ctags, already on this machine in `~/tools/codemap/sg.exe`) and answer every query from it in < 1 s. Gate it on these same 12 units against codemap's recall 0.412 / 0.497.
2. **Accept codemap's latency and run the agent A/B anyway.** 15-25 s per call is still faster than the 6+ turns a grep agent needs on a hard task. The latency rule was set to stop the r2 failure mode (calls going past the 120 s Bash timeout), and 25 s does not hit that. This changes a frozen gate criterion, so it is the user's call.
3. **ck with docs excluded (`.ckignore` on `*.md`) or the code model (`jina-code`).** This is tuning after seeing the result, so it would need a new held-out unit set.
