# design.md: context-governor (v1, warn only)

> Criteria frozen on 2026-10-18 by the user's Gate A approval. P2 and P3 do not change these thresholds or criteria.
> Written by the P1 Opus call (closed pack: idea-brief.md and context-pack.md).

## 1. Contract

**Layout.** The plugin is loaded only with `claude --plugin-dir ./context-governor` and never touches `.claude/settings.json`.
```
context-governor/
  .claude-plugin/plugin.json
  hooks/hooks.json            { "modules": ["./context-governor.ts"] }
  hooks/context-governor.ts   register(): wiring only
  src/core.ts                 pure rules: decide(state, turn, cfg) -> {notes, state}
  src/io.ts                   reads and writes state and metrics, scans artifacts
  tests/core.spec.ts, tests/engine.test.ts
  scripts/replay.mjs          offline gate (imports src/core.ts)
  package.json (type module, node >=22.18), tsconfig.json, types/claude-code.d.ts
```

**userConfig in plugin.json** (every field has a default):

| field | default | meaning |
|---|---|---|
| `mode` | `warn` | `warn` or `off`. `off` writes metrics only and shows no notes. |
| `softTokens` | `120000` | threshold for the checkpoint note |
| `strongTokens` | `200000` | threshold for the compact/handoff note |
| `rearmGapTokens` | `20000` | a threshold re-arms when context falls below threshold − gap |
| `staleTurns` | `15` | main-loop turns with no new artifact before the stale note |
| `artifactDir` | `""` | the active experiment folder. Empty turns the stale rule off. |
| `subagentFlagTokens` | `90000` | marks subagent turns in metrics only. Never produces a note. |

**Event: `on('turn.complete', …)`.**
- The event carries per-turn `usage` and `agentId`. The result `text` is shown to the user beneath the answer and never enters the model context, which matches the warn-only goal.
- Context for a turn = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- If `usage` is missing, the hook falls back to `$.session.usage().context.tokens`.
- `classic.Stop` is not used in v1. Its `additionalContext` reaches the model, and its block/continue rules could cause an extra turn. It is only the fallback if the P2 smoke test shows that `turn.complete` does not fire in a plugin module.

**Subagent turns** (`agentId` set) also fire the hook. They are logged with their `agentId` and flagged in metrics at or above `subagentFlagTokens`. They never produce notes and never move the main-loop counters. Haiku agents must stay under 100k context; they run with autoCompactWindow 98000.

**What the user sees.** The model sees none of this.
- Soft note: `$.ui.log`, shown as a dim notice.
- Strong note and stale note: the result `text`, plus `$.ui.toast`.
- `$.ui.status("ctx 143k / 200k")`, updated every turn.

**State file:** `~/.claude/context-governor/<sessionId>.state.json`, with `sessionId` from `$.session.id()`. Contents: `{ armed: {soft:true, strong:true}, turnsSinceArtifact, lastArtifactMtimeMs, mainTurns }`.

**Metrics file:** `~/.claude/context-governor/<sessionId>.jsonl`, one line per turn. Fields: `{ts, session, turnId, agentId, model, input, cacheRead, cacheCreation, context, output, durationMs, isAborted, notes:[…], hookMs}`. It feeds `phase_usage.mjs`.

## 2. Decision rules (main-loop turns only)

1. **Soft.** If `context ≥ 120000` and soft is armed: show "checkpoint: context Nk, consider writing state to the experiment folder", then disarm soft.
2. **Strong.** If `context ≥ 200000` and strong is armed: show "context Nk ≥ 200k: run `/fast-compact` then `/compact`, or hand off with `make_capsule.mjs` to a fresh phase session". Then disarm strong, and soft too.
3. **Re-arm.** A threshold re-arms when context falls below `threshold − 20000`, for example after a compact. This keeps it to at most one note per crossing.
4. **Stale.** This rule needs `artifactDir` to be set and to exist.
   - Each turn, read the newest file mtime under `artifactDir` (scan depth at most 3, at most 500 entries).
   - If that mtime is newer than `lastArtifactMtimeMs`, reset the counter to 0. Otherwise add 1.
   - When the counter goes past `staleTurns`, show "16 turns without a new artifact: logs piling up?" and reset the counter. The note therefore repeats at most once every 16 turns.
   - `artifactDir` comes from userConfig, overridden by the environment variable `CONTEXT_GOVERNOR_ARTIFACT_DIR`. With neither set, the rule is silently off.
5. If both thresholds are crossed in the same turn, show only the strong note.

## 3. Flag off and failures

