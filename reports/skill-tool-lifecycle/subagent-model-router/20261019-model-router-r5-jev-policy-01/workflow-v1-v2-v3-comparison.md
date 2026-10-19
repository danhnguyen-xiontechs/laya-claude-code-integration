# build-skill-tool-workflow: v1 vs v2 vs v3

Compares the workflow itself, not the tool. Each version ran `subagent-model-router` as a Track E round:

- **v1**: round 3, `20261018-model-router-r3-agent-01` (skill before `92cb466`).
- **v2**: round 4, `20261018-model-router-r4-weakcheck-01` (skill at `52f6583`, phase sessions + `haiku-case`).
- **v3**: round 5, `20261019-model-router-r5-jev-policy-01` (one control session, Haiku 5.5, no phase split).

Tokens are input + output + cache read + cache write, from session transcripts (`transcript_usage.mjs`, subagents included). Rounds differ in scope, so read this as a trend, not a controlled test.

## Numbers

| | v1 | v2 | v3 |
|---|---|---|---|
| Layout | 1 Haiku session, driven from a shared control | fresh Opus control + P2/P3/P4 Haiku sessions | 1 Haiku session does everything |
| Control session | shared by ~13 rounds, ≈ 7.4M per round (estimate), peak 953k | Opus, 40 calls, **4.25M**, peak 126k | Haiku, 66 calls, **4.81M**, peak 92k |
| Phase sessions | 10.26M (63 calls, peak 248k) | **12.10M** (P2 5.32M, P3 4.06M, P4 2.72M), peak 174k | not split (in control row) |
| Case agents | 34 agents, **9.80M** | 24 agents, **1.79M** | 18 subagents, **3.13M** (Haiku + Sonnet) |
| Case runs | 34 agents | 24 runs (6 cases × 2 arms × 2 reps) | 16 runs (4 paired cases × 2 arms × 2 reps) |
| **Round total** | 20.06M, **≈ 27.5M** with control share | **18.15M** | **7.94M** |
| Round total per case run | ≈ 0.59M (20.06M / 34) | ≈ 0.76M (18.15M / 24) | ≈ 0.50M (7.94M / 16) |
| Review | none (skipped) | 1 Opus closed-pack call, 6 issues | independent Opus subagent, 7 findings: 4 fixed, 1 caveat, 1 open (Minor), 1 noted |
| Tests | not recorded | not recorded | 38/38 (`node --test`) |
| Report | none | `report.html` | `report.html`, tests/review/cost tabs filled |
| Gate outcome | not compared | offline gate PASS, but Haiku passed every case, so 24 runs tested nothing | offline 6/6 (all checked, so Jev never ran); live 8/8 vs 8/8 **after escalation** (Haiku first try 6/8); ADOPTED, LOW confidence |

## Change

- **v2 vs v1: −10%** per round (18.15M vs 20.06M). The v1 figure excludes its control share, so the real drop is larger.
- **v3 vs v2: −56%** per round (7.94M vs 18.15M), and **−34%** per case run (0.50M vs 0.76M, both include control). Per run is the fairer number because v3 ran fewer runs.
- **v3 vs v1: −71%** per round against v1 with its estimated control share (≈27.5M). Not per-run comparable: v1's per-run figure excludes control.

## What the numbers say

- **v3 is the cheapest round by tokens (7.94M), but it is also the smallest.** It had 16 case runs against v2's 24 and no phase sessions, so the drop is mostly scope and the single-session layout, not a proven workflow win.
- **v2's fresh phase sessions cost more than they saved.** Each fresh session starts at ~73k (system prompt, skills, MCP tools) and re-reads it on every call. v3 dropped the phases and the per-session start cost with them.
- **Case agents in v3 cost more per run than in v2** (≈ 174k vs 75k per agent). The likely reason is the Sonnet escalations; the agent type was not checked, so do not read this as a `haiku-case` regression yet.
- **Control share is not comparable across versions.** v1 is an estimate, v2 is Opus, v3 is Haiku. Tokens are not dollars: cache read is priced per model, so a Haiku control costs less than the same tokens on Opus. The case-run cost in USD is in `evidence/cost.json` (v3: arm A $0.869, arm B $0.244), not the workflow cost.

## Still not measured

- v1 tests and gate outcome (not in the r3 record used here).
- Per-phase cost for v3 (one session, so one row).
- Opus review tokens in v3 (inside the control row, not split out).
- Dollar cost of the workflow sessions in any round.
