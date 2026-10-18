# Retro idea brief: subagent-model-router, round 2 (20261018-model-router-r2-agent-01)

**Baseline (frozen, not edited):** [20261018-model-router-agent-01](../20261018-model-router-agent-01/) — REWORK. Both arms 12/12; B cost $0.97 vs $1.51 for all-Sonnet (-35%), and the whole saving came from the two lookup cases sent to Haiku.

**Question this run answers.** The round-1 review asked for two fixes: pin `ruleTier` to the committed benchmark with a test, and make the "checked" rule ignore test globs (`test/*.test.mjs`). This run applies both (commits `3ee2749` and `8974a9e` on `claude/model-router-round2`, the second fixing a Major found by review: bold file names were read as globs). Then it asks: on the same six cases, same design, does the router still pass as many cases as all-Sonnet, at a lower price-weighted cost, and do the routed tiers change?

**Hypothesis.** The checked-rule fix moves f1-paginate, d3-maplimit and d5-deps from the rules' Sonnet to Haiku, so the saving should grow (r1-rename was already Haiku by rules). Under the measured policy (gate+sc, which takes the maximum of the rules and three Jev votes), Jev still votes Sonnet for all four (r1-rename included), so the routed tier should not change.

**Success criteria (unchanged from round 1, fixed before data).** B passes every case A passes, after the cascade; B's price-weighted cost is lower than A's. Escalations are reported (none happened in round 1).

**Design.** Same as round 1 ([design.md](design.md)): A = every case agent on Sonnet; B = the tier `route.mjs --mode apply --provider jev --policy gate+sc --k 3 --type <task type>` returns for that exact prompt (Jev live). Effort xhigh. Two repetitions, 24 case agents. Price-weighted cost uses the tool's own table (`scripts/pricing.mjs`): Haiku 0.1 input / 0.5 output per MTok, Sonnet 2 / 10, so one Haiku token costs 1/20 of a Sonnet token.

**Exception kept from round 1:** the case agents' model is the variable, so the retro brief's "Haiku for every case" rule does not apply to this tool.

**Non-goals.** No change to the Jev policy, the cascade, or the self-consistency error handling (suggestions 3 and 4 of round 1). The PreToolUse hook and the governor are not measured.
