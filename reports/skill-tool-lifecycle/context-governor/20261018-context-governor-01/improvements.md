# improvements.md: context-governor (P4 review, 2026-10-18)

Gate result: BLOCKED (condition 2 failed at 6.7%). A/B not run.

## Diagnosis

The control session 82e30143 entered the replay at 657k context and peaked at 953k. Turns 1 to about 129 ran in that 657k to 953k range and carry most of its 108M cacheRead. The amended t* (first crossing of 200k from below) is turn 173, and the avoided bound is capped at about (200k − 47k) × 47 turns ≈ 7M. The denominator still counts all 220 turns, and the numerator and denominator are in different units (context tokens vs cache_read). So the 6.7% measures how far the formula can reach in this window, not what the tool does. The cases could not show value here.

## Suggestions (ranked by expected effect)

1. **Change:** `scripts/replay.mjs`, read the whole conversation of 82e30143 with no date filter. **Why:** the session starts at 657k, so its 200k crossing falls before the window. **Expected effect:** t* moves to the real crossing and the bound will likely be well above 30%. **How to verify:** print t*, the turn count and cacheRead for the full history.
2. **Change:** `scripts/replay.mjs`, compute avoided and the denominator in the same unit (cache_read). **Why:** the 121.4% figure came from mixing units. **Expected effect:** the ratio stays ≤ 100% by construction. **How to verify:** assert avoided ≤ cacheRead.
3. **Change:** add a realized-delay metric in `replay.mjs`: turns between the 200k crossing and the turn where the user would have compacted (the control's context fell below 100k around t129). **Why:** the tool can only save the turns between its note and the user's real compaction. **Expected effect:** a lower, more honest bound that does not assume perfect compliance. **How to verify:** per session, list crossing turn, compaction turn and cacheRead in between.
4. **Change:** `scripts/replay.mjs`, report the bound for b266357b, 5b84aa0f and 3e716326, which cross cleanly at t57, t52 and t36. **Why:** clean crossings from below the threshold. **Expected effect:** results per session instead of one degenerate case. **How to verify:** a table in `evidence/replay/gate.md`.
5. **Change:** `hooks/context-governor.ts`, fix the repeated note after a failed state write and the 'unknown' session-id collision, before any A/B. **Expected effect:** no duplicate notes, no cross-session state leak. **How to verify:** an engine test with a throwing write.

Top suggestion: replay the control conversation's full history with no date filter, using one pre-frozen formula in a single unit.

## Tool or data?

The failure comes from the replay data and the formula's window, not from the tool. The tool fired strong at t1 and t173 as designed. Most of the control session's cache read sits before any crossing from below that the formula can credit, so the best possible score after t173 is about 47 × 153k / 108M ≈ 6.7%, whatever the tool does.
