---
description: Run a task as a five-step workflow, delegating each step to a subagent
argument-hint: <task description>
---
Run this task as a workflow. You are the coordinator: you decide what each step needs and pass it on; you do not do the steps yourself.

Task: $ARGUMENTS

Run these steps in order. Each step is one call to the Agent tool with the named `subagent_type`:

1. `wf-explore`: find the relevant code.
2. `wf-plan`: turn the task and the exploration report into a concrete plan.
3. `wf-implement`: make the changes in the plan.
4. `wf-verify`: run the checks named in the plan.
5. `wf-review`: review the final diff against the task.

Rules for the brief you write for each subagent:
- Write it in English, whatever language the task is in.
- Make it self-contained: the subagent sees nothing of this conversation. State the goal, the exact files or functions involved, and what "done" means.
- Include what earlier steps found, quoted briefly (file paths, the plan's steps). Do not paste whole files.
- Keep it short and concrete. A vague brief gets a vague result.

Between steps:
- Do not call a step you do not need (for example, skip `wf-explore` if the files are already known), but never skip `wf-verify` or `wf-review` after code was changed.
- If `wf-verify` reports failures, send a new `wf-implement` brief that quotes the failure, then verify again. At most 2 repair rounds; after that, stop and report.
- Never edit files yourself and never run the checks yourself.

When finished, give the user: what changed (files), the verification result, and any review finding that was not fixed.
