# Improvements: retry-loop-breaker (from run 20261018-retry-loop-breaker-agent-01)

**Diagnosis.** The run is a null result, not a win: total tokens A 4,552,655 -> B 4,441,697 (-2.4%, well inside the +-20-40% swing between repetitions of the same case; e.g. env-linux-proc A r1 414k vs A r2 582k), pass A 11/12 vs B 12/12 (the one A failure, flaky-once r1, is the agent declining to rerun, not a Mod effect). Haiku 5.5 never entered a retry loop on the 3 impossible cases (1-2 runs in 11 of 12 runs; the two long runs were `wsl ...` workarounds, i.e. different commands the Mod does not classify), so the Mod's rule saw at most 2 identical failures and showed the agent nothing: 0 notes shown, 0 Jev calls, 2 silent would-blocks, both on the legitimate flaky-twice case (third run, which passed): a false block in enforce mode. The engine was called on every guarded run and changed nothing the agent used.

## Suggestions, ranked by expected effect

1. **Re-measure on cases that loop.**
   - *Change:* a new case set where the plain agent really repeats the same command (long `npm test` loops after an environment error, a prompt that does not say "say why in your final answer", a model or turn budget where repeating happens).
   - *Why:* here the baseline already stopped at run 1-2, so there was nothing to break; 11/12 vs 12/12 and -2.4% say nothing about the Mod.
   - *Expected effect:* turns a null result into a real one.
   - *Verify:* arm A shows >= 4 identical failing runs in at least 2 of 3 impossible cases before B is judged.
2. **Fix fail, fail, pass being blocked.**
   - *Change:* `hooks/core.ts` `recordAfter` (~line 216: store the epoch in `passed`, mark flaky only at the same epoch) and `decideBefore` (~line 183: for non-transient errors require a third identical failure, i.e. `maxIdenticalFailuresBeforeBlock` 3, or keep a documented-flaky allowlist).
   - *Why:* flaky-twice would be refused on the third run, the one that passes (2 of 2 repetitions logged `block`); the review findings on `core.ts:183` and `core.ts:216` are the same bug.
   - *Expected effect:* removes the observed false block.
   - *Verify:* add a fail, fail, pass unit test; rerun flaky-twice B with the message shown before the run: it must still pass.
3. **Cover the loops the Mod cannot see.**
   - *Change:* `hooks/core.ts` `RUNNERS` / `classify` and the near-duplicate rule.
   - *Why:* the one 9-run loop (env-linux-proc A r2) was 4 different non-eligible commands (`wsl ...`, `node -p ...`); the Mod never evaluated them.
   - *Expected effect:* only worthwhile if loops of that shape matter in real use.
   - *Verify:* the same case, count would-blocks.
4. **Drop the engine call, keep rules only, until a case shows Jev deciding something.**
   - *Change:* `jevEnabled: false` in `DEFAULTS` (`hooks/core.ts`).
   - *Why:* 0 of 24 runs reached the ambiguous path (build-flag agents changed the flag after one failure, below the threshold of 2), so Jev's cost (up to 4 s of waiting, command and error text sent to OpenRouter) bought nothing here.
   - *Expected effect:* no behaviour change in this run's cases, less latency and data egress.
   - *Verify:* rerun the loop cases with Jev on and off; keep Jev only if it blocks a near-duplicate loop that rules miss.
5. **Measure closer to the real hook.**
   - *Change:* run the cases with `claude -p --plugin-dir retry-loop-breaker` in enforce mode instead of the wrapper.
   - *Why:* the wrapper does not see non-wrapper Bash calls (the real hook resets the epoch more often) and stays silent on a passing run.
   - *Expected effect:* removes the main caveat of this run.
   - *Verify:* same cases; the hook's own audit (`/retry-guard status`) matches the wrapper's would-block count.
