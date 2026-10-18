# Improvements: subagent-model-router (20261018-model-router-agent-01)

**Diagnosis.** Both arms passed 12/12 first attempts; B cost $0.97 vs $1.51 for A (-35%, price-weighted; raw tokens identical, 3.25M each). The whole saving comes from the two lookup cases (e1-locate, e2-count), which the router sent to Haiku: $0.53 -> $0.03 (-95%). In the other 8 pairs B ran on Sonnet like A ($0.98 vs $0.94, run-to-run noise). Jev never lowered a tier (gate = max); it only raised r1-rename from the rules' haiku to sonnet in both repetitions, which is cost without a measured benefit. No escalation was needed. The cases are too easy to show whether the cascade or Jev's caution matter, and the review found that the README's "14% of opus" claim is stale (current rules put 11/18 bench prompts on Sonnet).

1. **Rebuild the routing evidence and pin it with a test.**
   - change: re-run `bench.mjs route --provider none` and `--provider jev`, re-score, fix the README numbers (and "18 tests" -> 29); add a test in `test/bench.test.mjs` asserting `ruleTier(ruleFeatures(subagentPrompt(task)))` equals `route-none.json` for all 18 tasks.
   - why: review Critical 1; the cached file says 16 haiku, current rules give 5 (`FILE_RE` counts `.test.mjs` as a file, so the "checked" rule stops firing).
   - expected effect: the claimed 10-14% becomes an honest ~45%, or the rules are fixed to recover it.
   - verify: the new test fails on today's tree and passes after the re-run.
2. **Make the "checked" rule robust to the test-command wording.**
   - change: `router.mjs` FILE_RE / `ruleFeatures`: ignore glob fragments and the `(it finds test/*.test.mjs; ...)` clause, or allow more than two "files" when the extras are test globs.
   - why: with the prompts as written, f1-paginate, d3-maplimit, d5-deps and r1-rename (rules haiku before the prompt rewrite) end at Sonnet; this is the only way rules-only can save on coding tasks.
   - expected effect: those tasks go to Haiku again; at about 1/18 of the Sonnet price per run that is up to -90% on them, with the cascade as the safety net.
   - verify: re-run this experiment's 12 B runs; expect an escalation on d5-deps at most.
3. **Skip the Jev call for tasks that carry an automatic check (rules + cascade); keep it for tasks without one.**
   - change: `router.mjs` default policy / SKILL.md: `gate+sc` only when `hasCheck` is false.
   - why: here Jev only ever raised a tier (r1-rename) and cost 3 calls (0.7-1.5 s) per route; the README's own benchmark says Jev policies cost ~3.5x rules + cascade.
   - expected effect: same pass rate; r1-rename-type cases stop paying the Sonnet price.
   - verify: same cases, B cost with `--provider none` vs now.
4. **Count failed provider calls in self-consistency.**
   - change: `consistency()` in `router.mjs`: any error -> not stable (highest tier, or no tier).
   - why: review Major: two timeouts plus one "haiku" currently route to Haiku.
   - expected effect: no cost in normal runs; no silent under-routing when Jev is flaky.
   - verify: change the test at `router.test.mjs:55` to expect the safe result.
5. **Measure on harder cases where the tiers can differ** (a new experiment): real multi-file stories with acceptance checks, A on Sonnet and A2 on Opus, B with the cascade; nothing here shows whether Haiku-first loses on hard tasks.
