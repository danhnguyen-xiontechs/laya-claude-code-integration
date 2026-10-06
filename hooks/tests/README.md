# hooks/tests — cache_expiry_gate tests

## Automated (subprocess, no Claude Code, no network)

```bash
PYTHONIOENCODING=utf-8 /c/Users/ADMIN/AppData/Roaming/uv/tools/laya/Scripts/python.exe hooks/tests/test_cache_expiry_gate.py
```

- Each test copies the hook into a temp dir and runs it as a subprocess with realistic `UserPromptSubmit` stdin JSON.
  The decision log and block-once state files land in that temp dir (`TMP`/`TEMP` are redirected), and the dir is
  deleted afterwards. The real `hooks/cache_expiry_gate.log.jsonl` is never touched.
- Transcript fixtures are generated per test by `fixtures/build.py`, with timestamps relative to now. They are shaped
  like real Claude Code assistant records (`message.usage`, `cache_creation.ephemeral_5m/1h_input_tokens`,
  `isSidechain`).
- `RealTranscripts` runs the hook read-only on the largest and a small real transcript under
  `~/.claude/projects` (latency only, isolated state and log).
- Output: unittest result, plus `results.json` (every check with expected vs actual, latency stats per scenario).

Decision mapping: `{"decision":"block"}` or exit code 2 → BLOCK, `{"systemMessage":…}` → WARN, anything else → ALLOW.
Every test also asserts exit code 0 (the hook never crashes and never uses exit 2).

## Manual integration test (real Claude Code)

Prerequisite: `.claude/settings.json` in this project registers the hook (already present). Hooks only run for
sessions whose project is `D:\XionTechs\Laya`.

**Test 1: old session with large context → block once, then proceed**
1. In the Claude desktop app (Code tab) or `claude --resume` from `D:\XionTechs\Laya`, open an old Laya session
   with context ≥ 100k that has been idle > 1 h. Example: `9b0fea90-…` (≈ 134k context, idle since 2026-10-01).
2. Submit a harmless prompt: `Reply with exactly: ok`.
3. Expected: the prompt does not run. A message starting with `Cache expired: idle … min > TTL 60 min, context …k
   tokens …` is shown. `hooks/cache_expiry_gate.log.jsonl` gets an `"action": "blocked"` line.
4. Within 10 min, submit the exact same prompt again.
5. Expected: Claude answers `ok`. The log gets `"action": "allowed-after-confirm"`. This step really rebuilds the
   cache. Its cost is the `est_extra_usd` in the log (≈ $1 for 134k on Opus 5.5).
6. Submit `Reply with exactly: ok2` right away. Expected: proceeds, no new log line (cache is warm again).

**Test 2: new / small session → proceeds normally**
1. Start a new session in this project and submit `Reply with exactly: ok`.
2. Expected: Claude answers, no log line.

**What to capture**
- What Claude Code showed on the block (screenshot or text).
- `hooks/cache_expiry_gate.log.jsonl` lines.
- Transcript behavior. In the session's `.jsonl` under `~/.claude/projects/D--XionTechs-Laya/`, check whether the
  blocked prompt is recorded (a `user` line with the prompt text) and how the block reason is stored (look for
  `hook`/`blocked` in `system` or `attachment` records). Also check that no `assistant` record with non-zero
  `usage` follows the blocked prompt: that is the proof that it never reached the API.

Then fill the "Integration" section of `report.md`.

Note: headless `claude -p` needs a valid CLI login. On 2026-10-05 the CLI OAuth session was expired, so the run
failed before `UserPromptSubmit` and never reached the hook.
