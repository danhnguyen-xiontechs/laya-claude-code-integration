# Phase 0 — Claude Code token audit: summary

Generated 2026-10-05T22:13 by `audit/audit.py` (passive, no LLM calls). Source: `~/.claude/projects/**/*.jsonl` incl. subagent transcripts.

**Labels used below:** **[M]** measured from transcript `usage` fields · **[E]** estimated (tool-result size = chars/4) · **[H]** heuristic (rule-based, not ground truth) · **[A]** assumption.

Cost = **API-equivalent normalized cost** using `audit/pricing.json` (list prices). It is *not* Claude subscription/quota usage: quota is not exposed in transcripts and is not priced this way.

## Dataset

| Category | Sessions | API-equiv. cost |
|---|---:|---:|
| excluded | 6 | $13.63 |
| normal | 12 | $295.44 |
| uncertain | 6 | $66.41 |

Primary aggregates use **normal** sessions only (12 sessions, 143 human prompts, 1389 main + 1390 subagent API requests). Excluded = Laya research project (routing/workflow experiments, this audit). Uncertain = worktree copies, empty or prompt-less sessions. See `sessions.csv` `category`.

> Sample is small and dominated by a few long sessions. Treat shares as indicative, not population estimates.

## A. Where do the tokens go? [M]

| Component | Tokens | Share of tokens |
|---|---:|---:|
| cache read | 673,703,353 | 97.3% |
| cache creation | 16,117,537 | 2.3% |
| uncached input | 18,413 | 0.0% |
| output (incl. thinking) | 2,642,908 | 0.4% |

Cache writes by TTL: 5m 7,990,502 · 1h 8,127,035.

## B. Where does the cost go? [M × A-pricing]

| Component | Cost | Share |
|---|---:|---:|
| cache read | $143.42 | 48.5% |
| cache write | $104.94 | 35.5% |
| uncached input | $0.04 | 0.0% |
| output | $47.04 | 15.9% |
| **total** | **$295.44** | |

Main thread $162.18 (54.9%) · subagents $133.26 (45.1%).

By model: claude-sonnet-5-5 $104.84 (35.5%), claude-fable-5-1 $77.53 (26.2%), claude-opus-5-5 $48.43 (16.4%), claude-sonnet-5 $45.08 (15.3%), claude-opus-5 $19.18 (6.5%), claude-haiku-4-5-20251001 $0.37 (0.1%)

**Pricing validation.** Claude Code writes a `cost-state` record with its own `costUSD` and token totals (for the *last process run* of a session only, so it cannot validate whole-session totals). Recomputing those token totals with `pricing.json`:

| Session | Model | Claude Code costUSD | ours, writes@5m | ours, writes@1h |
|---|---|---:|---:|---:|
| 98b521ce | claude-opus-5[1m] | 0.5526 | 0.4367 | 0.5526 |
| a3ed186f | claude-opus-5-5 | 3.9981 | 3.0165 | 3.9981 |
| bdc32f51 | claude-opus-5-5 | 0.3149 | 0.2029 | 0.3149 |
| d8762e6e | claude-haiku-4-5-20251001 | 0.0010 | 0.0010 | 0.0010 |
| 28616904 | claude-opus-5-5 | 1.8957 | 1.6173 | 1.8957 |

One of the two columns should match Claude Code's figure (it depends on the TTL used). A match confirms the unit prices including the cache-write multiplier.

## C. Cache rebuilds / expiry

Explicit expiry metadata (`prompt_cache_likely_expired`, `seconds_since_last_response`, …) found in transcripts: **0 records**. This Claude Code version does not persist it, so expiry is inferred **[H]**: a request with cache_creation ≥ 20,000 tokens whose gap to the previous request exceeds the TTL actually used (1h if 1h writes were seen in the stream, else 5m; TTL is **[M]** from `cache_creation.ephemeral_*`).

| Cause [H] | Events | Tokens written | Write cost | Excess vs. reading from cache |
|---|---:|---:|---:|---:|
| likely-expiry | 17 | 3,689,461 | $30.42 | $29.60 |
| session-start | 38 | 1,663,921 | $10.75 | $10.36 |
| growth | 42 | 1,085,458 | $7.60 | $7.36 |
| prefix-invalidated | 11 | 1,502,728 | $7.44 | $7.13 |
| model-switch | 4 | 814,783 | $4.89 | $4.73 |
| compaction | 1 | 32,224 | $0.13 | $0.12 |

Likely expiry: 17 events; context at rebuild median 242,254 (max 440,081); gap median 330 min. Excess cost $29.60 = **10.0% of total cost**.

All cache writes cost $104.94 (35.5%). 'growth' is normal append-only caching; only expiry / prefix-invalidated / model-switch writes are avoidable waste.

## D. Topic switching [H]

131 prompts arrived when the main context was ≥ 30,000 tokens; 39 have rule_score ≥ 0.6 (low word overlap with the previous 3 prompts, long gap, or switch keywords). These are **candidates, not ground truth**. `topic-switches.csv` lists the top 50 for human labeling.

Flagged candidates: context before switch median 236,125, max 486,189; carried cache-read cost after them (upper bound if /clear had been used, ignores re-reading files): $203.01 (overlapping, not additive across candidates in one session).

**Labels loaded** (50, source: {'claude-draft': 50}): {'SAME_TASK': 42, 'NEW_TASK': 2, 'UNCLEAR': 6}. Ceiling over NEW_TASK labels: $7.03 (2.4%). Rule baseline at score ≥ 0.6: TP 2, FP 27, FN 0.

## E. Tool output [E]

