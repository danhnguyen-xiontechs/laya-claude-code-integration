# Improvements: subagent-model-router (20261018-model-router-r2-agent-01, round 2)

**Diagnosis.** Both arms passed 12/12 on the first attempt (no escalation, 0 forbidden calls), and B cost $1.03 against $1.53 for A (-33% price-weighted, round 1 -35%; -26% on rep 2, where no agent wrote a cold cache, -37% on rep 1, where 3 of the 4 cold Sonnet cache writes of ~57k tokens, about $0.10 each, fell in A). As in round 1, all of the saving is e1-locate and e2-count on Haiku ($0.59 -> $0.02); on r1, f1, d3 and d5, B ran on Sonnet like A ($1.01 vs $0.95), because gate+sc takes max(rule, Jev) and Jev's self-consistency came out Sonnet on all four in both reps (22 of 24 calls; f1 split 2:1, p 0.54-0.71, d5 p 1.0), so the round-2 rule fix (f1, d3 and d5 now haiku by "checked"; r1 already was) never reached a routed tier. B's +322k raw tokens (+9.5%) are noise: 257k come from the four Sonnet-vs-Sonnet pairs (same model, same prompt), where B used 45 model turns against A's 41 and each extra turn re-reads ~57k cached tokens (r1 4->5 in both reps, f1 r1 4->5, d3 r2 6->7, d5 r1 7->8, d3 r1 6->5), and the two Haiku pairs add 65k at 1/20 of the price. The six cases are ones Haiku already solves in the tool's own bench, so they still cannot show whether Haiku-first loses on hard work.

1. **Add a rules-plus-cascade policy that skips the Jev call when the task carries an automatic check.**
   - **change:** `scripts/router.mjs`: add a policy (e.g. `checked`) to `POLICIES` / `combine()` / `route()`. When `features.hasCheck && !features.hard`, it returns `rule.tier` and makes no provider call. Otherwise it behaves as `gate+sc`. Make it the default in `scripts/route.mjs` only when the caller passes `--cascade`, which means the orchestrator promises to run the check and call `--escalate-from` once. `scripts/hook-pretooluse.mjs` stays on `gate+sc`, because nothing runs a cascade on the hook path. Add the orchestrator recipe to `SKILL.md`.
   - **why:**
     - Over two rounds (24 B agents, 72 Jev calls), Jev never lowered a tier and changed no outcome. On the four checked coding cases it only raised the price: Sonnet $0.09-0.19 per run against Haiku $0.004-0.006 here.
     - The tool's own 18-task bench gives rules + cascade 100% cascade pass at 20% of always-opus, against 51% for gate+sc (README §5). Haiku passed f1 and d3 in the pilot ($0.010 / $0.013) and r1 in the Haiku-first run.
     - The one task where Jev was right (d5-deps, a spec-literal slip on Haiku) is caught by the cascade for about $0.01 plus one Sonnet retry.
     - A confidence threshold on Jev is not a substitute. In `bench/results/route-jev.json`, d5 (p 1.0) cannot be told apart from 7 other tasks that Jev sent to Sonnet with p >= 0.96 and Haiku solved (d1, d2, d4, r2, r3, t1, t2).
   - **risk:**
     - `hasCheck` is a regex on the prompt wording. It does not prove that the orchestrator runs the check, so the policy must stay opt-in.
     - A weak check (the visible test passes on subtly wrong work) lets a Haiku error through, which no cascade catches.
     - A Haiku miss costs a wasted attempt plus wall time before the retry (d5 on Sonnet took 53-64 s).
   - **expected effect:**
     - On these six cases, r1, f1, d3 and d5 move to Haiku. B would cost about $0.08 if all pass, or about $0.46 if d5 fails on Haiku and escalates in both reps. That is -70% to -95% against A, instead of -33%.
     - Cascade pass 12/12 expected; first-attempt pass 10-12/12.
     - Each checked route saves 3 Jev calls (p50 ~0.76 s, ~$0.0001).
     - Raw tokens stay about the same (the Haiku runs used as many tokens as Sonnet: 1.18M vs 1.11M on e1/e2). The saving is in price, not in token count.
   - **how to verify:**
     - Unit tests in `test/router.test.mjs`: with a checked prompt, `route()` under the new policy makes zero `decideImpl` calls and returns the rule tier. An unchecked prompt still makes k calls.
     - `bench.mjs score` for the new policy reproduces the rules + cascade row.
     - Then the harder cases of suggestion 2, with B on the new policy and escalation cost counted.

