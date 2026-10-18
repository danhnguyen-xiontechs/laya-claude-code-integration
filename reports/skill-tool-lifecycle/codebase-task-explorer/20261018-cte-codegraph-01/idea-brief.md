# Idea Brief — codebase-task-explorer on codegraph (replace codemap)

- **Experiment ID:** `20261018-cte-codegraph-01`
- **Status:** `WAITING_FOR_IDEA_APPROVAL` (Gate A)
- **Owner:** user (XionTechs / Laya)
- **Date:** 2026-10-18
- **Related:** `.claude/skills/codebase-task-explorer/` (codemap engine), runs `20261017-cte-agent-01`, `20261017-cte-agent-02`, `20261018-cte-r2-agent-01`; codegraph: [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) (npm `@colbymchenry/codegraph`, MIT)

## Problem
The tool should shorten the "where do I start" phase before a bug fix, refactor or feature. Today it calls `codemap find` once per query (lexical match over paths and symbols), ranks with rules and optionally Jev, and prints a top-N list. Three measurements say it does not help yet:

| Run | Pass A / B | Tokens B vs A | Main reason |
|---|---|---|---|
| 20261017-cte-agent-01 | 4/4 · 3/4 | +11% | same pool; ranking did not help, one case worse |
| 20261017-cte-agent-02 | 12/12 · 12/12 | +11% | Jev beats rules offline (Recall@5 4/5 vs 1/5), but agents find the file anyway |
| 20261018-cte-r2-agent-01 | 11/12 · 12/12 | +43% | helper took 100-300 s (18 of 24 calls hit the 120 s Bash timeout); agents waited and polled |

## Current baseline (plain Claude)
Haiku finds the gold file with its own grep/read in 23 of 24 runs on this repo. The tasks so far were "find the file that does X", which grep answers well. The helper only adds turns: waiting on a slow call, then re-checking its list.

## Hypothesis
A helper only pays when it gives what grep cannot give cheaply, and gives it fast. codegraph keeps a pre-computed symbol and call graph in local SQLite (FTS5): `query`, `callers`, `callees`, `impact` and `explore` answer from the index in about a second, and `callers`/`impact` answer "who depends on this" questions that take many grep/read turns. If the helper switches to codegraph and prints a short, verdict-first list with caller evidence, then on tasks that need the call graph (refactor impact, entry point of a flow, all call sites across files) Claude reaches the right files in fewer turns at no loss of correctness, and on plain "find the file" tasks it costs no more than plain Claude.

## Proposed intervention
- **Kind:** `skill`
- **Smallest useful implementation:** a new retrieval engine `codegraph` in `scripts/explore.mjs`, next to `codemap` and the fallback, selected with `--engine codegraph` (default once measured), using the codegraph CLI only (`codegraph query/explore/callers/impact --json` or text, whichever the CLI gives). Output: at most 8 rows, one line each (path, symbol, why, caller count), plus for refactor/impact mode the direct callers of the named symbol. No source bodies in the output.
- **What Claude remains authoritative for:** reading the source, verifying, and the final list of files. The helper is advisory.
- **What the tool decides:** which symbols/files to show and in what order (codegraph order plus caller count; no model).
- **codemap:** removed as the default engine and kept only as a labelled fallback until the new engine is adopted, then deleted (per the user: codemap was the wrong choice).

## Jev / Laya role
- **Provider:** `none` by default. Three runs showed Jev never changed a useful #1 against plain order; it stays behind `--provider jev` for a later experiment, not part of this one.
- **Failure/timeout/malformed output fallback:** codegraph missing or index absent → labelled fallback (`git ls-files` + `rg --hidden`), stated in the output; codegraph call over 10 s → stop and print what is ready.
- **Data/network/privacy:** codegraph is local; telemetry is turned off for every call (`CODEGRAPH_TELEMETRY=0` and `DO_NOT_TRACK=1`). `codegraph install` is never run (it would write MCP config, a section into `CLAUDE.md` and auto-allow permissions). Only `codegraph init`/index in the target repo; the `.codegraph/` folder stays untracked (gitignore entry, or index stored in scratch for experiments).

