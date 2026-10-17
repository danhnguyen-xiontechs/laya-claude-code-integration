# Idea Brief — codebase-task-explorer (retrospective measurement)

- **Experiment ID:** `20261017-cte-agent-01`
- **Status:** RETRO. The tool was built before this run (main @ `7849acd`). No Gate A decision is recorded here; `approvals.ideaApprovedAt` stays null.
- **Owner:** orchestrator; this run was delegated to a sub-agent
- **Date:** 2026-10-17
- **Related code:** `.claude/skills/codebase-task-explorer/` (`scripts/explore.mjs`, `scripts/decision-provider.mjs`, `tests/explore.test.mjs`, `eval/tasks.json`)

## Question this run answers

Does `codebase-task-explorer` help a Claude agent name the right starting files for a codebase task, compared with plain Claude that gets an unranked candidate list for the same queries? Does the Jev batch ranking add anything on top of the deterministic rules, and what does the whole thing cost in tokens?

## Problem

Before a bug fix or a feature, an agent has to find where to start. Lexical search returns many candidates, and reading the wrong ones costs turns and tokens. The tool is meant to shorten this discovery step. It stops at a handoff; it does not fix or implement.

## Current baseline (arm A)

Plain Claude gets the same retrieval as the tool, unranked: for each query, `git ls-files` path-token matches and `rg` content matches, in git order. It can still search and read files with its own tools. It does not get the tool's rules, Jev ranking, or none-of-these check.

## Hypothesis

If the tool ranks the same candidate pool (rules, then Jev batches), the five paths the agent names will hit more of the gold groups (Recall@5) than the unranked list does, at no higher token cost. With 4 tasks and 1 repetition this can only be directional.

## Proposed intervention (as built)

- **Kind:** `skill` (helper script plus SKILL.md)
- **Smallest useful implementation:** `explore.mjs`: retrieval (codemap if present, otherwise a labelled fallback of `git ls-files` path match plus `rg` content match) → cleanup (dedupe, drop vendor/build/binary) → rules score → capped pool of 96 → Jev choice batches of 24 plus `none_of_these`, top 4 kept per batch → one global rerank → rules order for the rest.
- **What Claude remains authoritative for:** choosing the final paths, reading the source, deciding whether a candidate is right.
- **What the tool can decide or change:** the order of a pool the tool has already built. It cannot add a file that is not in the pool, and it does not verify anything.

## JEV role

- **Provider:** `JEV` (`typesafe/jev-1.13` through the OpenRouter decisions API, key from `OPENROUTER_API_KEY`).
- **Mode:** advisory. It only orders the candidates; the rules order is the fallback.
- **Failure, timeout or malformed output:** a failed request, a missing key, a timeout (30 s per request), or a guard trip (6 calls, 24,000 chars per request) returns the rules order with `jev.fallback` set and the reason logged. Malformed-answer handling is a review question (see `agent-review.json`).
- **Data sent:** per SKILL.md, only paths, matched symbols, importer counts and the first header comment line of each candidate. No source bodies.

## Alternatives considered

| Alternative | Expected benefit | Cost/risk | Why choose or reject |
|---|---|---|---|
| Existing workflow (plain Claude, own search) | no added step | more search turns | Arm A here is the same unranked pool, so the ranking is isolated |
| Deterministic rules only | cheap, offline | no semantic choice among candidates | Diagnostic only: rules-only top five from `pool_check.mjs`, no agent run |
| Native Claude without the tool | no setup | none | Same as arm A |
| Candidate with JEV (as built) | better top-5 than unranked | API cost, latency, privacy of paths and headers | This is what is measured in arm B |

## Success criteria (fixed before the run)

| Metric | Expected | Target / decision threshold | Guardrail |
|---|---|---|---|
| Recall@5: fraction of gold groups hit by the agent's final five paths | A: unranked list | B > A on the 4 cases, directional | no case that passes in A may fail in B |
| Tokens per case (whole subagent session, all token kinds) | A baseline | sum of B ≤ sum of A (directional) | report the number even if worse |
| Jev fallbacks in arm B | 0 | 0 expected; any fallback reported | a fallback means the B result is rules-only for that case |

## Scope and non-goals

- **In scope:** retrieval, ranking, Jev batching and the agent's five-path answer on the first four gold tasks of `eval/tasks.json`; the tool's own unit tests; a code review of the scripts.
- **Out of scope:** the verification step, the fifth task, implementation, repeated runs, any adoption decision (Gate B belongs to the user).

## Risks and mitigations

| Risk | Likelihood/impact | Mitigation and test |
|---|---|---|
| Arms differ in retrieval (B: codemap; A: git ls-files + rg), so a gap may come from retrieval, not ranking | likely / confounds the comparison | `pool_check.mjs` reports the pool hit per arm |
| rg not on PATH | certain / arm A's content match and the tool's fallback need it | give both helpers the same ripgrep binary (VS Code's bundled rg) and say so |
| Tool's fallback content match does not work when rg is on PATH | verified / matters only without codemap | report as a finding; not an arm |
| Gold files named in ordinary code too | certain / answer-key leakage risk | scrub only answer-key artifacts (eval, tests, pilot report); document what stays |
| 4 tasks, 1 repetition | certain / noise | call the result directional; keep fractional recall |
| Jev answers differ between runs | likely / noise in arm B | record every Jev decision in the per-case logs |

## Recommendation

`RETRO`: measure as built, record the result and the findings. No change to the tool in this run.

## Human decision

- **Decision:** pending (Gate B, user)
- **Notes:** this retro does not set `ideaApprovedAt` and does not record a final decision.
