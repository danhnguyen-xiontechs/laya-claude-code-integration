# Final decision: subagent-model-router, round 5 (Jev policy)

**Gate B: ADOPTED (user, 2026-10-19).** The checked default for the Jev provider is accepted. Per the user's instruction it is **not yet merged or committed**; the change sits in the working tree (`scripts/router.mjs`, `test/router.test.mjs`, `bench/bench.mjs`, `bench/results/route-jev.json`) and stays there until the user asks for a commit.

## What changed
- `scripts/router.mjs` `loadConfig`: when the provider is `jev` and no policy is set, the default policy is `checked` (was `gate+sc`). Provider `none` still defaults to `rules`.
- `test/router.test.mjs`: default-with-provider assertion now expects `checked`. Unit tests 36/36 pass.
- `bench/bench.mjs`: new `checked+jev` row in `ROUTERS`. `bench/results/route-jev.json` regenerated with live Jev (k=3).

## Offline gate (before any agent spend)
Replay on the 6 recorded bench tasks (`evidence/offline-score.json`):

| router | pass | cost vs opus | exact tier |
|---|---|---|---|
| always-sonnet | 6/6 | 0.609 | 0/6 |
| rules-only | 6/6 | 0.134 | 5/6 |
| jev+gate+sc (old default) | 6/6 | 0.606 | 1/6 |
| checked+jev (new default) | 6/6 | 0.134 | 5/6 |

The 0.235 figure in the idea brief was from before `route-jev.json` was refreshed. The current figure is 0.134.

## Live A/B (4 cases x 2 repetitions)
Cases: d5-deps, f1-paginate, d3-maplimit, r1-rename. Pass = the task's own `check.mjs`, run on the work folder.

| arm | pass (final) | pass (first try) | price-weighted cost | Jev calls |
|---|---|---|---|---|
| A: sonnet, no router | 8/8 | 8/8 | $0.869 | n/a |
| B: checked default + cascade | 8/8 | 6/8 | $0.244 (-72%) | 0 |

- B first tries: f1-paginate, d3-maplimit and r1-rename passed on Haiku in both repetitions. d5-deps failed on Haiku in both repetitions and passed on the Sonnet retry (`--escalate-from haiku`) at $0.1026 and $0.1052. Those retries are in B's cost.
- Cost: `evidence/cost.json`, price-weighted from subagent transcripts.
- Raw tokens are about the same: A 3.10M, B 3.14M (+1%, because the d5-deps retries add a full Sonnet session). The saving is in price, since Haiku costs about 1/20 of Sonnet per token. The report's token card is unweighted and shows no drop.

## Decision rule (frozen in design.md)
- ADOPT as a candidate: B's pass rate at least A's, and B's price-weighted cost lower, with 0 Jev calls on checked tasks. **Met**: 8/8 vs 8/8, $0.244 vs $0.869, 0 Jev calls.
- PILOT would apply if the cost difference were within noise. It is not (about 72%, against about 10% noise seen in round 1).
- REWORK would apply if B missed a check A passes. It did not, after the cascade.

## Caveats for Gate B
1. **Small sample.** 4 cases, 2 repetitions, all small tasks. Round 4 showed these cases are easy.
2. **First-try quality is lower.** B failed d5-deps on Haiku in 2 of 2 runs. The cascade fixed both, so the final pass is 8/8, but the first-try pass is 6/8. The rule counts the cascade as part of B, as designed.
3. **Jev is not exercised live here.** Checked tasks never call Jev. The live evidence covers only the rule tier plus cascade. The offline gate covers Jev on tasks without a check only indirectly (all 6 offline tasks have checks).
4. **Unchecked tasks are untested.** The new default still asks Jev on tasks with no automatic check. Their quality, and whether Jev helps there, is not measured.
5. **Not addressed:** the `consistency()` rule (unstable votes go to the highest tier) and the rule tier for design-kind tasks (checked gives them haiku).
6. **Process deviations:** P2 and P3 ran in the control session, not in fresh phase sessions. Arm A was not checked with `subagent_usage.mjs --forbid`. Raw token counts were not recomputed for this round. See `manifest.json` `evaluation.deviations`.

## Suggested next step (for the user)
- Accept or reject the candidate at Gate B.
- If accepted: a follow-up round on unchecked tasks with Jev live, and a fix for the d5-deps first-try failure (for example a stronger rule for dependency work), before any merge.
