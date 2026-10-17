# Retro idea brief: retry-loop-breaker (Mod, PILOT observe)

Retro run: the Mod is already built (`retry-loop-breaker/`, commit 9f2db58). Gate A and implementation are skipped by the user's brief.

**Question this run answers.** When a Haiku 5.5 agent meets a check that cannot pass for an environmental reason, does the Mod's message make it stop or change approach sooner (fewer turns and tokens) than plain Claude, and does the Mod ever intervene on a legitimate retry (a false block)?

**What the Mod decides.** Rules: a validation command (npm test, node --test, npm run build ...) that failed twice with the same normalized error and no state change is flagged. Jev (typesafe/jev-1.13) is asked only about near-duplicates of such a command (allow_retry / block_redundant_retry / uncertain_allow, block at p>=0.8); errors allow.

**Success criteria (fixed before data).** (1) No case that passes in A fails in B. (2) Zero false blocks on the legitimate-retry cases (a block shown to the agent on a failed legitimate retry counts; a silent would-block on a run that then passes is logged and reported separately). (3) On the impossible cases B uses fewer runs/turns than A to stop. Tokens A -> B are reported as measured.
