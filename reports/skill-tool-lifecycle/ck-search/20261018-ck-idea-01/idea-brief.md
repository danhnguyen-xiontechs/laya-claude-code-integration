# Idea Brief — ck-search (semantic code search with ck)

- **Experiment ID:** `20261018-ck-idea-01`
- **Status:** `APPROVED` (Gate A, 2026-10-18: option 3, standalone skill)
- **Owner:** Laya Retro (user), drafted by Claude
- **Date:** 2026-10-18
- **Track:** N (new idea). Planning: one Opus call, closed input pack.
- **Related code/report:** `reports/skill-tool-lifecycle/codebase-task-explorer/20261018-cte-r3-gate-01/gate-result.md` (ck numbers below come from there); ck 0.8.1 (BeaconBay/ck, Apache-2.0/MIT), binary at `C:\Users\ADMIN\tools\ck\ck.exe`, sha256 verified.

## Problem
When the user describes a task in plain words ("the leave approval email goes to the wrong manager"), the words often do not match any identifier in the code. `rg` on the task words then misses, and Claude spends several turns grepping. A semantic index could find code "by meaning".

## Current baseline
Offline gate 20261018-cte-r3-gate-01, private C# repo, 12 units from real fix/feat changes, 8 "hard" (no gold in `rg` top 3), K = 8, gold = modified non-test `.cs` files:

| Engine | Recall@8 hard (8) | Recall@8 all (12) | p50 latency |
|---|---:|---:|---:|
| rg on task words | 0.12 | 0.36 | 0.8 s |
| codemap (codebase-task-explorer) | 0.41 | 0.50 | 15.8 s |
| **ck hybrid (bge-small)** | **0.00** | **0.00** | 1.0 s |
| ck semantic | 0.00 | 0.00 | 0.4 s |
| aider repo-map | 0.03 | 0.02 | 2.6 s |

- ck's top 8 were `AGENTS.md`, `CLAUDE.md` and `docs/*.md` chunks: the docs describe features in plain words, so they match the task text better than C# does.
- ck `--jsonl` prints absolute `\\?\D:\…` paths, and `--topk` counts chunks, not files (~400 chunks needed for 8 distinct files).
- Index: 107-151 s per ~2.8k-file repo on CPU (bge-small), 10-46 s on small repos. Not yet known: how far down the 400 chunks the gold `.cs` files appear.

## Hypothesis
If ck's results are restricted to code files, and the doc chunks it finds are used as a bridge (doc → identifiers it names → code files), then hard-task Recall@8 rises above codemap alone, at ck's latency (≈1 s) instead of codemap's 15.8 s.

## Purpose: three options

| Option | What it does | Evidence today | Pick |
|---|---|---|---|
| **1. Docs-bridge lane inside codebase-task-explorer** (purposes "docs + code" and "semantic fallback") | ck hybrid → keep code files; doc chunks → extract CamelCase/identifiers → `--lex`/rg on code → RRF fuse with codemap | the only option the data supports: ck *does* find the right docs | **recommended** |
| 2. Code-only semantic fallback in the explorer | ck hybrid, post-filter to code files only | none yet (0.00 in top 8) | cheaper sub-variant of 1, tested first |
| 3. Standalone `/ck-search` skill, "find code by meaning" | user calls it directly | weakest: its engine scored 0.00, and it competes with the explorer and skills-router for the same requests | later, only if 1 passes the agent run |

**Separate skill or engine?** Recommendation: an **engine (lane) inside codebase-task-explorer**, off by default (`--engine ck`). It reuses the explorer's multi-query, ranking, optional Jev batch ranking and discovery-only handoff, and adds no new trigger for skills-router to arbitrate. Note: the request was for a *new skill*; option 3 keeps that shape, at the cost above. Gate A picks.

Neighbour skills reused: `codebase-task-explorer` (host of the lane, its gate script and units), `skills-router` (check that a later `/ck-search` trigger does not collide).

