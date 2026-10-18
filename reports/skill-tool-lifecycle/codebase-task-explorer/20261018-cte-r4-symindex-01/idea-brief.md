# Idea Brief — codebase-task-explorer round 4: fast path + symbol index (ast-grep), rules order, no Jev

- **Experiment ID:** `20261018-cte-r4-symindex-01`
- **Track:** E (existing tool, new retrieval engine). Step 4 of the plan the user set on 2026-10-18.
- **Status:** `APPROVED_FOR_IMPLEMENTATION` (Gate A 2026-10-18)
- **Owner:** user (XionTechs / Laya)
- **Date:** 2026-10-18
- **Baseline:** `20261018-cte-r3-gate-01` (`gate-result.md`, `pool-result.md`), branch `claude/cte-r3` `a424c9c`.

## Question this run answers
Can a prebuilt path + symbol index answer in about 1 s, with the same recall as codemap, so the explorer passes the latency gate? And which order should be the default: rules or codemap's own?

## What round 3 showed
| Finding | Evidence |
|---|---|
| codemap finds more than grep | ess-be, 8 hard units: Recall@8 0.41 vs rg 0.12; Hit@8 6/8 vs 4/8 |
| codemap is too slow | each `codemap find` rescans the repo: 9.3 s per query on a 2,821-file snapshot; 15.8 s p50 per call with 5 queries in parallel. `--watch` does not help |
| The rules order beats the codemap order on ess-be | Recall@8 0.536 vs 0.411 (filtered); on Laya the other way round, 0.467 vs 0.633 |
| Jev adds nothing over the rules | rules + Jev 0.536 = rules 0.536, 33 calls, +2.4 s; Hit@8 unchanged |
| ck and aider repo-map do not fit | Recall@8 0.00 and 0.03 on the same units |

## Hypothesis
codemap's recall comes from matching query words against file paths and function names. An index of exactly that, built with ast-grep, can be answered in under a second. Spike on ess-be snapshot e03 (709 `.cs` files): `ast-grep scan` with codemap's own `sg-rules/csharp.yml` extracts 5,857 methods and 4,407 usings in **0.47 s**. Fed into the existing cleanup + rules pipeline, it should keep codemap's Recall@8 at p50 < 2 s.

## Proposed change
- **New engine `symindex` in `scripts/explore.mjs`** (`--engine symindex`, beside `codemap` and `fallback`):
  - **Index:** `git ls-files` (or a directory walk when there is no `.git`), path tokens, plus symbols from `ast-grep scan --json=stream` with codemap's per-language rules (`~/tools/codemap/sg-rules/*.yml`). Add one rule file for type declarations (class / interface / record / enum), which codemap's C# rules lack. Identifiers are split into words (`LeaveApprovalService` → leave, approval, service).
  - **Cache:** in the OS temp folder, keyed by repo path + `git rev-parse HEAD` + file count, never inside the repo. Rebuilt when the key changes. A rebuild under 2 s is also acceptable without cache.
  - **Query:** for each query, score each file on words matched in its path (weight 2) and in its symbol words (weight 1, max 3 per word), like codemap's "path and function names" score. Return the top 30 per query in the same hit shape as `codemapFind`, so cleanup, rules and output stay unchanged.
  - **Failure:** ast-grep missing or failing → path-only index, stated in coverage. Timeout 15 s → `fallback` engine, labelled.
- **Order:** the rules order (round-2 behaviour) for every engine. `--order codemap` keeps the round-3 order available. The default is decided by the result of this run (section "Success criteria").
- **Jev:** not called (`--provider none`). The code stays behind `--provider jev`; its "none_of_these" signal is a separate idea, out of scope.
- **`auto` engine:** stays `codemap` until this run passes. It then becomes `symindex`, with codemap as the labelled fallback.

