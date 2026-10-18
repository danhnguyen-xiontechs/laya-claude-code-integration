# Design — 20261018-cte-r4-symindex-01 (symindex engine, offline comparison)

Brief: `idea-brief.md` (Gate A 2026-10-18). Branch `claude/cte-r3` (on top of `a424c9c`).
**Frozen 2026-10-18, after the held-out units and task texts were built (0 leaks) and before any engine ran on them.** Changes after this go to `deviations`.

## 1. Engine `symindex` (explore.mjs)
| Part | Contract |
|---|---|
| Files | `git ls-files` when `<root>/.git` exists, else a directory walk; the existing `JUNK` filter applies |
| Symbols | `ast-grep scan --config <temp sgconfig> --json=stream <root>`; rule dirs = codemap's `sg-rules` (`SYMINDEX_RULES` or `~/tools/codemap/sg-rules`) + `scripts/sg-rules-types/` (new: type declarations for csharp, javascript, typescript, python). Only rule ids ending in `-functions` or `-types` are used. Binary: `AST_GREP_BIN`, `ast-grep`, `sg`, `~/tools/codemap/ast-grep.exe` |
| Symbol name | match text minus lines starting with `[` or `@` (attributes, decorators); types: identifier after `class\|interface\|record\|enum\|struct`; functions: last identifier before the first `(` that is not a keyword (`if for while switch catch return new function using lock foreach`) |
| Words | split on non-alphanumerics and camelCase / PascalCase boundaries, lower-case, length > 2 |
| Score per query | for each query word w: +2 if w matches a path word; + min(3, number of the file's symbols with a word matching w). Match = equal, or one starts with the other and the shorter has length ≥ 4. Files with score 0 are dropped; top 30 per query, ties by path |
| Hit shape | same as `codemapFind`: `{ path, score, matched, importers: null, hub: false, query, rank }` |
| Cache | `os.tmpdir()/codebase-task-explorer/symindex/<sha1(root, HEAD or 'nogit', file count, newest mtime)>.json`; never written inside the repo. `result.index = { cached, buildMs, files, symbols, astGrep: ok\|missing\|failed\|timeout }` |
| Failure | ast-grep missing, failing or over 15 s → path-only index, with a coverage note. (The brief said "fallback engine on timeout"; path-only keeps the path signal and is simpler. Fixed here, before data.) |

## 2. Order
- New option `order: 'rules' | 'codemap'` (CLI `--order`). Default `rules` (brief). `result.order` = `rules`, `codemap` or `rules+jev`.
- `result.engineOrderTop` (new) always holds the codemap-style order of the same pool, like `rulesTop`, so one call gives both orders.
- Round-3 tests that expect `codemap` order pass `order: 'codemap'` explicitly.

## 3. Sets (K = 8; Laya also K = 5)
| Set | Tasks | Notes |
|---|---|---|
| ess-be r3 | 8 filtered units (main), all 12 reported | `D:/cte-r3`, unchanged |
| ess-be held-out | all 8 units `h01-h08` (no hardness filter: 8 is already small) | `D:/cte-r4`. The brief's "16 tasks after the filter" is replaced by: held-out 8 + Laya 11 = 19 tasks for the default-order decision |
| Laya | 11: `eval/tasks.json` (5) + r2 `tasks-new.json` (6) | root = the `claude/cte-r3` worktree; gold = groups (a group counts when any of its paths is in the top K, as in `run-eval.mjs`) |
ess-be Recall@8 = |gold ∩ top8| / min(|gold|, 8), as in round 3. Laya recall = groups hit / groups.

## 4. Arms and measurement (`scripts/compare.mjs`)
One explore call per (task, engine) with `provider none, order rules, top 30`; `top` gives the rules order and `engineOrderTop` the codemap-style order.
| Arm | Source |
|---|---|
| C-cm | codemap call, `engineOrderTop` |
| C-rules | codemap call, `top` |
| S-rules | symindex call, `top` |
| S-cm (info) | symindex call, `engineOrderTop` |
| rg (reference, ess-be only) | the round-3 rg adapter (copied) |
Latency = `elapsedMs` of the explore call. symindex gets one warm-up call per root first (its `buildMs` is the first-build time); measured calls then run from cache. codemap has no cache; its calls are measured as they are. Runs are sequential, with nothing else heavy on the machine.

## 5. Criteria (from the brief, frozen)
- symindex latency from cache: p50 < 2 s, max < 5 s; first build < 30 s per root.
- Recall@8 S-rules ≥ C-rules − 0.05 on each set (ess-be r3 filtered, held-out, Laya); Hit@8 S-rules ≥ C-rules − 1 task per set.
- Held-out: S-rules Recall@8 ≥ rg + 0.15.
- Default order = the higher pooled Recall@8 (held-out 8 + Laya 11) of S-rules vs S-cm; ties → rules.
- Tests: `node --test "tests/*.test.mjs"`, 0 failures.

## 6. Tests to add (`tests/symindex.test.mjs`)
Word splitting (camel, Pascal, acronyms, paths); symbol-name extraction (C# method with attributes, C# class, JS function, Python def); scoring (path weight 2, symbol cap 3, prefix rule, score-0 dropped, ties by path); cache key changes when a file is added; no file written inside root; ast-grep missing → path-only + note; ast-grep timeout (fake bin) → path-only + note; hit shape equal to codemap's; `order` option and `engineOrderTop`.
