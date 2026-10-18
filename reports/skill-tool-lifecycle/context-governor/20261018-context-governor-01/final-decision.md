# Final decision: context-governor

- **Decision:** PILOT
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-context-governor-01 (workflow v2: Opus plan and review, Haiku build, gate and fixes)
- **Based on:**
  - The re-frozen offline replay gate passed all 4 conditions.
  - Control session upper bound: 33.5% of cache read (69.0M of 205.8M), against a 30% threshold.
  - Three clean-crossing sessions scored 40-45%; the held-out session from 2026-10-17 scored 39.7%.
  - Subagent turns got 0 notes; at most 4 notes per session.
  - Tests: unit 19/19, engine 6/6, smoke 1/1, typecheck pass.
  - All 10 Opus review findings were fixed.
- **Caveats:**
  - 33.5% is an upper bound that assumes the user acts at the 200k crossing. In the one session with a recorded compaction, the user compacted 327 turns later.
  - The real A/B has not run.
  - The gate formula changed twice in this round. Both changes are recorded in `design.md` and `manifest.json`; the second was frozen before the run.
  - The experiment's own recommendation was `INSUFFICIENT_EVIDENCE` (LOW).

## What PILOT means here
- Opt in per session with `claude --plugin-dir ./context-governor` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. It is never enabled globally and never touches `.claude/settings.json`.
- Warn only: it never blocks, compacts or ends a session.
- Before piloting, set `artifactDir` to the experiment folder (or `CONTEXT_GOVERNOR_ARTIFACT_DIR`) and consider a higher `staleTurns`. A broad artifact folder gave 32 stale notes in one session.

## Next
- Use the plugin in the next workflow-v2 sessions and record each phase session in `manifest.phases[]`.
- Measure the real effect with `phase_usage.mjs`: peak context, cache read and turns per session, against the 2026-10-18 rounds.
- Decide ADOPT or REWORK on those real numbers, in a new experiment id (Track E).