## Evaluation (offline only, no agents)
| Set | Tasks | Source |
|---|---|---|
| ess-be r3 | 12 units (8 filtered) | same units, task texts and gold as round 3 (`D:/cte-r3`) |
| **ess-be held-out** | 8 new units: PR 1848 `2491fcc6`, PR 2130 `e9ab25f4`, PR 5205 `b7f9fcac`, `59ac4b72`, `a7e5cd81`, `c5e0101f`, `f45e785f`, `ef5a3882` | same builder: gold = modified non-test `.cs` at the parent; task text by a Haiku agent from subject/body only; leak check |
| Laya | 11 tasks: `eval/tasks.json` (5) + `20261018-cte-r2-agent-01/tasks-new.json` (6) | existing gold |

Compared on every set, same task texts, K = 8 (Laya also K = 5, as before):

| Arm | Engine | Order |
|---|---|---|
| C-cm | codemap | codemap order |
| C-rules | codemap | rules |
| **S-rules** | symindex | rules |
| S-cm (info) | symindex | codemap-style order |
| rg (reference) | rg on task words | — |

The held-out units are new for the engine and for the rules-vs-codemap-order choice. The r3 units are in-sample for that choice, because rules were preferred after seeing them.

## Success criteria (fixed before any data)
| Metric | Target | Guardrail |
|---|---|---|
| Latency per call, symindex (index from cache) | p50 < 2 s, max < 5 s | the first build per repo is reported separately and must be < 30 s |
| Recall@8, S-rules vs C-rules | ≥ C-rules − 0.05 on **each** of the three sets | Hit@8 lower than C-rules by at most 1 task per set |
| Recall@8, S-rules vs rg | ≥ rg + 0.15 on ess-be held-out | — |
| Default order | the order with the higher Recall@8 on held-out + Laya pooled (16 tasks after the hardness filter); ties → rules | reported per set; no claim beyond "directional" |
| Tests | engine unit tests (tokenizer, scoring, cache key, ast-grep missing/failing, timeout → fallback, hit shape), 0 failures | old tests still pass |

**Pass** = latency and recall rows hold on all three sets. Then the next round is the agent A/B on ess-be hard tasks (plain Claude vs Claude + explorer with symindex), with its own design. **Fail** = report where symindex loses (per-unit recall vs codemap) and stop.

## Privacy
ess-be task texts, gold, snapshots and outputs stay in `D:/cte-r3/` and `D:/cte-r4/`. The Laya repo gets scripts and `*.json` with ids and numbers only. No data leaves the machine: no Jev, no network.

## Alternatives
| Option | Verdict |
|---|---|
| Keep codemap, accept 15-25 s | still possible; this run tells whether it is needed |
| codemap index reuse (`--setup-root`) | the flag reuses `.codemap` state, but `find` timing did not change with `--watch`; one 5-minute check is in the spike, not a separate arm |
| ctags instead of ast-grep | not installed; ast-grep is already on the machine and has codemap's rules |
| Jev rerank | rejected for now: no gain over rules (`pool-result.md`) |

## Risks
| Risk | Mitigation |
|---|---|
| symindex misses what codemap finds through its own scoring details | per-unit recall vs codemap reported; the failure mode is checked on the units where codemap hits and symindex misses |
| Scoring weights tuned on the r3 units | weights fixed in this brief (2 / 1 / max 3); held-out set decides |
| Other languages (Laya is .mjs/.py) | the same codemap rule files cover js/ts/python; Laya set checks it |
| Cache staleness | key includes HEAD and file count; the test changes a file and expects a rebuild |

## Recommendation
`PROCEED`. It is cheap (ast-grep is installed, the spike took 0.47 s) and offline only. It answers the latency question directly and settles the default order on held-out data.

## Human decision
- **Decision:** APPROVED
- **Approved scope / changes:** as written (symindex engine, rules order, no Jev, offline on ess-be r3 + held-out + Laya)
- **Decision date:** 2026-10-18
- **Notes:** ess-be data stays local.
