# Offline gate (design §5, re-frozen 2026-10-18T14:01:32Z): context-governor replay, second run

Run: `node context-governor/scripts/replay.mjs --control 82e30143 --summary …/summary-run2.json` (exit 0). Full output: `output-run2.txt`; per-session data: `summary-run2.json`. The earlier runs are kept as `output-run1.txt` / `summary-run1.json` / `gate-run1.md` (amended formula, one day only) and `output-literal.txt` (literal formula, 121.4%).

## Result: **PASS** on all four conditions (frozen rule)

- PASS 1 control 82e30143 gets the strong note (t63, 201k)
- PASS 2 control avoided / cacheRead = **33.5%** (69.0M of 205.8M; threshold 30%)
- PASS 3 each of 333 main sessions has at most 5 notes (max 4)
- PASS 4 subagent turns get 0 notes (8,755 subagent turns)

Read the pass with the realized-delay row below. The 33.5% is an upper bound that assumes the user acts at the crossing. It is not what the user achieved.

## Rule used (what changed from run 1)

- Whole history, no date filter. All timestamps are UTC (`Z`); the first run's midnight cut in UTC is gone.
- Numerator and denominator both in cache_read tokens. avoided <= cacheRead is asserted for every session; no session breached it.
- t* = first crossing of 200k from below over the whole history. Control: t63 (run 1 had t173 after cutting the window).
- B_cr = median first-turn cache_read over the 333 replayed main sessions = 33,701 tokens.
- Artifact rule: writes by Write/Edit/MultiEdit to a path containing `20261018-context-governor-01`. The control session made no such write, so the stale rule is not exercised in the gated run (see the coverage check below).

## Per session (gated run)

| session | first (UTC) | turns | peak | cacheRead | t* | avoided | ratio | realized delay | notes | subagent cacheRead (separate, not in denominator) |
|---|---|---|---|---|---|---|---|---|---|---|
| **82e30143 (control)** | 2026-10-17 04:45 | 506 | 953k | 205.8M | 63 | 69.0M | **33.5%** | 327 turns (realized window 174.8M of 205.8M) | soft t18, strong t63, soft t406, strong t449 | 49.1M (609 turns) |
| b266357b | 2026-10-18 08:23 | 137 | 328k | 28.9M | 57 | 13.1M | 45.4% | none: no compaction after t* in history | soft t14, strong t57 | 0.5M (13 turns) |
| 3e716326 | 2026-10-18 07:34 | 62 | 249k | 10.7M | 36 | 4.3M | 40.2% | none | soft t13, strong t36 | 0 |
| 5b84aa0f | 2026-10-18 03:17 | 107 | 311k | 21.1M | 52 | 9.0M | 42.5% | none | soft t19, strong t52 | 11.7M (168 turns) |
| **5094744c (held-out, 2026-10-17)** | 2026-10-17 17:18 | 182 | 548k | 63.1M | 31 | 25.0M | 39.7% | none | soft t13, strong t31 | 21.7M (348 turns) |

Held-out rule (fixed before the run): the largest-cacheRead main session whose first timestamp is 2026-10-17 UTC, excluding the four named sessions. It is reported, not gating.

## Realized delay (reported, not gating)

- Control: the first `compact_boundary` after t63 is at 2026-10-18 08:06:45 UTC, which is turn 390. The note would have sat unused for 327 turns, and 174.8M of the 205.8M cache read (85%) falls in that window.
- The other sessions have no compaction after t* in their history, so no realized delay can be read for them.
- Reading: the upper bound in condition 2 assumes the user compacts at the crossing. In the one session with a recorded compaction, the user compacted about 327 turns later. A warn-only tool can only save what the user acts on, so the realized saving is far below 33.5%.

## Coverage check (not gating, not the gate)

`output-run2-stale-coverage.txt`: the same replay with artifact key `reports/skill-tool-lifecycle` (any write under reports/).
- The stale note fires in 2 sessions. The stale path is now exercised on real transcripts.
- One session gets 32 notes, so condition 3 fails in this coverage run. The stale rule is noisy when its folder is broad. Scope the `artifactDir` to the experiment folder or raise `staleTurns` before using it.

## Deviations and caveats

- The gated run uses the frozen rule as written. B_cr is 33,701 tokens, so the earlier worry that it could be 0 does not apply.
- The realized-delay row is an extra metric, added as §5 required. It is not in the gate.
- The pass margin on condition 2 is small (33.5% against 30%), and it is one session.
- The A/B (P3) has not run. The gate passing means P3 may now run; it is not run in this session.
