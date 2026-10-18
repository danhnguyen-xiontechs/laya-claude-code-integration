# Idea Brief — smart-context-trimming round 2 (agent run)

- **Experiment ID:** `20261018-sct-r2-agent-01` (branch `claude/sct-round2`, not pushed, not merged)
- **Baseline (unchanged):** [`20261017-sct-agent-02`](../20261017-sct-agent-02/manifest.json) — PILOT: 10/10 pass per arm, mean session tokens −18% (4.96M → 4.04M). Its step-7b review is [`improvements.md`](../20261017-sct-agent-02/improvements.md).
- **Retro question:** does the top two suggestions of that review (keep the whole node assertion block across the whitespace-only gap line; a pass/fail digest by test name) remove the two cases that got worse (js-feature +24%, js-root-exception +8%) without losing passes, and does it keep the dotnet-build gain?
- **Change under test:** `smart-context-trimming/hooks/trim-core.ts` — `extractCandidates` (failure block continues across the gap line; node-internal frames do not use up `FAILED_DETAIL_MAX`) and `testDigest` (one `[smart-trim]` line per run naming each test group with its count). Arm A is unchanged.
- **Design:** identical to 20261017-sct-agent-02: same 5 tasks (`make_tasks.mjs`, copied unchanged), same prompt text in both arms, same command `node run.mjs test|build`, Haiku 5.5 effort xhigh, 2 repetitions, rep 2 launched B first, at most 6 case agents in flight, arm A checked with `subagent_usage.mjs --forbid`.
- **Success criteria (from round 1):** no case worse; total tokens lower by more than the round-1 noise (±17% between arms on untrimmed tasks).
- **Known limits carried over:** the harness runs `run.mjs` (not the real PostToolUse hook); Jev is asked only on dotnet-build; 2 repetitions are noisy (per-case spread inside arm A reached 40% in round 1).
