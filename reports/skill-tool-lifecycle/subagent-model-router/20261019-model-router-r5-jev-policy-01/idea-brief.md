# Idea brief: subagent-model-router, round 5 (Jev policy)

**Track E** (tool exists). P1 is N/A (existing tool). Baseline: `20261018-model-router-agent-01` (REWORK) and the offline bench in `.claude/skills/subagent-model-router/bench/`.

## Problem
With Jev applied, the router's default policy `gate+sc` asks Jev k=3 times on every subagent prompt. The round-1 result and the offline bench both show that Jev costs more than it saves:
- Jev almost always answers `sonnet`, and gate = max(rule, Jev) can only raise a tier. Jev picked the cheapest passing tier in 1 of 6 bench tasks (rules-only: 4 of 6).
- Self-consistency: when the three Jev answers disagree, `sc` takes the highest tier (d3-maplimit: sonnet / opus / sonnet → opus).
- Offline replay on the 6 bench tasks that have runs for all three tiers (recorded in `bench/results/runs-pilot.jsonl`; `route-jev.json`), price-weighted, opus = 1:

| router | pass (first try) | cost vs opus | exact tier |
|---|---|---|---|
| always-sonnet | 6/6 | 0.609 | 0/6 |
| rules-only | 6/6 | 0.235 | 4/6 |
| jev+gate+sc (current Jev default) | 6/6 | 0.606 | 1/6 |
| checked+jev (candidate, below) | 6/6 | 0.235 | 4/6 |

## Idea
Jev is consulted only where no automatic check exists. For tasks with an automatic check, the rule tier is used and the cascade (one escalation on a failed check) is the safety net. This is the existing `checked` policy (`scripts/router.mjs`), which is not yet the default for the Jev provider. Jev stays for tasks without a check, where no cascade can catch a miss, which is where the README says Jev is needed.

## Question this run answers
Does making `checked` the default for the Jev provider keep the pass rate of the live Jev arm and lower its cost against plain sonnet, on cases where plain Claude can fail?

## Limits known now
- The offline table is 6 tasks, all with a check, so it says nothing about unchecked tasks. Pass rates are the same on all routers, so it does not test a quality gap.
- Round 4 showed that the cases in this set are too easy: Haiku passed the strict check first time.
- Not in scope: the `consistency()` rule (unstable votes go to the highest tier), and the rule tier of design-kind bench tasks (`checked` gives them haiku). Both are noted for a later round.
