# Retro round 2: improve, then re-measure a tool that had a weak result

You are one session in a batch. Read this whole file, then `reports/skill-tool-lifecycle/pending/retro-run-brief.md` (rules for the measurement, still in force), then `.claude/skills/build-skill-tool-workflow/SKILL.md`. Follow the workflow; skip steps 1-3 for the implementation (the tool exists). Chat with the user in Vietnamese; report files in English.

## What the user asked
Take the tool you were given through one more improvement loop with the existing workflow: apply the top suggestions of its last `improvements.md`, measure again, and report. Gate B (final decision) stays with the user. Do not record a `finalDecision`.

## Models and quota (the user's rules)
- **Case agents: Haiku** with effort `xhigh` (Agent tool: `model: "haiku"`, `effort: "xhigh"`). Never higher for the cases.
- **Improvement reasoning: Opus.** Every step that decides what to change (reading the last run's evidence, the new `improvements.md` review, reviewing your own diff, choosing the fix) is an Agent call with `model: "opus"`. Do not do that thinking on Haiku.
- Keep your own context small: write outputs to files, do not paste long tool output into the chat; long sessions rely on auto compaction.
- At most **6 case agents in flight** across your session (several sessions run in parallel; more than that made helpers time out).

## Steps
1. **Read the last result** of your tool: `manifest.json` headline, `improvements.md`, `summary.json` and the evidence it links. Note the top suggestion.
2. **Apply the top 1-2 suggestions** on a new branch `claude/<tool>-round2` from `main` (commit there, never push, never merge). Keep the change small and named. If a suggestion says "drop the engine call" or "drop the tool", implement it as a flag-off variant rather than deleting code, so arm A stays runnable. Add or update tests; run them with `node --test "<dir>/*.test.mjs"` (Node 24 needs the quoted glob) and write `unit-tests.json` from the real output.
3. **Independent review** of your diff: one Agent call with `model: "opus"`, read-only, fresh context. Save `agent-review.json`. A Critical or Major you introduced must be fixed before measuring; findings already open from the last round may stay open and go in `deviations` as accepted for this run.
4. **Measure again** with the same case set and rules as last round (same prompts, answer keys kept away from the agents, same two-arm design), 2 repetitions, Haiku case agents, arm A checked with `subagent_usage.mjs --forbid`. New experiment id: `20261018-<slug>-r2-agent-01` in `reports/skill-tool-lifecycle/<tool>/`. Keep the previous run's folder untouched and link it from `idea-brief.md` as the baseline.
5. **Decide the verdict honestly.** If the result is still bad by the step 7b rules, write a new `improvements.md` (Opus review, as step 7b asks) and keep REWORK or INSUFFICIENT_EVIDENCE. If it is clearly better (B costs no more tokens than A and passes at least as many cases, no case worse), say so, but leave the decision to the user.
6. **Build** `build_tool_report.mjs` for your folder. Do not run `build_main_report.mjs` (the orchestrator does that). Commit your branch.

## Deliverable (final message, under 200 words, Vietnamese)
Branch and commit; the suggestion applied; tests; review counts; pass A vs B; tokens A -> B (paired); whether the new result is better or still bad; the next top suggestion; any problem with the workflow skill.
