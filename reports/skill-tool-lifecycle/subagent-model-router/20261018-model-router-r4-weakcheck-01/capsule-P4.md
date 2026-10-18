# Capsule P4: subagent-model-router / 20261018-model-router-r4-weakcheck-01

Follow `.claude/skills/build-skill-tool-workflow/phases/phase-4-review-fix-report.md`. This capsule is all the context you get: no earlier chat. Do not ask the user for gate decisions; stop and hand back instead.

## Setup
- Experiment folder: `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01`
- Tool: subagent-model-router (skill, engine none)
- Branch: `claude/model-router-round4`, commit: `52f6583`
- Status: MEASURED; model: Haiku 5.5, effort xhigh (main model); one Opus review subagent with a closed pack; smart-context-trimming: enforce for fixes, off for any re-measure
- Baseline experiment: `20261018-model-router-r3-agent-01`
- Gate A: approved N/A (existing tool, Track E; question chosen by the user 2026-10-18)

## Tests
- unit: `node --test "test/*.test.mjs" (in .claude/skills/subagent-model-router, node v24.11.1)` (last: 36 pass, 0 fail)
- offline-gate: `node scripts/offline_gate.mjs` (last: 6 pass, 0 fail)

## Artifacts to read (paths only, read what the phase file asks for)
- `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/idea-brief.md`
- `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/design.md`
- `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/unit-tests.json`
- `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/summary.json`
- `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/report.html`

## Goal (from idea-brief.md)
# Idea Brief: subagent-model-router, round 4 (weak checks, harder cases)

- Experiment: `20261018-model-router-r4-weakcheck-01` (Track E, P1 `N/A (existing tool)`)
- Baseline experiment: `20261018-model-router-r3-agent-01` (PILOT, user 2026-10-18)
- Tool under test: the `checked` cascade policy (`route.mjs --cascade`), unchanged from main `52f6583`
- Question chosen by the user: "Check yếu + ca khó" (2026-10-18)

## Question this run answers
Round 3 showed the cascade keeps 16/16 at -82% price, but only with **good** checks and cases Haiku mostly passes. The cascade escalates only when the check fails, so a **weak check** (passes on subtly wrong work) hides a Haiku miss. Does the cascade still match all-Sonnet on *real* correctness when the check the cascade sees is weak and the tasks are harder?

## Arms
- **A (plain Claude):** every case agent on Sonnet, no routing.
- **B (Claude + router):** tier from `route.mjs --cascade`, then one escalation to Sonnet when the **visible (weak) check** fails. Escalation driven by a script (`run_cascade.mjs` style), not by hand.

## What is measured
- Final correctness on a **hidden strict check** (the agent and the cascade never see it).
- **Silent misses:** visible check passes, hidden check fails. Counted per arm.
- Price-weighted cost incl. escalations (same pricing as round 3: `scripts/pricing.mjs`).
- Raw tokens and turns, reported but not the headline.

## Not in scope
- No change to the router code (P2 builds only the case set, grader and the escalation driver in the experiment folder).
- PreToolUse hook path, Jev gate on unchecked tasks, real stories.

## Measurement
- Design frozen: 2026-10-18T14:42:35Z
- Cases: 6, repetitions: 2

## Results (summary.json)
- Pass A 12/12, B 12/12; paired cases 6; worse cases 0
- Paired tokens A 439437 → B 648395
- Recommendation so far: INSUFFICIENT_EVIDENCE (low)

## Review findings
- none yet: run step 4a (Opus review).

## First step
Add your row to `manifest.phases[]` in `reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/manifest.json`: { "phase": "P4", "cwd": "<your working directory>", "from": "<ISO time now>", "model": "<your model>", "smartTrimMode": "enforce for fixes, off for any re-measure" }. It lets phase_usage.mjs measure this phase.

## Done when
Without accepted findings: Opus review saved to `agent-review.json` (+ `improvements.md` if the result is bad), then stop and hand back the findings. With accepted findings: fixes committed, tests re-run, affected cases re-measured if behaviour changed, both reports rebuilt. Hand back in 5 lines or fewer.

Keep output quiet: scripts print one line, git with `-q` and `-c core.safecrlf=false`, long output through `| tail -n 5`; never paste diffs or logs into chat.
