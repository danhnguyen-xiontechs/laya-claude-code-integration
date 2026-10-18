# design.md: context-governor (v1, warn only)

> Criteria frozen on 2026-10-18 by the user's Gate A approval. P2 and P3 do not change these thresholds or criteria.
> Written by the P1 Opus call (closed pack: idea-brief.md and context-pack.md).
> §5 formula amended on 2026-10-18 by the user after P3: the literal bound exceeded the session's total cache read (121.4%).

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

## 5. Offline gate (re-frozen before the second replay)

§5 re-frozen 2026-10-18T14:01:32Z before the second replay, per accepted findings #1-#4.

History. The first P3 replay used the literal formula (121.4%, context units against cache_read) and then the amended formula (6.7%, one day only, from 2026-10-18 00:00 UTC). Both are kept as evidence. This section replaces both and is the only gate for the second replay. Its numbers are not compared with the earlier ones as a pass.

**Data.** Every main session file under `~/.claude/projects/**` (top-level `*.jsonl`) and its `subagents/*.jsonl`. No date filter: each session is replayed over its whole history. Timestamps are UTC (`Z` suffix); no figure uses a local day.

**Per main session, in file order.** Assistant records with `message.usage`, deduplicated by `message.id`. For turn i (1-based):
- ctx(i) = input + cache_read + cache_creation (design §1).
- cr(i) = cache_read_input_tokens. The avoided figure and the denominator are both in cache_read tokens.
- t* = the first i with ctx(i) >= 200000 and ctx(i-1) < 200000 (first crossing from below). A session that never crosses has no t*.
- B_cr = median over all replayed main sessions of cr(1) (first-turn cache_read).
- avoided = sum over i > t* of max(0, min(cr(i), cr(t*)) - B_cr).
- cacheRead = sum over all turns of cr(i). The replay asserts avoided <= cacheRead and exits with an error otherwise.
- ratio = avoided / cacheRead.

**Realized delay (reported, not gating).** c* = the first `compact_boundary` record after t*'s timestamp; when a session has none, the first turn after t* with ctx below 100000 (a drop with no recorded compaction). realizedDelay = c* - t* in turns, and realizedCr = sum of cr over turns t*+1 to c*. This counts the turns the note would sit unused before the user compacted.

**Notes.** The same `core.decide` as the plugin, with the default config, run over one main session at a time. Artifact rule: a turn counts as a write when an assistant `tool_use` named Write, Edit or MultiEdit has a `file_path` containing `20261018-context-governor-01` (forward slashes); artifact(i) = {mtimeMs: timestamp of the latest such write so far} or null before the first. Subagent turns: `decide` with agentId; their notes and cache_read are counted on a separate line and are not in cacheRead.

**Sessions reported.**
- Control 82e30143-e152-4ee9-b306-ffbd1654c94d: gates conditions 1 and 2.
- Named sessions b266357b, 5b84aa0f and 3e716326: table only.
- Held-out: the main session whose first timestamp is on 2026-10-17 (UTC) with the largest cacheRead, excluding the four sessions above. Chosen by this rule, fixed here before the run. Table only.
- All replayed main sessions: conditions 3 and 4.

**Pass conditions** (the same four as before; condition 2 is now in cache_read units):
1. The control session would have received the strong note at least once.
2. The control session's ratio is at least 30%.
3. Each replayed main session gets at most 5 notes.
4. Subagent turns get 0 notes.

Conditions 1 and 2 are evaluated on the control session. The other sessions are reported and do not gate. Any failing condition gives BLOCKED: stop and report; the A/B (P3) does not run.

**Outputs.** `evidence/replay/output-run2.txt`, `summary-run2.json`, `gate.md`. Earlier outputs are kept as `output-run1.txt`, `summary-run1.json`, `gate-run1.md` and `output-literal.txt`.

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