2. **Add harder cases where Haiku can fail, including ones with no automatic check (a new case set, not a repeat of this one).**
   - **change:** add to `bench/tasks/` (each with `files/`, `check.mjs` and hidden tests):
     - (a) 3-4 multi-file stories (4-8 files, explicit ACs) from the parallel-stories flow;
     - (b) 2-3 spec-literal or ambiguous-wording tasks like d5-deps;
     - (c) 2 weak-check tasks, where the test named in the prompt passes but hidden tests or mutants catch subtle errors (the cascade's blind spot);
     - (d) 2-3 code-changing tasks whose prompt names no check (graded by a hidden check). There, rules give Sonnet and only Jev can move the tier (to Opus); this is the one place where the README (§5, line 243) claims Jev is worth paying for.

     Arms: Sonnet; the new `checked` policy with the cascade; `gate+sc`.
   - **why:** 48 of 48 agents passed on the first attempt over two rounds, and the bench pilot shows the same ceiling effect. The only Haiku failure ever observed is d5-deps, once. Nothing yet measures the cost of a Haiku miss with its retry, nor any value of Jev.
   - **expected effect:** no direct cost change. The case set gives Haiku's first-attempt failure rate, the cascade's total cost including retries, and whether Jev's raise to Opus helps on unchecked tasks. That decides between suggestion 1 alone and removing Jev completely.
   - **how to verify:** the set is useful only if at least one Haiku attempt fails its check. If none fails, the cases are still too easy. Report first-attempt pass, cascade pass and cost with retries per arm.

3. **Stop counting product names like "Node.js" as files.**
   - **change:** `scripts/router.mjs` `FILE_RE` / `ruleFeatures`: do not count capitalised product names ending in `.js` (`Node.js`, `Next.js`, `Vue.js` and similar) as files, for example by stripping `\b[A-Z][a-z]+\.js\b` before counting, as `GLOB_RE` already does for globs.
   - **why:** fix-notes "Not done": "Node.js" in the bench wrapper still counts as a file, so t1 and t2 stay on Sonnet by rules even though Haiku passed them (t2 cost $0.010 on Haiku vs $0.198 on Sonnet). In the measured prompts it adds a phantom file: r1 names no file and has `files: 1`; f1, d3 and d5 have `files: 2`. As a result, one more real file name in a prompt drops the "checked" rule (`files <= 2`).
   - **expected effect:**
     - Under suggestion 1, t1 and t2 move to Haiku (bench rules-only exact tier 13 -> 15, and a lower cost row).
     - More headroom before "checked" stops firing on real two-file stories.
     - No change for the six cases measured here.
   - **how to verify:**
     - A unit test: "Use Node.js (`node`)" with no file named gives `files: 0`.
     - Re-run `bench.mjs route --provider none`, and keep the pin test in `test/bench.test.mjs` passing against the new `route-none.json`.

4. **Make self-consistency fail safe when a provider call errors.**
   - **change:** `scripts/router.mjs` `consistency()`: if any of the k answers is an error, the result is not stable and takes the highest answered tier, or `null` (keep the default model) when fewer than 2 calls answered. Change the test at `test/router.test.mjs:72`, which currently pins `[{error}, {tier:'haiku'}] -> haiku`.
   - **why:** this is round-1 Major 4, still open ("Suggestions 3 and 4 out of scope" in fix-notes). After suggestion 1, Jev decides only unchecked tasks, where no cascade catches an under-route. A single haiku answer next to two timeouts is then the riskiest path left.
   - **expected effect:** no change in cost or pass rate in normal runs (all 36 calls this round answered). No silent under-routing when Jev is slow or down.
   - **how to verify:** unit tests for 1-of-3 and 2-of-3 errors.

**Not proposed.**
- (b) Removing Jev completely ("rules only") is supported only for checked tasks, which is suggestion 1. On unchecked code-changing tasks the rules already give Sonnet, and Jev's only possible effect is a raise to Opus, which nothing has measured yet (suggestion 2 d).
- Hygiene items, with no effect on cost or pass rate, to do in the same rework but not ranked:
  - fix-notes "Jev answers unchanged" wording;
  - README latency (566 ms p50, max 1692 ms) and per-call cost (~$0.00003);
  - the pin test covering only `route-none.json` and not `why`;
  - `route.mjs` appending to the user's router log during bench runs (and `log: ''` being dropped by `loadConfig`);
  - a SKILL.md note that `route()` is shared by the hook, `govern.mjs` and `mine-history`.

**Measurement notes for the next run (scripts of this report, not the tool).**
- Cold cache writes decide part of the cost gap. Warm each model's cache with one throwaway agent before the measured runs, or report cost with cache writes split out. Launching B first in rep 2 did not balance it, because rep 2 had no cold writes at all.
- `build_results.mjs` hard-codes `escalated: false` and `escalations: 0` and never reads `<case>.B.r<n>.esc` runs. In `subagent_usage_local.mjs`, the new `.` terminator also matches `<case>.B.r<n>.esc`, so the first attempt of an escalated case would get "2 transcripts match" and null usage. Fix both before measuring suggestion 1, where escalations are expected.
- Output tokens look under-counted (Haiku 38-59 output tokens for 5-9 tool calls). Both collectors keep the first usage record per message id, which may carry a partial `output_tokens`. The effect on price-weighted cost is small (output is under 5% of a run's cost), but the `outputTokens` fields should not be quoted as-is.