Tool results total ≈ 2,735,663 tokens when first returned [E]. Each one is then re-sent on every later request until compaction. Estimated carry cost ≈ $44.85 (15.2% of total) [E].

| Kind | Events | Est. tokens | Share | >4k-token outputs | Est. carry cost |
|---|---:|---:|---:|---:|---:|
| Read:code | 1013 | 1,455,054 | 53.2% | 24 | $21.18 |
| Read:doc | 126 | 383,343 | 14.0% | 22 | $6.43 |
| Bash:search | 537 | 270,131 | 9.9% | 11 | $5.19 |
| Bash:other | 280 | 181,620 | 6.6% | 9 | $4.22 |
| Bash:log | 360 | 140,725 | 5.1% | 6 | $3.03 |
| PowerShell:other | 320 | 74,334 | 2.7% | 0 | $0.96 |
| Agent | 30 | 20,792 | 0.8% | 1 | $0.79 |
| Bash:test | 164 | 39,883 | 1.5% | 0 | $0.69 |
| Bash:git | 72 | 40,657 | 1.5% | 1 | $0.55 |
| Write | 429 | 19,444 | 0.7% | 0 | $0.38 |
| Grep | 80 | 21,045 | 0.8% | 0 | $0.27 |
| Edit | 297 | 11,967 | 0.4% | 0 | $0.26 |
| ExitPlanMode | 5 | 6,358 | 0.2% | 0 | $0.21 |
| WebSearch | 32 | 21,054 | 0.8% | 0 | $0.15 |

Largest single outputs:

| Session | Kind | Est. tokens | Later requests | Input |
|---|---|---:|---:|---|
| 800b26b5 | Read:code | 17,460 | 13 | `/d/XionTechs/ess-be/src/Ess-App.Application/Services/LeaveRequests/Lea` |
| 800b26b5 | Read:code | 16,439 | 15 | `D:\XionTechs\ess-be\src\Ess-App.Application\Services\LeaveRequests\Lea` |
| 94be98a9 | Read:doc | 14,743 | 179 | `D:\XionTechs\XionTechs_Act01\.claude\worktrees\c1-v2\docs\concepts\com` |
| 94be98a9 | Read:doc | 14,743 | 3 | `D:\XionTechs\XionTechs_Act01\.claude\worktrees\c1-v2\docs\concepts\com` |
| 4a2b31f6 | Read:doc | 14,717 | 8 | `/d/XionTechs/ess-be/docs/d365-calls/PERFORMANCE.md` |
| 4a2b31f6 | Read:doc | 14,717 | 9 | `D:\XionTechs\ess-be\docs\d365-calls\PERFORMANCE.md` |
| 3ff0c65e | Read:doc | 14,267 | 60 | `C:\Users\ADMIN\.claude\projects\D--XionTechs-BMAD-METHOD\3ff0c65e-1a50` |
| 42e62356 | Read:doc | 13,759 | 10 | `C:\Users\ADMIN\.claude\projects\D--XionTechs-XionTechs-Act01\42e62356-` |
| 42e62356 | Read:doc | 13,396 | 3 | `C:\Users\ADMIN\.claude\projects\D--XionTechs-XionTechs-Act01\42e62356-` |
| 76de44cd | Read:code | 12,857 | 257 | `C:\Users\ADMIN\AppData\Local\Temp\claude\D--XionTechs-ess-be\76de44cd-` |

## F. Output / thinking [M]

Output tokens 2,642,908 (0.4% of tokens) but $47.04 (**15.9% of cost**). `usage.output_tokens_details.thinking_tokens` is present on 1,191 of 2,779 requests; where present, thinking = 495,864 tokens (18.8% of all output). Thinking is included in output_tokens. Where the field is missing it cannot be separated.

## G. Dead context [H]

Definition: on each request, tokens carried from before the most recent flagged topic switch (rule_score ≥ 0.6, not followed by compaction) are counted as dead. Priced at cache-read rate.

Estimated dead-context cost: **$46.24 (15.7% of total)** [H]. Example sessions (final context → estimated dead part):

- a3ed186f: context 525,899 → dead ≈ 486,189 (92.4%)
- 76de44cd: context 510,934 → dead ≈ 463,032 (90.6%)
- 9ec2d100: context 466,028 → dead ≈ 421,420 (90.4%)
- 28616904: context 334,712 → dead ≈ 331,907 (99.2%)
- 94be98a9: context 477,061 → dead ≈ 319,992 (67.1%)
- 42e62356: context 367,897 → dead ≈ 300,339 (81.6%)

This is a rough opportunity size. It becomes a measured number only after labeling (section D).

## H. Opportunity ceilings (upper bounds, not realized savings)

| Target | Ceiling | % of cost | Basis |
|---|---:|---:|---|
| Session continuity | $46.24 | 15.7% | [H] dead-context cost after flagged switches |
| Effort / thinking | $7.06 | 2.4% | [A] 30% less output on half of requests |
| Review gate | $16.60 | 5.6% | [M] cost of subagents whose type/description matches review|verify|audit|check |
| Tool output gate | $4.44 | 1.5% | [E] carry cost of tool-output tokens beyond 4,000/result |
| Documentation gate | $6.43 | 2.2% | [E] carry cost of Read on .md/.txt files |
| Cache expiry (not a Laya decision) | $36.73 | 12.4% | [H] excess write cost of likely-expiry + prefix-invalidated rebuilds |
| Subagent fan-out (not a Laya decision) | $133.26 | 45.1% | [M] total subagent cost in normal sessions |

Subagent cost by agent type: general-purpose $97.55, workflow-subagent $32.49, Explore $1.96, Plan $1.17, claude-code-guide $0.09

Recommendation and reasoning: see `recommendations.md`.