- **`mode=off`:** metrics are still written; no notes are shown.
- **Function hooks disabled:** the plugin does nothing. This is acceptable.
- **Errors:** the whole handler is wrapped in try/catch and `.catch(($, e, next) => next())`. On any error it writes nothing, shows nothing and returns no result. It never blocks, compacts or aborts a turn.
- **Corrupt state file:** treated as fresh state.
- **Latency:** `hookMs` is measured and logged. Above 200 ms the hook logs `slow:true` and takes no other action.

## 4. Tests

**core.spec.ts** (node:test, pure functions):
- 119,999 gives no note. 120,000 gives the soft note once; a next turn at 130k gives nothing.
- 200k gives only the strong note; later turns between 180k and 250k give nothing.
- A drop to 95k re-arms soft, and rising back to 121k shows soft again. A drop to 179k re-arms strong.
- A single jump from 50k to 210k gives only the strong note.
- The stale counter resets when a new mtime appears, fires on the 16th turn, then resets.
- An empty or missing `artifactDir` turns the stale rule off.
- Subagent turns give no note, leave the counters unchanged, and are flagged at 90k.
- Missing usage goes through the fallback path.
- `mode=off` gives no notes but still writes the metrics line.

**engine.test.ts** (`expect`, `mock` and `test` from `claude-code/testing`, same pattern as smart-context-trimming):
- `turn.complete` with usage at 210k returns a `text` that contains "200k", and the toast is called.
- When the handler throws, no result is returned and the turn completes.
- A jsonl line is appended with the correct `context` sum.
- The `$.session.usage` mock is used when `usage` is absent.
- An event with `agentId` returns no text.
- Latency: 100 synthetic turns, each under 200 ms.

## 5. Offline gate (before any agent spend)

**What `scripts/replay.mjs` does.**
- Reads the 2026-10-18 transcripts: the main sessions and their subagent jsonl files.
- Takes assistant records, deduplicated by `message.id`, and computes context per turn as `input + cache_read + cache_creation`.
- Runs the same `core.decide` over them.
- Prints, per session: the turn index and context at which each note would fire, the number of notes, the peak context and the total cache read.

**Avoided cache read (an upper bound).**
- At the first strong crossing t\*, assume the context resets to a base B, the median first-turn context of the phase sessions.
- Avoided = Σ over t > t\* of max(0, ctx(t\*) − B).
- This assumes context grows the same way after the reset and that the handoff itself costs nothing. The report labels it as an upper bound.

**Pass condition.** All four must hold:
1. The 2026-10-18 control session would have received the strong note at least once.
2. The upper-bound avoided cache read is at least 30% of that session's cache read.
3. Each main session gets at most 5 notes (noise).
4. Subagent turns get 0 notes.

If any condition fails, stop and report. P3 does not run.

## 6. A/B measurement (P3)

- **Arms.** A is a workflow-v2 control/phase session without the plugin. B is the same, run with `--plugin-dir ./context-governor` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- **Runs.** The same Track E task, 2 repetitions per arm, in the order ABBA.
- **Metrics** (from `phase_usage.mjs` and the plugin's jsonl): peak context of the control session, total cache read per round, model turns, interrupted or aborted turns, and p95 `hookMs`.
- **Success criteria** (from the brief):
  - control-session peak context at most 200k;
  - cache read per round down at least 30% against the 2026-10-18 rounds and against arm A;
  - 0 interrupted turns;
  - hook latency under 200 ms per turn.
- **Honesty note:** with n=2 per arm, and with the user's reaction to the notes in the loop, the result is directional only, not statistically significant. Results are reported per run, not only as means.

## 7. Risks and open questions

- **Runtime is unverified.** Nobody has confirmed that `turn.complete` or `classic.Stop` fires in a plugin module, or that `usage` is filled in.
  - P2 therefore starts with a smoke test: a minimal module that logs one jsonl line per turn. Build only after that passes.
  - If `turn.complete` fails, switch to `classic.Stop` plus `$.session.usage()`, and keep the notes user-only.
- **Visibility:** whether the result `text` shows in every UI (CLI and desktop) still needs checking. Toast is the backup.
- **Noisy notes:** covered by the gate of at most 5 notes per session.
- **Transcript format changes:** a change could break the replay. Usage fields come straight from the API, which lowers this risk.
- **The agent never sees the notes in v1.** If users ignore them, v2 may add opt-in `additionalContext` via `classic.Stop`. That is out of scope here.
- **`artifactDir`** must be set per experiment, by hand or by environment variable. Discovering it automatically is out of scope.
