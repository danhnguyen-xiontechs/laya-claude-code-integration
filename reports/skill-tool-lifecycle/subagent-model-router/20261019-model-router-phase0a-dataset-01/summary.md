# Phase 0A summary (0A-v1)

Status: built by build.mjs, checked by verify.mjs. No model was called. Gate 0A is for the user. Phase 0B has not started.

## What the set holds
- 45 tasks: 18 bench, 6 r4 weak-check cases, 21 real stories (no outcomes).
- Held-out: 0 tasks. Every task with outcomes was already used in earlier rounds (split.json).
- Reserve for 0B (unlabelled): 21 real stories.

## Coverage
- Automatic check present: 24 tasks. Criteria only (no check): 0. Neither: 21.
- Criteria mapped to checks: 0 of 45 (unknown for all).
- haiku: 62 runs (57 pass, 5 fail, 0 unscored); conditional 0
- sonnet: 83 runs (83 pass, 0 fail, 0 unscored); conditional 4
- opus: 6 runs (6 pass, 0 fail, 0 unscored); conditional 0
- Tasks with recorded cost: 24 of 45. Real stories have no cost.

## minimum_sufficient_tier
- Concludable for 0 of 45 tasks. The reason is criteria coverage, which is unknown for every task.
- Count-rule candidates (not labels, shown only for Gate 0A): d1-lru -> haiku, d3-maplimit -> haiku, d4-expr -> haiku, d5-deps -> sonnet, e1-locate -> haiku, e2-count -> haiku, f1-paginate -> haiku, r1-rename -> haiku.

## Caveats
- Round-5 label sets (6 tasks, all haiku) are kept as prior labels. They are not minimum_sufficient_tier.
- Escalation rows are conditional on a haiku failure and are counted separately.
- Round-5 workflow rows are aggregates. 16 of 16 matched bench attempts within 1e-6.
- Bench task outputs are not in raw-sources.json (size).
- Not in scope: other skills' report folders, story-batch-planner/real, r4 ref/ solutions.
