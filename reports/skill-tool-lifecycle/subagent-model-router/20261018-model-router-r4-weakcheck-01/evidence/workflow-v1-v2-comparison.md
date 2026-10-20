# build-skill-tool-workflow: old (v1) vs token-saving version (v2)

Compares the workflow skill itself, not the tool it built. Both runs are Track E rounds of the same tool on 2026-10-18:

- **v1** (skill before `92cb466`): `subagent-model-router` round 3, `20261018-model-router-r3-agent-01`.
- **v2** (skill at `52f6583`, every token-saving change in): round 4, `20261018-model-router-r4-weakcheck-01`.

Real usage from the session transcripts (`transcript_usage.mjs`, subagents included), re-measured after every phase had ended. Cache read is the dominant cost term. All context numbers are per model call.

## 1. Round cost

| | v1 | v2 |
|---|---|---|
| Layout | 1 Haiku session does build, measure, report; driven from a shared control session | fresh Opus control + Haiku phase sessions P2, P3, P4 (P1 N/A, Track E) |
| Control | shared by ~13 rounds: 96.4M, peak 953k (≈ 7.4M per round, estimate) | own: 40 calls, peak 126k, **4.25M** |
| Workflow sessions (no case agents) | 63 calls, peak 248k, **10.26M** | P2 5.32M + P3 4.06M + P4 2.72M = **12.10M**, peak 174k |
| Case agents | 34 agents, 9.80M | 24 agents, 1.79M |
| **Round total** | **20.06M** (≈ 27.5M with the control share) | **18.15M** |

## 2. Change by change

