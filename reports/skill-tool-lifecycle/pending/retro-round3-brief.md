# Retro round 3 (quota-saving mode): improve and re-measure

You are one of at most two sessions running at the same time. Read this file, then `reports/skill-tool-lifecycle/pending/retro-run-brief.md` (measurement rules, still in force) and `.claude/skills/build-skill-tool-workflow/SKILL.md`. Chat in Vietnamese, report files in English. Gate B stays with the user: never record `finalDecision`.

## Quota rules (the user chose saving mode; these override round 2)
Round 2 spent about as many tokens on open-ended Opus agents as on all Haiku case agents, and the orchestrating sessions woke up hundreds of times. So:
- **Case agents:** Haiku, `effort: "high"` (not xhigh). 4 cases x 2 repetitions unless your tool section says otherwise. At most 4 case agents in flight.
- **Opus: exactly one call per tool**, for the step-7b review / choice of fixes, with a **closed input pack**: paste into its prompt the last `summary.json` (numbers only), the last `improvements.md`, your diff (or design change) and the new results table. Tell it not to open files or explore the repo, and to answer in under 600 words. No other Opus calls (no Opus code review, no Opus fixture review).
- **Code review of your diff:** one Haiku or Sonnet agent, read-only, given the diff only.
- **Few wake-ups:** launch each batch of case agents, then do something useful or end the turn; do not poll, sleep or check status in a loop. Collect all results of a batch in one turn.
- Keep the chat short; write everything to files.

## Steps
1. Branch `claude/<tool>-round3` from `main`. Read the last round's `improvements.md` (the path is in your tool section); do not re-review from scratch.
2. Apply the listed changes, small and named, behind the tool's existing flag; tests with `node --test "<dir>/*.test.mjs"` (or the tool's pytest), `unit-tests.json` from real output.
3. Haiku/Sonnet diff review -> `agent-review.json`. Fix any Critical/Major you introduced; older open findings go to `deviations` as accepted for this run.
4. Measure: experiment id `20261018-<slug>-r3-agent-01` in `reports/skill-tool-lifecycle/<tool>/`, two arms, answer keys away from the agents, arm A checked with `subagent_usage.mjs --forbid`.
5. The single Opus call (closed pack) -> `improvements.md` if the result is still bad by step 7b; honest verdict in the manifest.
6. `build_tool_report.mjs` for your folder only (not the main index), commit the branch, never push or merge.
Final message under 150 words: branch/commit, what changed, pass A/B, tokens or cost A->B, verdict, next suggestion, Opus calls made (should be 1).
