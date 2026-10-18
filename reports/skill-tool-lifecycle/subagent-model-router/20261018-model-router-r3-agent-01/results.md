# Round 3: subagent-model-router, checked policy (cascade) vs all-Sonnet

Experiment `20261018-model-router-r3-agent-01`, branch `claude/model-router-round3`, based on the round-2 code (`claude/model-router-round2`, commit `1d0d389`) as the user asked. The retro brief said to branch from `main`; this run did not, so the round-3 diff contains only the round-2 code plus this round's changes.

## What changed (scripts/, test/)

1. `checked` policy in `scripts/router.mjs`. For a task with an automatic check (`hasCheck`) and no hard verb, `route()` returns the rule tier and makes **no provider call** (`applied: rules`, `providerCalls: 0`). Any other task gets gate+sc. `route.mjs --cascade` sets this policy unless `--policy` is given. The PreToolUse hook is unchanged: it still forces `policy: rules` with no provider, as before in the hook path.
2. Product names with a `.js` suffix (`Node.js`, `Next.js`, `Vue.js`, a fixed list) are stripped before `FILE_RE` counts files. `App.js` and `src/Node.js` still count.
3. Tests: 4 new unit tests (product names; checked skips the provider; checked with an unchecked or hard task still asks k times; `combine` checked). `test/bench.test.mjs` pinned `bench/results/route-none.json`; regenerated with `bench.mjs route --provider none`. The only changed rows are t1-slugify-tests and t2-csv-tests, now haiku.
   - `node --test "test/*.test.mjs"`: 36 pass, 0 fail (`unit-tests.json`).

## Setup

- Cases: the six round-2 cases (e1-locate, e2-count, r1-rename, f1-paginate, d3-maplimit, d5-deps) plus two bench tasks with hidden tests, d1-lru and d4-expr. 8 cases x 2 arms x 2 repetitions = 32 agents, plus 2 escalations.
- Arm A: every case agent on `sonnet`. Arm B: the tier from `route.mjs --cascade --mode apply --provider jev --k 3`, then one escalation on a failed check (`route.mjs --escalate-from haiku` -> sonnet, fresh work folder).
- Effort `high` for all case agents (quota mode; round 2 used xhigh). Same prompt text in both arms; the only difference is the model.
- B routing: 6 cases were routed by rules only (`checked`, 0 provider calls); e1-locate and e2-count have no check, so they went through gate+sc (3 Jev calls each, agreed on haiku). All 16 B first attempts were haiku.
- Grading: each case's own `check.mjs` in the work folder, run by a script, never by the agent's claim. Answer keys are not in the work folders.
- Usage: `evidence/subagent-usage.json` (from transcripts, 34 of 34 matched once, no nulls). The collector's period terminator is fixed in `subagent_usage_local.mjs`, so `<case>.B.rN.esc` no longer matches `<case>.B.rN`.
- Price: Haiku 0.10/0.50 USD per MTok, Sonnet 2/10, so Haiku is **1:20** of Sonnet per token (input, output and cache read at 0.01 vs 0.20). Cache writes at 1.25x input (`scripts/pricing.mjs`). Cold cache writes are not balanced between arms (A's first runs of a case wrote more). Costs are in `evidence/cost.json`.

## Results

| | A: all Sonnet | B: checked cascade |
|---|---|---|
| Pass, final (after escalation) | 16/16 | 16/16 |
| First-attempt pass | 16/16 | 14/16 (d5-deps failed in both reps) |
| Agent runs (incl. retries) | 16 | 18 (2 escalations to Sonnet) |
| Price-weighted cost, incl. retries | $1.682 | $0.298 (first attempts $0.111 + escalations $0.187) |
| Price change | | **-82%** |
| Raw tokens (all, incl. cache reads) | 3.78M | 6.86M (+81%) |
| Model turns (sum) | 63 | 106 |

Per case, price-weighted: e1-locate $0.242 -> $0.008; e2-count $0.246 -> $0.010; r1-rename $0.161 -> $0.009; f1-paginate $0.151 -> $0.009; d3-maplimit $0.181 -> $0.016; d5-deps $0.188 -> $0.202 (worse: two Haiku misses plus two Sonnet escalations); d1-lru $0.223 -> $0.024; d4-expr $0.290 -> $0.019.

## Reading

- The cascade keeps the pass rate at 16/16 and cuts price-weighted cost by about 82% on this set. The saving comes from Haiku on the seven cases where it passed first time.
- d5-deps (spec-literal ordering with error messages) is the one Haiku miss, 2 of 2 reps, the same case as in round 2. Escalation to Sonnet fixed it both times, but d5 costs more than all-Sonnet on B ($0.20 vs $0.19), because the wasted Haiku attempt is paid for. The cascade catches a Haiku miss only when the check is good enough; d5's hidden test is.
- The two harder cases (d1-lru, d4-expr) passed on Haiku first time in all 4 B runs. So the set still does not show Haiku failing a hard coding task, except d5. That is the main limit of this round.
- Raw tokens went up (+81%) and model turns went up (63 -> 106), mostly on the Haiku B arms (d3 B 7-9 turns vs A 4; d1 B 9-10 vs A 5). Haiku needed more turns and each turn re-reads the cached prompt. The price-weighted saving is still large, because a Haiku turn costs 1/20 of a Sonnet turn. Report the price, not the raw token count, as the saving.
- Jev was called only for e1-locate and e2-count (6 calls, not in either arm's cost). On the six checked tasks Jev was never called, which is the intended effect of `checked`.

## Limits

- 8 cases, 2 repetitions. Small sample; one case (d5) decides the escalation result.
- Weak checks were not tested (a passing check on subtly wrong work is invisible to the cascade). The brief's suggestion 2 (c) is not covered.
- Cache writes were not balanced across arms or repetitions (the run order was not randomised; the cache-write totals are in `evidence/subagent-usage.json`).
- Orchestrator tokens are not counted. Escalation was done by hand, following the recipe, not by an automated orchestrator.
- The brief's read-only Haiku review of the diff was not run (quota mode). The diff was checked by me only, with the 36 unit tests and the arm-B routing records; no independent review was done.
- No Opus call was made in this round.

## Verdict

The checked cascade is a strong opt-in saving on tasks with a good automatic check: -82% price-weighted, 16/16 final pass, and the failure mode (Haiku misses) is caught by the check. It is not free on spec-literal tasks like d5-deps. Recommendation for the user's review: keep `checked` opt-in (`--cascade`), keep the hook on gate+sc, and add a harder set with weak checks before making it the default.

Not run: no `finalDecision` recorded; the Gate B decision is the user's.
