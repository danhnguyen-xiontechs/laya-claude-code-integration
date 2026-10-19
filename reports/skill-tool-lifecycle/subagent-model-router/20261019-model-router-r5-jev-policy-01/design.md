# Design: subagent-model-router, round 5 (frozen before any agent run)

## Change under test (P2, only after Gate A)
- `scripts/router.mjs` `loadConfig`: when `provider` is `jev` or `laya` and no policy is set, the default policy is `checked` instead of `gate+sc`. `rules` stays the default for `provider none`.
- `SKILL.md` and README: say the same.
- Hook (`hook-pretooluse.mjs`): unchanged; it already uses rules only.
- Tests: one new test in `test/router.test.mjs`: with provider jev and a task that has a check and no hard verb, `route()` makes zero provider calls and returns the rule tier; a task without a check still makes k calls.
- Bench: add a `checked+jev` row to `ROUTERS` in `bench/bench.mjs` so `bench.mjs score` reports it.

## Offline gate (runs before any agent spend; must pass to start P3)
Replay on recorded runs (`bench.mjs score`, 6 tasks). Pass: pass rate not lower than `jev+gate+sc`, and cost lower. Recorded result: 6/6 vs 6/6, cost 0.235 vs 0.606. Passed.

## Live arms (P3, only if the user approves Gate A)
- **A**: `sonnet` for every case, no router, no cascade.
- **B**: what the new default returns for that exact prompt (`route.mjs --mode apply --provider jev --type <type> --json`), with the cascade (one retry at `--escalate-from <tier>`) on a failed automatic check.
- Cases: 4 from `bench/tasks` that have a real automatic check and that Haiku failed or needed help on in an earlier round (d5-deps, f1-paginate, d3-maplimit, r1-rename). Repetitions: 2. Effort xhigh for case agents. Same cases, model and repetitions for A and B.
- Pass = the task's own `check.mjs`, run by us on the work folder. Hidden tests and solutions never go into a prompt.
- Metrics: pass rate, cost (price-weighted, `pricing.mjs`), tokens, escalations, Jev provider calls (should be 0 for checked tasks).

## Decision rule (frozen)
- ADOPT as a candidate only if B's pass rate is at least A's and B's price-weighted cost is lower, with 0 Jev calls on checked tasks.
- PILOT if pass rates are equal but the cost change is inside run-to-run noise (the 2 repetitions of round 1 varied by about 10%).
- REWORK if B misses a check that A passes.
- No cost is claimed from the offline table alone.

## Deviations to record
- Track E: P1 N/A (existing tool).
- The live arm is not yet run; this file is the design only.
