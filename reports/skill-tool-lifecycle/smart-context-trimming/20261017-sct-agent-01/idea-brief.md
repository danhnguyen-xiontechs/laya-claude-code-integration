# Idea Brief — smart-context-trimming, agent run

- **Experiment ID:** `20261017-sct-agent-01`
- **Follows:** `20261016-sct-bench-01` (content run on fixtures, verdict REWORK / LOW)
- **Date:** 2026-10-17

## Why this run
The content run only showed that the command output gets smaller. It did not show whether Claude finishes a real task with fewer tokens, or whether the trimmed output makes it fail. This run gives Haiku 5.5 subagents (effort xhigh, the haiku-subagent settings) real "fix the failing tests / build" tasks and measures the whole session.

## Design
- 5 tasks (`make_tasks.mjs`): one bug, three bugs, one root-cause exception behind 40 failures, implement a missing function, .NET compile error under 250 warnings. Each test/build output is 300–900 lines, above the hook threshold.
- Arms: A = raw output, B = output through `trim-core.ts` decideAndBuild with Jev live. Same prompt, same `node run.mjs` command, fresh folder per session, 2 reps, order rotated (rep 2 launched B first).
- Pass = the raw command exits 0 and the tests / Legacy.cs are unchanged (`import_runs.mjs`).
- Tokens = real API usage of each subagent transcript (`transcript_usage.mjs`).

## Success criteria
No case worse in B; total tokens lower by more than the run-to-run noise.
