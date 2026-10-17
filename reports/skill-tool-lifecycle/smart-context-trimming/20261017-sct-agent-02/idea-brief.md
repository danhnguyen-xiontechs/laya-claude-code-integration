# Idea Brief — smart-context-trimming v2, agent run

- **Experiment ID:** `20261017-sct-agent-02`
- **Follows:** `20261017-sct-agent-01` (REWORK: node --test failures not recognised, so 3 of 5 tasks were never trimmed)
- **Change under test (commit d5f1113):** trim-core recognises `✖` failures and `ℹ tests/pass/fail` summaries; failures with identical details keep 2 full blocks and only the test name for the rest.
- **Design:** identical to agent-01 (same 5 tasks, same prompts, Haiku 5.5 effort xhigh, 2 reps, rep 2 launched B first).
- **Success criteria:** no case worse; total tokens lower by more than the noise seen in agent-01 (±17%).
