# Idea Brief — codebase-task-explorer: codegraph as a second candidate source, with a path prior

- **Experiment ID:** `20261018-cte-codegraph-02`
- **Status:** `APPROVED_FOR_IMPLEMENTATION` (Gate A, user approval 2026-10-18)
- **Gate A quote (user, relayed by the orchestrating session):** "oke gộp cũng dc, 1 vs 2. Khi nào ổn thì chạy test thật" — i.e. do both directions: (1) codegraph as a second candidate source merged into the codemap pool; (2) a path prior on codegraph's symbol order to separate same-named copies.
- **Predecessor:** `20261018-cte-codegraph-01` (opt-in codegraph engine; offline gate failed, Recall@8 0.519 vs codemap rules 0.704).
- **Scope fixed here:** the same nine tasks (5 in `eval/tasks.json` + 4 in `eval/tasks-codegraph.json`), Recall@8, same gold.

## Problem
In -01 codegraph alone lost recall on find-the-file tasks: its symbol-name FTS ranks files by query matches without path priors, so the right file can be outranked by look-alike copies or by `.d.ts` / test files. Codemap's rules find the right file by path and filename matches. The two engines fail on different tasks, so combining them may help.

## Hypothesis
A reciprocal-rank fusion of codegraph's order (with a path prior that counts task/query words found in the path segments) and codemap's rules order gives higher Recall@8 than either alone, without losing the call-graph tasks, at a latency that the user accepts.

## Proposed intervention
- `--engine merged`: codegraph candidates (path prior on order) fused with codemap rules candidates by RRF (k = 60). Output: at most 8 rows, one line each, `found by` column (codegraph / codemap / both). Callers come from codegraph for rows with a symbol. No Jev.
- `--engine codegraph` keeps the path prior but no codemap.
- `auto` stays codemap until a gate passes.

## Success criteria (fixed before any data)
| Metric | Baseline | Target | Guardrail |
|---|---:|---:|---|
| Offline gate, 9 tasks, Recall@8 mean | codemap rules 0.704 | merged ≥ 0.704 | stop before agents if below |
| Call-graph tasks (cg1, cg2) Recall@8 | codemap rules 0.75 | merged ≥ 0.75 | no loss |
| Latency p50 per explore call | codegraph-only ~1.2 s | < 5 s | stop if above |
| Agent run (only if the gate passes) | plain A | B tokens ≤ A + 5%, call-graph turns ≤ A − 20%, no case worse | — |

## Alternatives considered
| Alternative | Verdict |
|---|---|
| Codegraph alone (-01) | failed gate |
| Codegraph explore output (source bodies) | rejected: too long |
| Jev rerank | out of scope (no Jev by default) |
| Weighted fusion tuned on the nine tasks | rejected: tuning on the gate set |

## Risks
| Risk | Mitigation |
|---|---|
| codemap find is slow (about 5 s per query, run in series) | measured and reported; a latency failure stops the run |
| Fusion dominated by the longer codegraph list | reported as a finding, not tuned on the gate set |
| Gate set small (9 tasks) | directional only |

## Recommendation
Implement as above, run the frozen gate once; stop and report if it fails.
