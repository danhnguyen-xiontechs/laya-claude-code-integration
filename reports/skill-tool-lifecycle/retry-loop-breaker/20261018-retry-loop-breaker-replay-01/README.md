# retry-loop-breaker: offline replay (2026-10-18)

No agents were run. The guard's own decision code (`classify`, `decideBefore`, `recordAfter`, `bashMayMutate` from `hooks/core.ts`) was replayed over the Bash calls of every subagent transcript recorded so far in this project, wired the way `hooks/register.ts` wires it (successful Edit/Write and "mutating" non-eligible Bash bump the epoch; eligible Bash is decided before and recorded after; enforce mode, Jev off). Three versions: `orig` (main), `r2` (`claude/retry-loop-round2`), `r3` (`claude/retry-loop-round3` @ 2045c23).

Two transcript groups:
- **retry-loop experiments** (rounds 1-3, 62 agents, 373 Bash calls): their commands went through the measurement wrapper `node run.mjs <cmd>`; with `UNWRAP=1` the wrapper is removed so the replay sees the command the agent would run without the harness.
- **other agents** (517 agents of all other experiments, 3,101 Bash calls): normal work (fix a bug, plan waves, find files).

## Result

| Group | Version | Eligible Bash calls | Would block | Calls a block would save |
|---|---|---:|---:|---:|
| retry-loop experiments (unwrapped) | orig | 4 | 0 | 0 |
| | r2 | 4 | 0 | 0 |
| | **r3** | **85** | **0** | 0 |
| other agents | orig / r2 | 0 | 0 | 0 |
| | **r3** | **38** | **0** | 0 |

- **The round-3 wrapper stripping works**: the guard now recognises 85 of the loop-case validation runs (was 4) and 38 runs in normal work (was 0).
- **It still never blocks**, and so it cannot save anything, for three reasons seen in the per-call trace (`trace.mjs`, 11 agents with >= 3 runs):
  1. **The agents do not repeat a failing command 4 times at the same state.** The most identical runs per agent is 3 (8 of 11) or 4 (2 of 11, and then with a state change or a pass in between). With threshold 3 the first refusal can only come on the 4th identical failure.
  2. **Read-only inspections reset the count.** 19 of 21 epoch bumps came from `cd "<dir>" && cat|ls|grep ...`: `bashMayMutate()` does not strip the `cd <dir> &&` prefix, sees a compound command and assumes it may have changed the state. An agent that alternates "run tests / look at a file" never accumulates repeats.
  3. **Fingerprints drift**: the same failure sometimes produced a different error fingerprint between runs (for example `err-e44aaddf` then `err-2634bc3b` in one agent), which restarts the count.
- **No false blocks** either, in 3,474 Bash calls.

## What this means
On the agent behaviour recorded here (Haiku 5.5, and Sonnet/Opus subagents in the other group), the guard has nothing to stop: agents give up or change approach after 2-3 identical failures. Fixing (2) and (3) would let the guard count more honestly, but would not create loops that are not there. Expected saving on this behaviour: about zero.

## Suggestions
1. Fix `bashMayMutate()` to strip the leading `cd <dir> &&` before deciding (as `classify()` already does), and normalise volatile parts of the output (durations, timestamps, temp paths) before fingerprinting. Small, safe, unit-testable.
2. Do not spend more agent runs on this tool until there is evidence of real loops: keep it in `observe` mode on real sessions and read its audit log (`wouldBlock` count) after a week.
3. If observe mode also shows `wouldBlock` = 0, mark it DROP (or keep as a dormant safety net with Jev off).

Files: `replay.mjs` (the replay), `trace.mjs` (per-call trace), `replay-result.json` (as recorded), `replay-unwrapped.json` (wrapper removed).
