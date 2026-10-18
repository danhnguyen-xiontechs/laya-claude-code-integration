# Retro idea brief: retry-loop-breaker, round 2

Round 2 of a retro measurement. The baseline is round 1, [`../20261018-retry-loop-breaker-agent-01/`](../20261018-retry-loop-breaker-agent-01/report.html). That round was a null result: plain Claude never looped, the Mod showed nothing, and it would have falsely blocked fail, fail, pass.

**Question.** When plain Claude (Haiku 5.5, effort xhigh) really does repeat the same failing check, does the guard cut tokens and turns without blocking a legitimate retry?

**What was fixed before measuring.** Two tool commits on branch `claude/retry-loop-round2`:
- `0ddf988`: default threshold 2 → 3, so fail, fail, pass is no longer refused; `passed` is now epoch-aware.
- `18a6a6f`: review fixes. A flaky mark is valid only at its own epoch, and a transient failure never counts as flaky.

**Success criteria (fixed in design.md).**
1. No case that passes in A fails in B.
2. 0 false blocks on flaky-once, flaky-twice and build-flag.
3. On the looping cases, B stops with fewer identical runs than A, and B uses fewer tokens.

**Deviations from the round-1 brief.**
- **Case set changed on purpose.** The round-1 brief said to keep the cases, but the orchestrator overrode it because the round-1 baseline never looped. There are 3 new impossible "progress, then stall" cases. flaky-once and flaky-twice now reuse index-warmup's code; build-flag is unchanged.
- **B runs in enforce mode,** deciding before the run, with threshold 3.
- **Jev had 0 calls** in all 24 B runs, so the engine's contribution is still unmeasured.
- **Caveat: the arm prompts are not the same.** B's last sentence says a retry guard is attached to run.mjs; A's says no guard is available. The design controls nothing beyond that one sentence. The transcripts suggest that this sentence, not the guard's refusals, explains most B early stops (see `improvements.md`).
