# P3 offline gate (design §5): context-governor replay, 2026-10-18

Run: `node context-governor/scripts/replay.mjs --date 2026-10-18 --control 82e30143` (exit 0). Full output: `output.txt`. Per-session numbers: `summary.json`.
Scope: 231 session files that have 2026-10-18 turns, plus their subagent files. Base (median first-turn context) = 47,239.

## Pass conditions, as written

| # | Condition | Result | Key numbers |
|---|---|---|---|
| 1 | Control session gets the strong note at least once | PASS | strong at turn 1 (657k), again at turn 173 (200k) |
| 2 | Avoided upper bound >= 30% of control cache read | PASS as written, but NOT credible (see caveat) | literal 127M avoided vs 105M cache read = 121.4% |
| 3 | Each main session gets <= 5 notes | PASS | max 3 (control); all others 0-2 |
| 4 | Subagent turns get 0 notes | PASS | subNotes 0 in every session |

Gate result as written: **PASS (4 of 4)**.

## Caveat on condition 2 (read before P4)

- The control session's first turn is already at 657k context, so the strong note fires at turn 1. Design §5 takes t* = first strong crossing, which makes t* = turn 1.
- The literal formula gives 127M avoided tokens. The session's total context summed over all 210 turns is only 107M (cache read 105M), so the "upper bound" exceeds everything the session read. It cannot be a saving; the formula is not a valid bound when ctx(t*) is far above the later contexts (102 of 210 turns are below 657k).
- Alternative, same formula with t* = first strong crossing after turn 1 (turn 173, 200k): avoided 6M = **5.4%** of cache read, which would FAIL condition 2.
- The control's main-loop cache read is 105M. The 200M+ figure in the brief includes cache creation and subagent turns, which this replay does not count in cache read.

Recommendation for P4 (not decided here): the design's t* / upper-bound definition needs a fix before trusting condition 2. Condition 2 passes only on the literal reading.

## Status

`EVALUATION_COMPLETE` per the literal gate rule. The A/B (design §6) has not been run and needs real workflow sessions with `--plugin-dir`.
