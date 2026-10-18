# Final decision: retry-loop-breaker

- **Decision:** DROPPED
- **Decided by:** the user, 2026-10-18 (replaces the INSUFFICIENT_EVIDENCE the round-2 session had recorded on its own)
- **Based on:** round 1 and round 2 (12/12 vs 12/12, tokens +2.8%, Jev never called), the round-3 pilot gate (the placebo baseline stopped after 1 turn past the third identical failure), and the offline replay `../20261018-retry-loop-breaker-replay-01/` (0 would-block in 3,474 agent Bash calls).

## Why
Agents do not repeat a failing command enough for the guard to act; the expected saving is about zero.

## What happens instead
The useful part of the idea moves into smart-context-trimming: when a command is run again with the same failure, the repeated output is collapsed instead of being shown in full again (separate idea brief, Gate A pending). The round-3 code stays on branch `claude/retry-loop-round3`, not merged.
