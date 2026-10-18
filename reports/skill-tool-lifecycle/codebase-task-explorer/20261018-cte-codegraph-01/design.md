# Design — codebase-task-explorer on codegraph (20261018-cte-codegraph-01)

Status: spike done 2026-10-18; design frozen before the offline gate.
Branch: `claude/cte-codegraph` (worktree `cool-stonebraker-ad2676`). Never pushed, never merged.

## 1. Spike (step 1): real CLI, real outputs

Setup, all runs with `CODEGRAPH_TELEMETRY=0 DO_NOT_TRACK=1`:

```bash
npm i -g @colbymchenry/codegraph     # → codegraph 1.6.2 (MIT), node:sqlite backend
codegraph init <scratch-copy>        # 398 files, 10.9k nodes, 23.9k edges, 10.5 s wall; wrote <copy>/.codegraph/codegraph.db (30 MB)
```

`codegraph install` was never run. `init` created only `.codegraph/` in the scratch copy (`git archive HEAD` of the branch base, outside the repo); no CLAUDE.md, `.claude` or MCP config change.

Commands the engine uses, and what they return:

| Command | Latency (wall) | Output | Use in engine |
|---|---|---|---|
| `codegraph query "<term>" -p <root> -l 10 -j` | 0.47–0.53 s | JSON array `[{node:{kind,name,filePath,startLine,signature,…}, score}]`. When results exceed `-l`, a line `Results truncated at N; pass --limit…` is appended **after** the JSON on stdout, so the parser cuts at the last `]` | retrieval, one call per query |
| `codegraph callers <sym> -p <root> -f <file> -j -l 40` | 0.50 s | JSON `{symbol,targets,definitions:[{definition,callers:[{name,kind,filePath,startLine}],edges:[{source,target,kind,line}]}]}`; same truncation note risk | caller count per row; direct callers in refactor/impact mode |
| `codegraph impact <sym> -p <root> -d 2` | 0.46 s | text: "N affected symbols", grouped by file | not used (wider than the 8-row budget) |
| `codegraph explore "<q>" -p <root> --max-files 3` | 0.5 s | **20,961 bytes** of markdown with verbatim source blocks | **rejected**: source bodies, far above the output budget |

Findings that change the design:
1. `query` is lexical over symbol and file names, not over paths in general: `query "merge assessment"` returned `merge` functions in four unrelated skills. Rules-free ranking therefore depends on query terms that name symbols.
2. `callers` mixes runtime calls with `[imports]` file edges and `(no callers)` entries. The engine counts only function/method/class/constant callers and reports import edges separately.
3. This repo has 13 copies of `decision-provider.mjs` (one per skill); `callers decide` lists 18 definitions. The duplication is real and makes the call-graph tasks non-trivial.
4. Latency is node start-up (~0.45 s) per call, so the engine runs calls in parallel and caps them.

## 2. Engine contract (what Claude decides vs what the tool decides)

`node scripts/explore.mjs --task "…" --mode bug|feature|refactor|new-feature --queries "a|b|c" [--engine auto|codegraph|codemap|fallback] [--symbol <name>] [--root <repo>] [--json]`

- **Retrieval**: one `codegraph query -j -l 10` per query (task text + queries), in parallel, 10 s timeout each. Nodes of kind `import` and `property` are dropped.
- **Order** (no model, no weights): candidates sorted by (number of queries that matched the path, best per-query rank, path).
- **Caller count per row**: `codegraph callers <name> -f <file> -j` for the top 8 rows, in parallel, 10 s timeout each; counts runtime callers and import edges separately.
- **Refactor / impact**: the named symbol is `--symbol`, else the top row's symbol. Output adds the direct callers with `file:line` (from `edges[].line`), max 20.
- **Output**: at most 8 rows, one line each: `path:line · symbol (kind) · matched k/n queries · callers c`. No source bodies. Footer: engine version, index status, timings, failed calls.
- **Telemetry**: every spawn gets `CODEGRAPH_TELEMETRY=0` and `DO_NOT_TRACK=1` in its env (unit test asserts this).
- **Never run**: `codegraph install`, `uninstall`, `init`, `sync`, `index`. The engine never creates `.codegraph/` in the target repo; indexing is a manual pre-step, timed and reported.
- **Jev**: not used on the codegraph engine; the footer says so.
- **Fallbacks** (labelled, never silent):
  - `codegraph` missing, or `.codegraph/codegraph.db` absent → `auto` uses the existing codemap engine (labelled "codemap fallback — codegraph unavailable: <reason>"), then the git-ls-files + rg fallback.
  - A call over 10 s is killed; its row prints "callers: timeout"; the rest still prints.
  - Unparseable JSON from a call → that query contributes nothing; the footer counts it.
