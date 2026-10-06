# cache_expiry_gate — test report (2026-10-05)

Scope: base rule + Claude Code `UserPromptSubmit` hook only. No Laya.

## Result

**29 tests, 41 checks: all pass** (after one bug fix, below). Run: `test_cache_expiry_gate.py`. Raw data: `results.json`.

| Case | Scenario | Expected | Actual |
|---|---|---|---|
| A | ctx 200k, 1h TTL, idle 2 h | BLOCK, reason has idle/TTL/ctx/$/options, log `blocked`, est. $1.56 | BLOCK ✔ |
| B | same prompt again within 10 min | ALLOW, log `allowed-after-confirm` | ALLOW ✔ |
| C | **different** prompt within 10 min after a block | ALLOW. By design, confirmation is per session + last request, not per prompt text | ALLOW ✔ |
| C2 | retry after the confirm window | BLOCK again | BLOCK ✔ |
| C3 | confirm in session A, prompt in session B | BLOCK (state is per session) | BLOCK ✔ |
| C4 | block → retry → Claude answers → next prompt | BLOCK, ALLOW, ALLOW; no state file left | ✔ |
| D / D2 | ctx 50k expired / same with MIN_CONTEXT=40000 | ALLOW / BLOCK | ✔ |
| E | ctx 200k, idle 30 min < 1h TTL | ALLOW | ALLOW ✔ |
| F | `/compact`, `/clear`, `  /compact …` | ALLOW, no log | ✔ |
| G | missing transcript | ALLOW | ✔ |
| H | stdin `{not json`, empty, `null`, `[]`, `"text"` | ALLOW, exit 0 | ✔ |
| I | `CACHE_GATE_MODE=warn` | systemMessage only, log `warned` | WARN ✔ |
| J | `CACHE_GATE_MODE=off` | ALLOW, no log | ✔ |
| TTL | 5m writes: idle 10 min / 2 min | BLOCK (TTL 5 min) / ALLOW | ✔ |
| TTL | 1h writes: idle 10 min; 1h seen earlier + last request read-only | ALLOW / ALLOW | ✔ |
| — | recent subagent (sidechain) request, main idle 2 h | BLOCK (sidechain does not reset the idle clock) | ✔ |
| Fail-open | malformed lines, bad timestamp, usage without token fields, directory as transcript (read error), empty transcript | ALLOW | ✔ |
| Fail-open | no cache TTL metadata: idle 10 min / idle 3 h | ALLOW / BLOCK | ✔ (after fix) |
| — | unknown model id | BLOCK, cost text "a full cache rebuild" | ✔ |
| — | unexpected stdin shapes (no transcript_path, non-string path, list prompt) | ALLOW, no crash | ✔ |

## Bug found and fixed

`missing cache metadata`: without a `cache_creation` TTL breakdown, the hook defaulted to a 5 min TTL and **blocked at
idle 10 min**. Claude Code normally writes 1h cache, so this would be a false block. Fix in `last_request()`: use 5 min
only when 5m writes were actually seen and no 1h writes; otherwise (1h seen, or unknown) use 1 h. No other logic
changed.

## Latency (subprocess wall time, incl. Python start-up)

| Scenario | n | min | median | p95 | max |
|---|---:|---:|---:|---:|---:|
| normal (allow, fixtures) | 26 | 62 ms | 71 ms | 83 ms | 87 ms |
| blocked | 14 | 67 ms | 80 ms | 90 ms | 97 ms |
| allowed retry | 3 | 71 ms | 73 ms | 78 ms | 78 ms |
| real small session | 10 | 64 ms | 66 ms | 69 ms | 69 ms |
| real large session (33 MB transcript) | 10 | 79 ms | 81 ms | 91 ms | 91 ms |

The hook reads only the last 4 MB of the transcript, so cost is flat in transcript size. Most of the ~65 ms is Python
start-up. Hook timeout is 10 s.

## Integration (real Claude Code)

**Passed** (2026-10-05, Claude Code 2.1.287, headless `claude -p --resume`, project `.claude/settings.json`).
Session: `d4cd8bf7` is a disposable fork of old Laya session `c3d835e5` (context 68k, idle ~93 h, Sonnet 5.5, 1h
cache). `CACHE_GATE_MIN_CONTEXT=20000` because 68k < the 100k default.

| Step | Expected | Observed |
|---|---|---|
| 1. old session, `Reply with exactly: ok` | blocked, reason shown, log `blocked` | ✔ Blocked. Output: `UserPromptSubmit operation blocked by hook: Cache expired: idle 5601 min > TTL 60 min, context 68k tokens … (~$0.26 extra …) … Original prompt: Reply with exactly: ok`. **cost $0, 0 tokens** (no API call). Log `blocked`. 4.4 s wall (CLI start-up). |
| 2. same prompt again | proceeds, log `allowed-after-confirm` | ✔ Answer `ok`, $0.105 (cache_creation 23.8k, cache_read 47.3k). Log `allowed-after-confirm`. |
| 3. next prompt `ok2` | proceeds, no log | ✔ Answer `ok2`, cache_read 71k (cache warm), no log line. |
| 4. new session (`0220952f`) | proceeds, no log | ✔ Answer `ok`, no log line. |
| Transcript after block | prompt does not reach Claude | ✔ Step 1 appended only `queue-operation` enqueue/dequeue, one `system`/`informational` record with the block reason + `Original prompt: …`, `last-prompt`, and `cost-state` (totalCostUSD 0). **No `user` message and no `assistant` record**, so the blocked prompt is not part of the conversation history. |

Notes:
- Step 2's real rebuild (23.8k written) was smaller than the hook estimate (68k), because earlier test runs in the
  same hour had warmed the shared prefix (system + tools + early history of `c3d835e5`). In a genuinely cold session
  expect the full estimate.
- In `-p` mode a blocked prompt returns `is_error: false` with the block text as `result`. The interactive UI was not
  tested; there the prompt is expected to be removed from the input box.
- Test spend: ≈ $1.26 total ($0.79 of it was the new-session check, which ran on the CLI default model Fable 5.1).

**Finding: forked sessions bypass the gate on their first prompt.** With `--fork-session` the new transcript does not
exist yet when `UserPromptSubmit` fires (probe: `exists: false`). The hook finds no request and fails open. Two forked
runs went through unblocked ($0.12 and $0.11). Normal `--resume` / reopening a session is unaffected.

## Known limitations

- **Confirmation is per session, not per prompt (Case C).** Any prompt within 10 min after a block goes through.
  This is intended ("I saw the warning, continue"), but the message says "send the prompt again".
- **Cost is API-equivalent list price**, not subscription quota. The real rebuild may be partly cached if Claude Code
  pre-warmed or the TTL is longer than inferred.
- **TTL is inferred** from `cache_creation.ephemeral_*` in the last 4 MB of transcript. Claude Code does not expose
  the real cache state, so the hook can be wrong. Errors are biased toward 1 h (fewer blocks).
- **Subagent caches are not considered.** Only main-thread requests count.
- **A blocked prompt is not added to the conversation** (verified: only a system/informational record with the reason and the original prompt text). In the interactive UI the user may need to retype or
  paste it (not observed).
- **Odd stdin with `session_id: null`** still blocks when the transcript qualifies. The state is keyed `None`. Harmless.
- **Forked sessions** (`--fork-session`, branching a conversation) are not gated on their first prompt: the transcript
  does not exist yet when the hook runs.
- The integration test was headless (`-p`). Rendering of the block in the interactive UI / desktop app was not observed.
