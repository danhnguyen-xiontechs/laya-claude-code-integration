# Offline gate — 20261018-cte-codegraph-02 — FAILED, agent run not started

Command: `node eval/run-gate.mjs --out reports/.../20261018-cte-codegraph-02/gate-offline.json` (worktree, codegraph 1.6.2 index, 9 tasks, K = 8). Raw: `gate-offline.json`.

| Engine | Recall@8 mean | Call-graph (cg1, cg2) |
|---|---:|---:|
| merged (codegraph with path prior + codemap rules, RRF) | 0.648 | 0.75 |
| codegraph only (with path prior) | 0.593 | 0.75 |
| codemap rules (gate target) | 0.704 | 0.75 |

Latency, merged explore call: p50 23.8 s, max 24.8 s (target p50 < 5 s). Almost all of it is codemap: `codemap find` takes about 5 s per query and the queries run in series. Codegraph calls are about 1 s.

Gate result: recall fails (0.648 < 0.704), latency fails (p50 23.8 s > 5 s). Per the rule, no agent run, no Opus call, no spend.

Why merged lost recall (cg3, "where is the step verdict decided": merged 0, codemap rules 1):
- RRF gives each path 1/(60 + rank) in each list. Codegraph's list is long (about 35 paths), and its top paths all match 4 of 4 queries through `build_report.mjs`-style names, so codemap's rank-0 `verdict.mjs` (score 1/61) is outranked by the codegraph top rows (0.032 combined) and falls out of the top 8.
- The path prior did not help here: the gold file is not a codegraph hit at all (its symbols are not named by the queries), so codegraph has no path to lift.
- A weight or cut-off that fixes this would be tuned on the same nine tasks, so it is not made here.

Path prior effect: it separates same-named copies on the task words (unit test: `integration-verifier` copy wins), but on the nine tasks it did not change recall alone (codegraph-only 0.593 in -02 vs 0.519 in -01; the difference comes from the path prior, measured on the same tasks, and is directional only).

Not done: agent run, answer keys, arms A/B, tokens, report. Branch: `claude/cte-codegraph` (commits here; not pushed, not merged).

Possible next steps, each as a new experiment with its own Gate A: (a) run the codemap find calls in parallel to cut latency; (b) cap the codegraph list before fusion (e.g. top 10) and re-gate on a new, held-out task set, not these nine.
