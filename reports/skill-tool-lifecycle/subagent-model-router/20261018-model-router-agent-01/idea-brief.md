# Retro idea brief: subagent-model-router (20261018-model-router-agent-01)

Retro measurement of an already-built PILOT tool; Gate A was passed when the tool was built, so this is the question this run answers, not a new proposal.

**Problem.** An orchestrator that fans out subagents lets all of them inherit the main model (98% of subagent spend in the tool's own history had no `model` set). Sonnet-by-default is the plain baseline.
**Tool.** `route.mjs` picks haiku/sonnet/opus per subagent prompt from local rules + TypeSafe Jev (policy gate+sc, k=3), with an escalate-once cascade when the case's automatic check fails.
**Question.** On small tasks that have an automatic check, does arm B (router tier + cascade) pass as many cases as arm A (every agent on Sonnet) at a lower price-weighted cost?
**Hypothesis (from the README).** Pass rate equal, cost clearly lower. README also says Jev gate+sc sends most coding tasks to Sonnet, so the saving should be small for Jev gate+sc and come from lookup/rename tasks only.
**What Jev decides / failure mode.** It votes a tier 3 times; if it is wrong low, the cascade pays one more run; if the provider fails, no tier (caller default).
**Success criteria (fixed before data).** B passes every case A passes (after the cascade), and B's price-weighted cost is lower than A's. Escalations are reported.
**Non-goals.** The PreToolUse hook, the governor, the history miner.