## How to stop docs crowding out code (test in this order)
1. **Post-filter to code** (`--jsonl --topk 400`, `\\?\` → repo-relative, keep code extensions, 8 distinct files). No reindex; cheapest.
2. **Two-pass docs-bridge**: top doc chunks → identifiers → code-only lexical search → RRF. Rules, no model.
3. **`jina-code` model** (`--switch-model`, another ~150 s+ reindex per repo), only if 1-2 fail.
4. `.ckignore` on `*.md`: same effect as 1 but needs a reindex and throws away the bridge signal; dropped.

**In-sample warning:** any choice tuned on the 12 ess-be units is in-sample. Those 12 are dev data only. The decision runs on a **new held-out set**: ≥ 15 units (≥ 8 hard) from a later commit range of ess-be and/or another repo, same rules (K = 8, gold = modified non-test code files), one shot per variant, criteria frozen before it is built. Private unit texts, paths and outputs stay outside the Laya repo (`D:/cte-r3`-style folder); only ids and numbers are committed.

## Proposed intervention
- **Kind:** `helper` (engine lane inside a skill); `skill` if option 3 is chosen.
- **Smallest useful implementation:** one script `ck_lane` — check ck exists and the index is fresh; run hybrid `--jsonl --topk 400`; normalise and filter paths; docs-bridge pass; output ranked repo-relative files with the chunk that justified each. A `--engine ck` flag in the explorer (off by default), the gate script, a README section.
- **What Claude remains authoritative for:** which files to open, the investigation, the handoff.
- **What the tool can decide:** the candidate file list and its order (advisory only).

## JEV/Laya role
- **Provider:** `none` (filtering, identifier extraction, RRF are rules). The lane's candidates may flow into the explorer's existing optional Jev ranking unchanged; no new model call.
- **Mode:** advisory.
- **Fallback:** ck missing, index absent or query timeout → skip the lane with a one-line note; the explorer behaves exactly as today.
- **Data/network/privacy:** embeddings run locally (`HF_HOME=E:\hf-cache`); no network after the one-time model download (to be checked mechanically in the gate). ck writes `.ck/` and `.ckignore` into the target repo: add both to `.git/info/exclude` (local only), and check `git status` before handoff. No private repo text in the public Laya repo.

## Alternatives considered
| Alternative | Expected benefit | Cost/risk | Why choose or reject |
|---|---|---|---|
| Do nothing (codemap only) | 0.41 hard recall already | 15.8 s p50 | baseline arm |
| Rules only (fast path+symbol index, gate-result option 1) | codemap's signal in < 1 s | separate work, already proposed | complementary, not a replacement |
| Plain Claude grepping | no setup | many turns on hard tasks | arm A |
| ck lane, rules only (this) | meaning-based recall, ~1 s | index 2-3 min per repo; may still be 0 | recommended, gated first |
| ck lane + Jev ranking | maybe better order | quota, latency | only through the explorer's existing Jev step |

## Success criteria (frozen now, before any held-out data)
| Metric | Baseline | Target / threshold | Guardrail |
|---|---:|---:|---|
| **Offline gate, held-out set** — hard Recall@8 | codemap alone (measured on the held-out set) | codemap + ck lane ≥ codemap + 0.15, **or** ck lane alone ≥ 0.41 | all-unit Recall@8 not more than 0.05 below codemap |
| ck latency / index | — | query p50 ≤ 2 s, max ≤ 6 s; index ≤ 180 s per ~3k-file repo | — |
| Hygiene | — | 0 doc files in the final code list, 0 absolute paths, 0 network calls after model download | borderline = fail |
| **Agent A/B** (only if the gate passes): ≥ 10 tasks × 2 reps, explorer with vs without lane | explorer without lane | first gold file in handoff top 5 ≥ +20 points | tokens and wall time ≤ +15%; no case worse; 0 runs leave `.ck/`/`.ckignore` committable |

The offline gate (cheap, no agents) runs first; the agent run starts only if it passes.

## Scope and non-goals
- In scope: the `ck_lane` helper, the explorer flag, the held-out unit set builder, the offline gate, then (if passed) the agent A/B.
- Out of scope: `ck --serve` MCP, several models (bge-small; jina-code only if needed), `--rerank`, any hosted API, fixing code, a standalone skill before the A/B passes. This session does not touch `.claude/skills/codebase-task-explorer` or its reports.

## Risks and mitigations
| Risk | Likelihood/impact | Mitigation and test |
|---|---|---|
| Overfitting to the 12 dev units | high / high | held-out set, criteria frozen here, one shot per variant |
| ck still 0 after filtering (gold not in 400 chunks) | medium / high | first measure gold rank in the 400 chunks on dev units; if absent, try jina-code or drop |
| Index cost / stale index | medium / medium | build on first use, reuse while HEAD is unchanged, skip lane if missing |
| `.ck/`/`.ckignore` committed, private data leaked into public repo | low / high | `.git/info/exclude`, pre-handoff `git status` check, only public fixtures committed |
| `\\?\` paths, chunk-vs-file `--topk` | known / medium | normalise + dedupe, unit test each |
| Small sample, noisy result | high / medium | per-unit hits reported, margin required, borderline = fail |

## Recommendation
`PROCEED` with option 1 (docs-bridge lane inside codebase-task-explorer, rules only, off by default), offline gate on a new held-out set first. If the gate fails, `DROP` ck for this purpose.

## Human decision
- **Decision:** `APPROVED`: option 3, standalone `/ck-search` skill (not the recommended explorer lane).
- **Approved scope / changes:** a separate skill wrapping ck, with the docs-crowding fixes in the order above (code-only post-filter, then docs-bridge, then jina-code) inside the skill. Offline gate criterion that applies: `/ck-search` alone hard Recall@8 ≥ 0.41 on the new held-out set, plus the latency and hygiene rows. Agent A/B: plain Claude vs Claude + `/ck-search`. Its description must not collide with codebase-task-explorer or skills-router triggers.
- **Decision date:** 2026-10-18
- **Notes:** chosen by the user via AskUserQuestion; next is step 2 (design.md) in a later session.