| v2 change | Worked? | Evidence |
|---|---|---|
| `haiku-case` agent (short tool list, compacts at 98k) for case runs | **Yes, the biggest win** | Case agent starting context 57.2k → 17.6k (-69%) at the same 4-6 calls per agent; cache read per agent 288k → 75k (-74%). |
| Fresh, thin control session | **Yes** | 126k peak and 4.25M, against 953k shared (v1) and 25.0M in the first v2 round (context-governor). |
| One session per phase, fed by a capsule | **Peaks yes, total no** | Largest session 248k → 174k, median context per call 165k → 105-146k. But every fresh app session starts at **73k** (system prompt, skills, MCP tools) and re-reads it on every call: 73k × 98 calls ≈ 7.1M, **59%** of the 12.10M. So three sessions cost 18% more than v1's one. |
| Opus only for plan and review | **Yes, cheap** | The P4 review was one closed-pack Opus call (58k cache write) and found 6 issues (incl. a pricing error v1 shipped). The remaining Opus cost is the control session: 40 calls, 4.25M. |
| smart-context-trimming `enforce` in P2 | **Not active** | The P2 row says `enforce`, but the transcript has no trim marker; it cannot load in an app session. |
| context-governor | **No effect, and wrong** | It logged context 0.9M-5.5M (a whole turn's calls summed) and gave a false strong note on the first turn of each session. It checks once per user prompt, so an autonomous phase (one prompt, 30-40 calls) is never governed. |
| Round-cost measurement (`phase_usage.mjs`, report card) | **Broken this round** | The card shows 4.43M (2 of 4 phases). P2 `cwd` lost its backslashes, P3 `cwd` was a subfolder, and it ran before P4 ended (13 of 27 calls). |

## 3. What exactly changed, and where

The v2 changes landed between `2b36911` (last v1) and `52f6583` (`git diff --stat 2b36911 52f6583 -- .claude/`). Each row says what kind of thing it is, where it lives, whether round 4 used it and what it did to tokens.

| # | Change | Kind / file | Used in r4? | Token effect in r4 |
|---|---|---|---|---|
| 1 | **`haiku-case` agent**: Haiku 5.5, tool whitelist `Read, Grep, Glob, Bash, Write, Edit, Skill`, `autoCompactWindow: 98000` | subagent definition, `.claude/agents/haiku-case.md`; the skill tells P3 to spawn case agents with `subagent_type: "haiku-case"` (`SKILL.md` "Token budget"); `haiku-subagent/SKILL.md` points to it too | yes, all 24 case agents (`agentType: haiku-case` in their `.meta.json`) | v1 used `general-purpose`, which loads every tool definition (MCP servers included): 57.2k before the first word of the task. The whitelist cuts that to 17.6k. Every call re-reads it, so cache read per call fell 58k → 15.9k. **≈ -4.8M** on r4's 113 case-agent calls. The 98k compaction never fired (agents ended near 20k). |
| 2 | **Fewer case runs**: 4 cases × 2 reps by default, ≤ 4 agents in flight | rule in `SKILL.md` "Token budget" | yes: 6 × 2 arms × 2 reps = 24 runs (v1: 34) | Part of the remaining **≈ -3.2M** in case agents. That part also includes shorter cases, so it is not all workflow. |
| 3 | **Thin, fresh control session**: never reads more than ~50 lines, never builds or measures, reads 5-line hand-backs and single fields with `node -e` | rule in `SKILL.md` "Control-session rules" and "Starting a phase" | yes: 40 calls, peak 126k | 4.25M Opus. v1's control share was ≈ 7.4M per round (estimate, 96.4M over ~13 rounds), so **≈ -3.2M** against that. This saving is not in the -10% figure, because v1's control was outside its session. |
| 4 | **One fresh session per phase, fed by a capsule**: `capsule-P2/P3/P4.md`, ≤ ~3k tokens, no chat history | script `scripts/make_capsule.mjs` + phase guides `phases/phase-1..4-*.md`; control starts each phase with `start_session` (fresh, Haiku) | yes: capsules 3.4-4.5 KB (≈ 1k tokens each) | Peak 248k → 174k, and no session carries the whole history. But each fresh app session starts at 73k (system prompt, skill list, MCP tool names), so 3 phase sessions cost **+1.84M** (12.10M vs 10.26M). |
| 5 | **Opus at most 2 calls per round, closed pack** (no file reading, < 800 words) | rule in `SKILL.md` "Token budget"; `phases/phase-4-review-fix-report.md` | yes: 1 review call (P1 N/A in Track E) | 58k cache write, no cache read. v1 round 3 skipped the review, so there is nothing to compare against. In older v1 rounds the reviewer read files itself. |
| 6 | **Offline gate before any agent spend** | rule in `SKILL.md` + `design.md`; r4: `offline-gate.json` | yes, PASS (6 cases) | Saves only when it fails. Here it passed but missed that Haiku passes every case, so the 24 runs tested nothing. |
| 7 | **Quiet commands, batched turns, no polling**: one summary line per script, `git -q`, `\| tail -n 5`, launch a batch then end the turn | rule in `SKILL.md` "Quiet commands" | partly | Not measurable alone. |
| 8 | **smart-context-trimming** `enforce` in P2 / P4 fixes | plugin with a PostToolUse hook, `smart-context-trimming/` | **no**: it cannot load in an app session; P2's row says `enforce`, but no trim in the transcript | 0 |
| 9 | **context-governor**: soft note at 120k, strong at 200k, hand off with `make_capsule.mjs` | plugin with a `turn.complete` function hook, `context-governor/` (user scope) | loaded, but wrong | 0. It sums a whole turn's usage (0.9M-5.5M logged) and checks once per prompt. |
| 10 | **fast-compact**: verbatim `/compact` instead of a summary | plugin: skill + compact hook, `fast-compact/` | no (disabled at project scope, never armed in r4) | 0 |
| 11 | Round-cost measurement | scripts `phase_usage.mjs`, `transcript_usage.mjs`, `manifest.phases[]`, card in `build_tool_report.mjs` | yes, but broken (§2) | measures only; saves nothing |

**Why only -10%:** -4.8M (1, `haiku-case`) - 3.2M (2, fewer and shorter case runs) + 1.84M (4, three fresh 73k sessions) + 4.25M (3, control now counted inside the round) ≈ -1.9M = 20.06M → 18.15M. The case-agent saving is large, but most of it is paid back by the control session that v2 now owns and by the per-session start cost. Counting v1's control share as well, the round drops ≈ 27.5M → 18.15M.

## 4. Reading

- **v2 is cheaper per round: 18.15M vs 20.06M, about -10%, or about -34% counting v1's control share.** And v2 did more: a frozen design, an offline gate, an Opus review with fixes, and full reports. v1 round 3 skipped the review and `report.html`.
- **The saving comes from `haiku-case` and the fresh control, not from splitting into phases.** The phase sessions cost more than v1's single session because of the 73k fixed start.
- **Next levers, by size:**
  1. Cut the 73k start of phase sessions: no MCP servers that a phase does not use (chrome-devtools, claude-in-chrome, browser, docs), and a short skill list. 73k → 35k would save about 3.7M per round.
  2. Run the control session on Sonnet or Haiku. It only starts sessions, reads 5-line hand-backs and asks the user.
  3. Fix context-governor (per-call context from `$.session.usage()`, checked during the turn), so P2/P3 hand off before 150k.
  4. Fix `phase_usage.mjs` and the capsule row, so the report card is right without a manual re-measure.

## 5. How accurate each number is

| | v1 | v2 |
|---|---|---|
| Case agents (9.80M / 1.79M) | Measured from the agent transcripts. | Measured from the agent transcripts. |
| Phase sessions (P2–P4) | Not split: one session per round. | Measured after each phase had ended, with `transcript_usage.mjs`. The `phase_usage.mjs` card was wrong (wrong `cwd`), so its figure is not used. |
| Control session | **Estimate.** 96.4M shared over about 13 rounds, so about 7.4M per round. Not measured for this round. | Measured: 40 calls, 4.25M. |
| Round total | Excludes the control share, so it is not the whole round. | Includes the control share. |
| Same definition across versions? | **Not verified.** Assumed to match v2's token sum (input + output + cache read + cache write). | Same definition as the sums in §1. |
| Known gaps | Control share is a guess; the round window is not checked. | 73k per-session start is an estimate (system prompt, skills, MCP tools). The earlier card reported 4.43M before re-measuring, so the card figure is not used. |

**Net:** v2's numbers are measured, but the 73k start and the control share are estimates. v1's round total is measured for case agents only; its control share is a guess, so the −10% in §1 is a rough figure and can move by a few percent either way.
