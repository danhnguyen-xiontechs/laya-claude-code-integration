# 20261018-sbp-r2-agent-01 — design

Same case set, prompts, arms, wrapper, gold invariants and grading script as 20261017-sbp-agent-02 (cases/, make_tasks.mjs,
grade.mjs copied; only the experiment id changed). Tool under test: branch claude/sbp-round2 commit 8d87440
(incomplete stories held; endpoint fix). Haiku 5.5 xhigh case agents, 2 reps (rep 2 B first), at most 6 in flight.
Arm A prompt says no planner is available; checked with `subagent_usage.mjs --forbid "story-batch-planner|plan\.mjs"`.
Pass = correctness only (invariants in grade.mjs); tokens from subagent transcripts.