## Alternatives considered
| Alternative | Expected benefit | Cost/risk | Choose / reject |
|---|---|---|---|
| Existing workflow (codemap + rules + optional Jev) | none measured | +11% to +43% tokens | reject (user decision) |
| Plain Claude (no helper) | already 23/24 on find-the-file tasks | none | the A arm |
| **codegraph CLI, short output, rules-free, no Jev (recommended)** | fast answers; caller/impact evidence grep lacks | new dependency (MIT), index step, `.codegraph/` folder | **choose** |
| codegraph MCP `codegraph_explore` passed through as is | one call returns symbols, source and call paths | returns source bodies: long output, likely more tokens; MCP config would also reach arm A | reject for now |
| codegraph + Jev rerank | maybe better order | three runs say Jev adds cost, not answers | later, behind a flag |
| GitNexus | richer graph, semantic search | PolyForm Noncommercial license | reject (user decision) |

## Success criteria (fixed before any data)
| Metric | Baseline | Target | Guardrail |
|---|---:|---:|---|
| Offline gate (no agents): gold-group hit in the helper's top 8 on `eval/tasks.json` + the new tasks | codemap: 4/5 at Recall@5 with Jev, 1/5 rules | codegraph rules-free ≥ codemap rules-free | stop before the agent run if codegraph is worse |
| Helper latency p50 / max per call | 100-300 s under load (r2) | < 5 s / < 15 s | stop if > 15 s typical |
| Agent run, call-graph tasks: turns to final answer | A (plain) | B ≤ A − 20% | no case worse |
| Agent run, all tasks: paired tokens B vs A | +11% to +43% so far | B ≤ A + 5% | no case that passes in A fails in B |
| Pass rate | A ~92-100% | B ≥ A | — |

## Scope and non-goals
- **In scope:** the codegraph engine in `explore.mjs`, short output, tests (engine, timeout, missing index, fallback, telemetry env set, no write to `CLAUDE.md`/`.claude`), the experiment: offline gate, then 4 tasks × 2 repetitions with Haiku (effort high), at least 2 of the 4 needing the call graph (all callers of a function across files; the entry point that reaches a given handler; files affected by a signature change), the answer keys out of the agents' repo copy, arm A checked with `--forbid "codegraph|codebase-task-explorer"`; one Opus review with a closed input pack (quota-saving mode).
- **Out of scope:** the Jev path, the other 12 copies of `decision-provider.mjs`, MCP integration, adoption.

## Risks and mitigations
| Risk | Likelihood/impact | Mitigation and test |
|---|---|---|
| codegraph CLI flags or JSON output differ from the README | medium / blocks the engine | spike first: install it, index this repo, run each command, record the real output in the design before coding |
| Index time on Windows / large repo | medium / slow first run | index once per repo copy before the agents start; report index time |
| `.codegraph/` or the CLI visible to arm A | medium / contaminated A | arm A works on a copy without the index and without the CLI on PATH; `--forbid` check |
| Telemetry left on | low / data leaves the machine | env vars set inside the helper for every spawn; unit test asserts them |
| Call-graph tasks too easy again (grep finds all callers) | medium / null result | pick tasks with indirect or cross-module calls; 1-agent pilot of arm A must take ≥ 6 turns |
| Language coverage gaps (.mjs/.py/.cs mix in this repo) | low-medium | offline gate counts files codegraph indexes vs `git ls-files` |

## Recommendation
`PROCEED` with the recommended option: codegraph CLI engine, short rules-free output, no Jev, codemap kept only as a temporary fallback. It answers the user's request (drop codemap) and tests the only place a helper has a real chance to beat grep (call-graph questions), cheaply (offline gate before any agent spend).

## Human decision
- **Decision:** `APPROVED | REVISE | HOLD | REJECTED`
- **Approved scope / changes:**
- **Decision date:**
- **Notes:**
