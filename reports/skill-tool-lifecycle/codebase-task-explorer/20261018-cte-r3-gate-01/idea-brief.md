# Idea Brief — codebase-task-explorer round 3: fast codemap, harder tasks on ess-be, ck and aider-repomap as gate candidates

- **Experiment ID:** `20261018-cte-r3-gate-01`
- **Track:** E (existing tool). Steps 1-3 are `N/A (existing tool)` except the two approved code changes below.
- **Status:** `APPROVED_FOR_IMPLEMENTATION` (Gate A 2026-10-18)
- **Owner:** user (XionTechs / Laya)
- **Date:** 2026-10-18
- **Baseline runs:** `20261017-cte-agent-01`, `20261017-cte-agent-02`, `20261018-cte-r2-agent-01` (codemap + Jev), `20261018-cte-codegraph-01`, `-02` (codegraph, gate failed). Applies suggestions 1, 2 and 3 of `20261018-cte-r2-agent-01/improvements.md`.

## Question this run answers
Can any retrieval engine (codemap, ck, aider-repomap) beat grep on tasks hard enough to need help, fast enough not to cost turns? The test repo is `ess-be` (C#), the user's own backend. Only an engine that passes the offline gate goes to an agent A/B run.

## What the earlier runs showed
| Finding | Evidence |
|---|---|
| The tasks were too easy | Plain Haiku found the gold file with its own grep in 23 of 24 runs (r2) |
| codemap is the best engine measured so far | Recall@8: codemap rules 0.704, codegraph 0.519, merged 0.648 (codegraph-01/-02 gates) |
| Jev added cost without changing the answer | r2: +43% tokens, Jev never changed a useful #1 |
| The extra tokens came from waiting | codemap `find` ~5 s per query, run one after another; under load 100-300 s, 18/24 calls hit the 120 s Bash timeout |
| The Laya repo is a poor test bed | Many same-named copies (laya/jev variants, several `build_report.mjs`) mislead every name-based engine |

## Hypothesis
If codemap runs its queries in parallel with no Jev by default (p50 < 5 s), and the tasks come from a repo where grep on the task words does not find the answer, then the helper (or a better engine: ck semantic/hybrid, aider-repomap PageRank) gets the gold files into its top 8 more often than grep, and a later agent A/B can show fewer turns to the first gold file.

## Proposed changes
### 1. codemap fixes (from r2 improvements, approved by the user 2026-10-18)
- `scripts/explore.mjs`: default `--provider none`. With no provider the output is ranked by codemap's own order, not the rules score. Jev stays behind `--provider jev`; the gate code stays as it is.
- `codemapFind()`/`run()`: run the queries with async `spawn` + `Promise.all`, at most 4 at a time, hits kept in query order, one `.codemap/` index for all queries.
- Tests: the default is provider none; parallel order equals serial order on a fake; a timeout still returns the finished queries.

### 2. A new held-out task set on ess-be
- **Repo:** `ess-be` (XionTechs ESS backend, Azure DevOps, private), local clone `D:/XionTechs/ess-be`, pinned at the commit before the oldest PR used. About 2,000 tracked files, 1,057 `.cs`; 54 merged PRs with bug/task ids (e.g. `fix(attendance): BUG-19358 ...`). Chosen by the user at Gate A (2026-10-18) over the proposed `fastify/fastify`.
- **Tasks:** 8 tasks from real merged `fix`/`feat` PRs (skip `chore`/`ci`/docs). The task text is the PR title and description reworded in plain words, without file, class or method names. Gold = the non-test `.cs` files the PR changed (`git diff --name-only <merge>^1 <merge>`). Gold is written down before any engine runs, by a script, not by hand. Each task runs on the repo at its PR's parent commit, so the fix is not yet in the code.
- **Hardness filter (neutral, not one of the candidates):** keep a task only if `rg` on the task words does not put a gold file in its top 3 files. At most 1 easy control task.
- **Agent-run filter (only if the gate passes):** a 1-agent arm-A pilot of each task must take at least 6 turns.
- The answer keys stay out of the agents' copy of the repo (a `git archive` of the parent commit, no `.git`, so `git log` cannot reveal the fix).

### 3. Offline gate with two more candidates (no agent spend)
| Candidate | What it adds | Install (Windows) |
|---|---|---|
| codemap (fixed, provider none) | baseline engine | already used |
| [ck](https://docs.rs/crate/ck-search/latest) (BeaconBay, MIT/Apache) | semantic and hybrid BM25 search, embeddings local | release binary if one exists for Windows, else `cargo install ck-search` (no Rust on this machine yet) |
| aider repo-map ([RepoMapper](https://github.com/Cryect/RepoMapper) CLI, or `aider --show-repo-map`) | tree-sitter + PageRank, ranks central files for the task's identifiers | `uv tool install`; license checked in the spike |
| `rg` on task words | the grep a plain agent does | reference |

Each candidate runs through a small adapter in `eval/run-gate.mjs` that prints up to 8 paths. The adapters live in the gate only; none of them is added to `explore.mjs` in this run.

## Jev / Laya role
- **Provider:** `none`. **Mode:** not used.
- Three runs showed Jev changed no useful #1. It is not part of this run.
- **Fallback:** an engine that is missing, fails to index or takes over 30 s for a task is reported as `failed` for that task (counts as a miss), never left out.
- **Privacy:** all local. ck's embedding model is downloaded once (to `HF_HOME=E:\hf-cache` if it uses Hugging Face). Telemetry off where a tool has it. Nothing is installed into Laya's `.claude/` or `CLAUDE.md`; aider's own setup or config writes are not run.

## Alternatives considered
| Alternative | Verdict |
|---|---|
| Keep testing on Laya's own tasks | reject: grep already wins there (23/24) |
| codegraph again | reject: failed two gates |
| Serena (LSP references, MIT) | later: it is an MCP server, harder to keep away from arm A; try only if a call-graph task fails all three candidates |
| GitNexus | reject: non-commercial license |
| Jev rerank | out of scope |

## Success criteria (fixed before any data)
| Metric | Baseline | Gate target | Guardrail |
|---|---:|---:|---|
| Recall@8 mean on the 8 new tasks | `rg` on task words (measured first, same run) | best engine ≥ `rg` + 0.15 | an engine below `rg` is dropped |
| Latency per task, p50 / max | codemap ~5 s per query, serial | < 5 s / < 15 s | an engine above 15 s typical is dropped |
| codemap fix | serial | parallel output identical to serial | no recall loss on `eval/tasks.json` |
| Index time per repo | — | reported | > 10 min reported as a cost, not a fail |
| Agent A/B (only for the gate winner, later step) | plain Claude A | turns to first gold file B ≤ A − 20%, paired tokens B ≤ A + 5% | no case worse |

If no engine beats `rg` by 0.15, stop. The finding is then: on hard tasks, a helper does not beat grep. Recommend `DROP` or `INSUFFICIENT_EVIDENCE` without spending on agents.

## Scope and non-goals
- **In scope:** the two codemap fixes and their tests; the task-set builder script (PR → task text + gold); gate adapters for ck and aider-repomap; one gate run; `gate-result.md`. If the gate passes: an agent A/B run of the winner, 8 tasks × 2 reps, Haiku 5.5 xhigh, `haiku-case` agents, at most 4 at a time, on an unloaded machine.
- **Out of scope:** Jev; adding ck or repomap to `explore.mjs` (only after they win the gate); Serena; adoption.

## Risks and mitigations
| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| ck has no Windows binary and needs Rust | medium / blocks one candidate | spike first; if the install takes over 30 min, mark ck `not run` with the reason and keep the gate for the other engines |
| aider pulls in a heavy Python stack | medium / slow setup | prefer RepoMapper; install into its own `uv` tool environment |
| Task text leaks the answer, or the filter makes it unfair | medium | text has no file/symbol names; the filter uses `rg`, not a candidate; the task builder script and filter output are saved |
| Gold from a PR includes unrelated files (renames, formatting) | low-medium | keep the files the PR changed in logic; drop lockfiles, docs, tests; rule written in the builder script |
| 8 tasks is small | high / directional only | say so in the result; no tuning on these tasks |
| ess-be is private and Laya's GitHub repo is public | high / leak | task texts, gold paths, engine outputs, transcripts and answers stay outside the Laya repo in `D:/cte-r3/` (not committed); Laya gets only scripts and numbers (Recall, latency, tokens) with task ids like `e1`..`e8`; reports show no ess-be paths or code |
| C# support differs by engine | medium | the spike indexes ess-be with each engine and reports the share of `.cs` files it covers; an engine below 90% is reported as such |
| 150 duplicate file names in ess-be (per-module classes) | medium | measured, not filtered: it is the real repo |

## Recommendation
`PROCEED`. Do the cheap parts first: codemap fixes, task builder, spike to install ck and repomap, then one gate run. Spend on agents only if an engine clearly beats `rg` on the hard tasks.

## Human decision
- **Decision:** APPROVED, with the repo changed to ess-be
- **Approved scope / changes:** as written, test repo `ess-be` instead of `fastify/fastify` (user: "xài ess-be đi")
- **Decision date:** 2026-10-18
- **Notes:** ess-be data stays local (public Laya repo).
