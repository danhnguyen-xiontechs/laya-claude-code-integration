# Capsule P3: context-governor / 20261018-context-governor-01

Follow `.claude/skills/build-skill-tool-workflow/phases/phase-3-measure.md`. This capsule is all the context you get: no earlier chat. Do not ask the user for gate decisions; stop and hand back instead.

## Setup
- Experiment folder: `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01`
- Tool: context-governor (plugin, engine none)
- Branch: `claude/confident-meninsky-1f66fb`, commit: `not set`
- Status: DESIGN_READY; model: Haiku 5.5, effort xhigh (main model); case agents `haiku-case`, at most 4 in flight; smart-context-trimming: off (SMART_TRIM_MODE=observe)
- Gate A: approved 2026-10-18T12:57:54.651Z

## Tests
- unit: `node --test "tests/*.spec.ts" (cwd context-governor/; Node v24.11.1)` (last: 11 pass, 0 fail)
- integration: `claude plugin test ./context-governor (Claude Code 2.1.300; tests/engine.test.ts)` (last: 6 pass, 0 fail)
- smoke: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p --plugin-dir ./context-governor --model haiku "reply ok" (real headless turn; metrics and state files checked by hand under ~/.claude/context-governor)` (last: 1 pass, 0 fail)
- typecheck: `tsc -p context-governor/tsconfig.json` (last: 0 pass, 0 fail)
- replay: `node context-governor/scripts/replay.mjs --date 2026-10-18 --control <id>` (last: 0 pass, 0 fail)

## Artifacts to read (paths only, read what the phase file asks for)
- `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01/idea-brief.md`
- `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01/design.md`
- `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01/context-pack.md`
- `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01/unit-tests.json`

## Goal (from idea-brief.md)
# Idea Brief — context-governor

- Experiment: `20261018-context-governor-01` (Track N, first run of workflow v2)
- Status: APPROVED_FOR_IMPLEMENTATION
- Kind: plugin (function hooks), no Jev/Laya in v1

## Problem
One build-skill-tool-workflow control session on 2026-10-18 went past 200M tokens of cache read + write. Cache read grows with **context length × model turns**. Nobody watches the context length while the session runs. The total only shows up afterwards, and by then the session has carried hundreds of thousands of tokens of old logs, reports and diffs through every later turn.

## Current baseline
- Plain Claude Code auto-compacts only near the model's window (~967k on a 1M model). Nothing warns earlier.
- The user notices by hand, or not at all. `/fast-compact` exists in this repo (verbatim compaction, no summary), but only helps when someone remembers to run it.

## Hypothesis
A cheap, rules-only warning at fixed context thresholds, plus a warning when many turns pass without a new artifact, makes the user or the agent compact or hand off earlier. That lowers peak context and total cache read per session without interrupting work.

## Proposed intervention
- A plugin folder `context-governor/`, loaded with `claude --plugin-dir ./context-governor`. It never touches `.claude/settings.json`.
- A **Stop** hook runs after each assistant turn. It reads the session transcript tail and takes the last turn's usage: context = input + cache_read + cache_creation.
- **Rules (configurable):**
  - Context ≥ 120k: a soft note suggesting a checkpoint.
  - Context ≥ 200k: a strong note suggesting `/fast-compact` or a phase handoff (`make_capsule.mjs`).
  - More than 15 turns since the last write under the active experiment folder: a "logs are piling up" note.
  - At most one note per threshold crossing, no repeats every turn.
- **v1 only warns.** It never blocks a turn, never compacts and never ends a session. Forcing anything waits until the user has checked the behaviour.
- **Metrics:** each turn's context length is appended to `~/.claude/context-governor/<session>.jsonl`, which feeds `phase_usage.mjs`.

## JEV/Laya role
None in v1. Thresholds are rules. A model call would cost more than the warning saves.

## Alternatives considered
- **Statusline only:** visible, but the agent never sees it and it gives no advice.
- **Auto-compact at a lower `autoCompactWindow` for the main session:** a blunt instrument, and it summarises (loses detail) instead of letting
[… clipped, read the file for the rest]

## Measurement
- Design frozen: 2026-10-18T13:20:10.817Z
- Cases: ?, repetitions: ?

## Done when
Every case run in both arms (and repetitions) on the commit below; `results.json` per arm and run, evidence saved, `build_tool_report.mjs` run once so `summary.json` exists. Hand back in 5 lines or fewer.

Keep output quiet: scripts print one line, git with `-q` and `-c core.safecrlf=false`, long output through `| tail -n 5`; never paste diffs or logs into chat.
