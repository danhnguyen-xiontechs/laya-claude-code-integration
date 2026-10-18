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
- **Auto-compact at a lower `autoCompactWindow` for the main session:** a blunt instrument, and it summarises (loses detail) instead of letting the user pick fast-compact or a handoff.
- **Session rotator that forces a new session:** too disruptive before the warnings are proven.

## Success criteria (set before evaluation)
- Over the next 2 workflow-v2 rounds compared with the 2026-10-18 rounds (A5 per-phase usage):
  - peak context of the control session ≤ 200k;
  - cache read per round down ≥ 30%.
- 0 interrupted turns or lost work. Hook latency under 200 ms per turn.
- Measurement: per-phase usage from `phase_usage.mjs`. Arm A is a round without the plugin and arm B a round with it, on the same Track E tool.

## Scope and non-goals
- **In scope:** the warn-only Stop hook, thresholds in `userConfig`, the metrics file, and unit tests on synthetic transcripts.
- **Not in scope:** forced compaction, ending sessions, Jev/Laya, and changes to Claude Code itself.

## Risks and mitigations
- **Noisy warnings:** one note per crossing, and thresholds are configurable.
- **Transcript format changes:** the parser is shared with `transcript_usage.mjs` and tested on fixtures; it does nothing on a parse error.
- **Function hooks disabled** (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`): the plugin stays inert. The README explains how to enable them.

## Recommendation
Build v1 as specified (warn only, rules only), using workflow v2: P2 Haiku build, P3 measure, P4 Opus review.

## Human decision
- Gate A: **approved by the user, 2026-10-18**
