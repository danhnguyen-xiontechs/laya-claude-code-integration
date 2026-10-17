# Idea Brief — story-batch-planner, retrospective agent run

- **Experiment ID:** `20261017-sbp-agent-01`
- **Status:** retrospective measurement of a tool that is already implemented (tool last changed at commit `73c4bda`, repo HEAD `7849acd`, branch `main`). No new Gate A decision is recorded here; `approvals.ideaApprovedAt` is not set. The final decision belongs to the user (Gate B).
- **Tool:** `.claude/skills/story-batch-planner/` (`scripts/planner.mjs`, `scripts/plan.mjs`, `scripts/decision-provider.mjs`, `config.json`, `test/planner.test.mjs`)
- **Owner:** orchestrator (run by a delegated agent)
- **Date:** 2026-10-17

## Problem
Before spawning one agent per story, someone has to decide which stories can run in parallel and in what order. Today plain Claude reads the batch JSON and decides by hand. It can miss a hard order (an endpoint producer that a consumer needs), a shared DTO or migration, or a dependency cycle.

## Current baseline (arm A)
Plain Claude reads the raw batch JSON and answers `{"waves": [...], "needs_decision": [...]}` with one line of reasoning. No planner, no Jev.

## Hypothesis
If Claude also runs the planner (`plan.mjs --summary`: explicit links, contract producer→consumer edges, shared files/DTOs, migrations, cycles, Jev shadow on ambiguous pairs), the planner's wave plan avoids the ordering and conflict mistakes plain Claude makes on these fixtures. The token cost of the extra tool output is measured, not assumed.

## What the tool decides vs what Claude decides
- Tool (deterministic rules): edges, cycles, blocked stories, incomplete stories, waves. The waves are the planner's output.
- Jev (shadow only): labels ambiguous pairs. The answer is stored as `jev_suggestion` with `applied: false` and never changes the waves. Invalid, timeout, error or over-budget → `unknown`, which serialises the pair and flags it for review.
- Claude (both arms): writes the final JSON answer. In arm B it may follow or ignore the planner summary.

## Success criteria (fixed before any data)
- Per case: the hard invariants in `design.md` hold (checked by `grade.mjs`, not by the agent's own claim).
- No case passes in A and fails in B; any such case is named in the headline.
- Tokens reported A → B for the paired cases.
- Directional only: 4 cases, 1 repetition.

## Alternatives
| Alternative | Expected benefit | Cost / risk | Why measured or not |
|---|---|---|---|
| Plain Claude (arm A) | none extra | may miss hard orders | measured as the baseline |
| Rules only (planner with Jev off) | no network | not the live tool | not measured here; the tool's `bench/eval.mjs` covers rules vs Jev over all fixtures |
| Jev decides per pair | none | per-pair calls, no deterministic order | not applicable: the planner keeps Jev as shadow |

## Scope and non-goals
- In scope: fixtures 03-api-dto, 04-migration, 06-explicit, 07-cycle; one Haiku subagent per case per arm; the tool's unit tests; one independent read-only review.
- Out of scope: the 8-fixture `bench/eval.mjs` scoring, Jev vs Laya, dispatch through subagent-model-router, a hook, a second repetition, `build_main_report.mjs` (run by the orchestrator), committing or pushing.

## Risks
| Risk | Likelihood / impact | Mitigation and test |
|---|---|---|
| 4 cases x 1 repetition is too few to separate the arms | high / high | results labelled directional; no adoption claim |
| Jev is live only on the ambiguous pairs of 03 and 06 (04 and 07 have none) | certain / medium | stated in deviations; Jev calls counted per case |
| Arm B prompt has one extra sentence (the planner line) | certain / low | the planner line is the treatment itself |
| Fixture 06: S-4 links to OPS-99 (outside the batch); an agent may hold S-4 back | medium / low | the fixture expects S-4 scheduled; kept as expected and listed in deviations |
