# P3 offline gate (design §5, amended formula): context-governor replay, 2026-10-18

Run: `node context-governor/scripts/replay.mjs --date 2026-10-18 --control 82e30143` (exit 1). Full output: `output.txt`. The first run with the literal formula is kept in `output-literal.txt`.

## Result: **BLOCKED** (condition 2 fails)

- control t* 173 avoided 7M of cacheRead 108M
- PASS 1 control gets strong note
- FAIL 2 avoided upper bound >= 30% of control cacheRead (6.7%)
- PASS 3 each main session <= 5 notes
- PASS 4 subagent turns get 0 notes

## What changed

- The user amended the §5 upper bound after the first run: t* = first crossing of 200k from below; avoided(t) = max(0, min(ctx(t), ctx(t*)) - B).
- First run (literal formula, t* = turn 1 at 657k): 121.4% of cache read. That is impossible as a saving, so it was not credible.
- Amended formula: t* = turn 173 (200k). The upper bound is about 7M of 108M cache read (6.7%), under the 30% condition.

## Reading

- The control session was already at 657k context on its first replayed turn: it continued an earlier, longer conversation. A warning at 200k could only have helped before that, which this replay cannot see.
- After turn 173 the session stayed close to the threshold. Even an ideal compact at t* would have saved little.
- Per design §5, P3 stops here and the A/B does not run. The decision goes to P4 (Opus review) and then the user.
