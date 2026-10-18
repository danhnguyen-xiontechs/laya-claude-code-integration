# Workflow v2 cost check: context-governor round vs 2026-10-18 v1 rounds

Real usage from transcripts (`transcript_usage.mjs` / `phase_usage.mjs`, subagents included). Cache read is the dominant cost term. Measured 2026-10-18.

## v2 round (context-governor, Track N: plan, build from scratch, gate, review, fixes)

| part | model | turns (sub) | peak context | cache read | cache write |
|---|---|---|---|---|---|
| P1 context pack (hc-probe) | Haiku | 44 (35) | 84k | 2.35M | 0.15M |
| P2 build (+5 headless smoke runs) | Haiku | 57 (0) | 167k | 6.47M | 0.17M |
| P3 replay gate | Haiku | 18 (0) | 108k | 1.65M | 0.05M |
| P4 Opus review | Haiku + 1 Opus subagent | 12 (1) | 119k | 1.00M | 0.11M |
| P4b fixes, re-frozen gate, reports (+1 headless) | Haiku | 65 (0) | 213k | 9.76M | 0.17M |
| **Phase sessions total** | | | **213k** | **21.25M** | **0.66M** |
| Control session slice (since Gate A, incl. the P1 Opus design call) | **Opus** | 130 (43) | **319k** | **25.04M** | 0.62M |
| **Round total** | | | | **46.3M** | 1.28M |

## v1 rounds on 2026-10-18 (one session per tool did build, measure and report; a re-measure round, no new build)

| session | turns (sub) | peak context | cache read |
|---|---|---|---|
| r2-model-router | 303 (208) | 275k | 30.08M |
| r2-skills-router | 190 (102) | 309k | 22.40M |
| r2-context-curator | 285 (219) | 242k | 29.54M |
| r3-model-router | 232 (169) | 248k | 20.06M |
| r3-acc | 186 (114) | 288k | 20.98M |
| r3-retry-loop | 56 (11) | 190k | 6.94M |

Each v1 round also shared the control session. On 2026-10-18 before Gate A, the control session spent 96.4M cache read at a peak context of 953k, spread over about 13 rounds and the reports.

## Reading

- **Phase sessions: about the same total, lower peaks.** 21.3M for a full new build against a median of about 21.7M for a v1 re-measure round. No single phase went above 213k, against 190-309k for v1 sessions.
- **The control session was not thin.** The v2 rule was not met, because the governor round was orchestrated from this already-long Opus session: 25.0M cache read, peak 319k, all at Opus price. That is more than all the Haiku phase sessions together. The capsule handoff worked; the control session did not shrink, because it was the old one.
- **The under-100k rule covers subagents only.** The Haiku phase sessions' own main loops reached 167k (P2) and 213k (P4b), since a 1M-context main session compacts near ~967k. `haiku-case` subagents stayed under 98k.
- **Verdict:** v2 is not yet proven cheaper per round. The parts v2 controls (phases) are at par while doing more work. The part it relies on, a thin control session, has not been tried yet.

## Next round, to prove it

1. Start a **fresh** control session for the next round. Do not continue this one.
2. Keep each phase session under ~150k: load context-governor (PILOT), and hand off to a new phase session at the strong note.
3. Compare again with this file as the baseline: round total cache read, control peak, phase peaks.