- **codemap**: kept only as the labelled fallback and for the offline-gate baseline; the old pipeline (codemap + rules + optional Jev) is untouched behind `--engine codemap`.

## 3. Offline gate (step 3), frozen before running

Test set: `eval/tasks.json` (5 tasks, existing gold) + `eval/tasks-codegraph.json` (new; gold verified by grep and `callers`; at least 2 call-graph tasks). Metric: Recall@8 = gold groups with a path in the engine's top 8 ÷ groups.

Gate passes only if all hold:
- Recall@8 of codegraph (mean over all tasks) ≥ Recall@8 of codemap **rules** (`--engine codemap`, provider none, current `rulesTop`), and codegraph is not below codemap on the call-graph tasks.
- Latency per codegraph explore call: p50 < 5 s and max < 15 s.

If it fails, stop before any agent spend and report.

## 4. Agent run (step 4), frozen before running

- 4 tasks × 2 repetitions × 2 arms = 16 Haiku case agents (`effort: "high"`), at most 4 in flight, no polling.
- At least 2 call-graph tasks, at least 2 find-the-file tasks.
- Answer keys stay out of the agents' copy (`git archive` of the repo; eval gold and the new gold file removed).
- Arm A: works on a copy without `.codegraph/`; the prompt says no tool is available; checked with `subagent_usage.mjs --forbid "codegraph|codebase-task-explorer"`; any contaminated A run is discarded and kept in `evidence/contaminated-run<n>/`.
- Arm B: same prompt plus one sentence that the explorer is available and the index is present.
- Measured per case: real tokens from transcripts, turns, tool calls, pass/fail against gold.
- Success criteria as in the brief (call-graph turns B ≤ A − 20%, paired tokens B ≤ A + 5%, no case worse, pass B ≥ A).

## 5. Offline gate result (step 3) — FAILED, agent run not started

Run: `node eval/run-gate.mjs --out reports/.../gate-offline.json` on the worktree (codegraph 1.6.2 index, 398 files), 9 tasks (5 eval + 4 new), K = 8. Raw numbers: `gate-offline.json`.

| Engine | Recall@8 mean (9 tasks) | Call-graph tasks (cg1, cg2) |
|---|---:|---:|
| codegraph (rules-free) | **0.519** | 0.75 |
| codemap rules (current engine) | **0.704** | 0.75 |
| codemap task-text query only (B) | 0.593 | — |

Latency, codegraph explore call: p50 1,225 ms, max 1,400 ms (passes the < 5 s / < 15 s target).

Gate: recall **fails** (0.519 < 0.704). Call-graph tasks tie. Per the frozen rule, the agent run (step 4) is not started and no agent spend was made.

Where codegraph lost (from the per-task `top8` in `gate-offline.json`):
- cg3 "where is the step verdict decided": 0 vs 1. codegraph's top 8 holds the `build_report.mjs` / `build_execution_log.mjs` files and `claude-code.d.ts`-style noise; the gold `verdict.mjs` is not in the top 8. codegraph ranks by symbol names, and `verdict.mjs` exposes a symbol the query did not name.
- t5 "Apply filter button grounding": 0 vs 0.5 (codemap's rules found `serve.py` by path prior).
- t2 "subagent model hook": 0.5 vs 1 (codegraph ranked `.d.ts` type files above `router.mjs` / `hook-pretooluse.mjs`).

Post-hoc diagnostic (not the gate, not used for the decision; `diag-queries-only.mjs`): dropping the task sentence and keeping only the Stage-0 queries gives 0.426 vs 0.519. The task text is not the cause; the codegraph retrieval itself (symbol-name FTS, no path priors) is.

Engine behaviour found in the real run (`--engine codegraph --mode refactor --symbol decide`): the 13 copies of `decide()` tie on query matches, and with `--symbol` and no file the refactor target is the first definition in the index (`bmad-code-review-jev`), not the file the user means. A fix (use the top row's file, or list all definitions when the name is ambiguous) is needed before any refactor result can be trusted.

Not done: agent run, answer keys, arm A/B, tokens, report. The branch `claude/cte-codegraph` keeps the engine as opt-in (`--engine codegraph`); `auto` still runs codemap, so the default behaviour is unchanged.

Possible next experiment (new id, new Gate A; not this run): codegraph as a second candidate source merged into the codemap pool, or a path-prior step on top of codegraph's symbol order, re-gated on the same nine tasks before any agent spend.
