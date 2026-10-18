# Capsule P4: context-governor / 20261018-context-governor-01

Follow `.claude/skills/build-skill-tool-workflow/phases/phase-4-review-fix-report.md`. This capsule is all the context you get: no earlier chat. Do not ask the user for gate decisions; stop and hand back instead.

## Setup
- Experiment folder: `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01`
- Tool: context-governor (plugin, engine none)
- Branch: `claude/confident-meninsky-1f66fb`, commit: `not set`
- Status: EVALUATION_BLOCKED; model: Haiku 5.5, effort xhigh (main model); one Opus review subagent with a closed pack; smart-context-trimming: enforce for fixes, off for any re-measure
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
- `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01/agent-review.json`
- `reports/skill-tool-lifecycle/context-governor/20261018-context-governor-01/improvements.md`

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

## Results
- `summary.json` missing: run P3 first.

## Review findings
- 10 total, 10 accepted by the user to fix, 0 undecided.
- FIX [Critical] The gate cannot see most of the control session's cost. The amended t* (first crossing from below) skips turns 1 to about 129, which ran at 657k to 953k and carried most of the 108M cacheRead, yet the denominator still counts all 220 turns. After t173 the avoided amount is capped at about (200k-47k)
[… clipped, read the file for the rest] (context-governor/scripts/replay.mjs (tStar, ratio); design.md §5) → Give the stretch that is already above 200k at the window start its own row, or pull in the earlier turns of the conversation. Compute the numerator and the denominator over the same turns.
- FIX [Major] The numerator and denominator use different units. Avoided is counted in context tokens (input + cache_read + cache_creation), but the denominator is cache_read only. That is why the literal formula could reach 121.4%. (context-governor/scripts/replay.mjs (avoided vs cacheRead)) → Count both in cache_read, or both in context tokens. Report the creation share separately.
- FIX [Major] The gate formula was changed after its result was known. The literal version gave 121.4%, the amended one 6.7%. Either way the metric is not pre-registered. (design.md §5 amendment; capsule deviation (d)) → Freeze the formula, sessions and threshold in writing before the next replay run.
- FIX [Major] The `timestamp starts with the date` filter cuts the control session at midnight. The control session continues an earlier conversation, so its real 200k crossing and most of its cost fall outside the window. Reviewer note: not verified in this session; the brief's >200M against 108M here is consist
[… clipped, read the file for the rest] (context-governor/scripts/replay.mjs (turnsOf)) → Replay the session's whole history, ignoring date. Check whether the timestamps are UTC or local time.
- FIX [Major] If the state write fails, a note is still shown (deviation a). The armed flags never persist, so the strong toast or text fires again on every turn above 200k. (context-governor/hooks/context-governor.ts (inner try); deviation (a)) → Keep an in-memory armed cache per session as a fallback, or suppress notes after the first failed write.
- FIX [Major] When the session id cannot be read, it falls back to 'unknown'. All such sessions then share one state file and one metrics file, so the armed flags and counters leak between sessions. (context-governor/hooks/context-governor.ts (sessionId)) → When the id is unknown, skip writing state and metrics; or key the files by transcript path.
- FIX [Minor] When usage is missing and the session-usage fallback fails, context is set to 0. Both thresholds re-arm on that, so the next real turn repeats the notes. Separately, slow > 200 ms suppresses the result text but the toast still shows, while design §3 says a slow hook takes no other action. (context-governor/hooks/context-governor.ts (context, slow)) → When context is unknown, skip decide. Make slow log-only.
- FIX [Minor] The stale counter resets even when a soft or strong note in the same turn swallows the stale note, so that stale note is lost. The stale rule is also never exercised by the replay (artifact is always null). (context-governor/src/core.ts (stale branch); context-governor/scripts/replay.mjs) → Reset the counter only when the stale note is actually shown. Add replay runs with an artifactDir set.
- FIX [Minor] The tests are weak or synthetic. The toast and the jsonl context sum are not asserted in engine.test (deviation b), tsc was never run against the 21.5k-line generated .d.ts, and the latency test runs in a harness without fs. The only real-data check is the same-day replay. (context-governor/tests/engine.test.ts; unit-tests.json) → Run tsc via npx. Assert the toast. Add one replay fixture from a different day as a held-out check.
- FIX [Suggestion] No coupling to Jev or Laya and no secrets are visible in the pack. The note text does depend on /fast-compact and make_capsule.mjs, and subagent cacheRead is left out of the cost (51 subagent turns, 14 flagged). Uncertain: io.ts was not shown to the reviewer. (context-governor/src/core.ts (noteText); context-governor/scripts/replay.mjs) → Make the note text configurable. Report subagent cacheRead on a separate line.

## Done when
Without accepted findings: Opus review saved to `agent-review.json` (+ `improvements.md` if the result is bad), then stop and hand back the findings. With accepted findings: fixes committed, tests re-run, affected cases re-measured if behaviour changed, both reports rebuilt. Hand back in 5 lines or fewer.

Keep output quiet: scripts print one line, git with `-q` and `-c core.safecrlf=false`, long output through `| tail -n 5`; never paste diffs or logs into chat.
