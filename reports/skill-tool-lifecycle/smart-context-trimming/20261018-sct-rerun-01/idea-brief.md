# Idea Brief — smart-context-trimming: collapse repeated output on re-runs

- **Experiment ID:** `20261018-sct-rerun-01`
- **Status:** `WAITING_FOR_IDEA_APPROVAL` (Gate A)
- **Owner:** user (XionTechs / Laya)
- **Date:** 2026-10-18
- **Related:** `smart-context-trimming/` (PILOT: 20/20 both arms, −18% then −24% session tokens), retry-loop-breaker (DROPPED 2026-10-18; replay `../retry-loop-breaker/20261018-retry-loop-breaker-replay-01/`)

## Problem
When an agent runs the same test/build command again (to check a flaky step, after a tiny change, or because it is unsure), smart-context-trimming trims each output on its own, so the agent reads almost the same failure block again. The user's idea: instead of a separate guard that refuses re-runs (dropped, it never had a loop to stop), let the trimmer notice the repetition and show only what changed.

## Current baseline
Measured offline over 639 recorded agent transcripts (`repeats.mjs` in the retry-loop replay folder): 127 recognisable test/build runs, **29 re-runs of the same command (23%) in 17 agents, 17% of all test/build output bytes**; 12 re-runs repeat at least 90% of the previous run's lines (about 10% of those bytes). Caveat: runs through the experiments' `node run.mjs` wrapper are not recognised, so this undercounts, and most recorded outputs were small; the saving per re-run grows with the log size (dotnet builds were 238 KB raw, about 8 KB trimmed).

## Hypothesis
If the trimmer keeps a per-session fingerprint of the last trimmed output of each command and, on a re-run whose kept lines are at least 90% the same, prints a short "same as run #k" note plus only the lines that changed (new or gone), then re-runs cost a few hundred bytes instead of a full trimmed block, with no lost diagnostics (the full raw log is still saved on disk, as today).

## Proposed intervention
- **Kind:** `hook` (the existing Mod), rules only.
- **Smallest useful implementation:** in `hooks/trim-core.ts`, after building the compact text: compare its kept lines (volatile parts normalised: durations, timestamps, temp paths, ports) with the previous compact text of the same normalised command in this session; if ≥ 90% equal and the exit status is the same, return `[smart-trim] Same result as run #k of this command (exit N, M lines unchanged). Changed: …` with at most 20 changed lines, and the path of the raw log. Otherwise behave as today. Per-session memory only (no disk state beyond the raw logs it already writes).
- **What Claude remains authoritative for:** deciding what to do; it can always read the raw log.
- **What the tool decides:** whether a run is "the same" (rule, threshold 0.9), and which lines to show.
- **Flag:** `collapseReruns` (default on in `enforce`, off in `observe`), so the current behaviour stays runnable as arm A.

## Jev / Laya role
- **Provider:** `none`. A rule is enough to decide "same output"; Jev adds latency and data leaving the machine for no expected gain. Jev stays as it is for the existing trimming strategy question.
- **Failure:** any error in the comparison → the normal trimmed output (never less information than today).

## Alternatives considered
| Alternative | Expected benefit | Cost/risk | Choose / reject |
|---|---|---|---|
| Do nothing | none | re-runs re-read full blocks | reject |
| retry-loop-breaker (refuse re-runs) | measured zero | blocks a legitimate flaky re-run | dropped by the user |
| **Collapse repeated output in smart-context-trimming (recommended)** | fewer tokens on every re-run, never blocks | wrong "same" verdict could hide a new line → mitigated by always listing changed lines and keeping the raw log | **choose** |
| Ask Jev whether two outputs are "the same" | maybe smarter on noisy logs | latency, cost, data off the machine | reject |

## Success criteria (fixed before any data)
| Metric | Baseline | Target | Guardrail |
|---|---:|---:|---|
| Content run: tokens Claude reads on the re-runs of a set of recorded/synthesised retry sequences (test, build, flaky, small fix) | trimmed output of each run | ≥ 50% fewer tokens on re-runs | every new or changed diagnostic line is still shown (checked by a script per case) |
| First runs | today's trimmed output | identical (byte for byte) | — |
| Existing tests | 24/24 | all pass | — |
| Agent run (only if the content run meets its target) | sct PILOT result | B ≤ A tokens, pass B ≥ A | no case worse |

## Scope and non-goals
- **In scope:** the comparison and collapsed message in `trim-core.ts`, the flag, unit tests (same output, one new failure line, different exit code, volatile timestamps, first run untouched), a content run (cheap, `count_tokens.mjs`) on 6-8 retry sequences built from real recorded outputs, then at most a small agent run (4 cases × 2 reps, Haiku effort high) if the content run passes. One Opus call with a closed input pack.
- **Out of scope:** blocking re-runs, the Jev strategy call, cross-session memory.

## Risks and mitigations
| Risk | Likelihood/impact | Mitigation and test |
|---|---|---|
| A new failure hidden as "same" | low / high | threshold on kept lines plus "changed lines" always printed; exit code must match; unit test with one new failing test |
| Volatile lines make every run look different | medium / no gain | normalise durations, timestamps, temp paths, ports, PIDs before comparing |
| Agents re-run rarely, so the total gain is small | medium | stated up front (23% of runs re-run here); the content run measures per re-run, the agent run only if worth it |

## Recommendation
`PROCEED` with the rules-only collapse behind a flag. It reuses the PILOT Mod, never blocks anything, and costs little to measure.

## Human decision
- **Decision:** `APPROVED | REVISE | HOLD | REJECTED`
- **Approved scope / changes:**
- **Decision date:**
- **Notes:**
