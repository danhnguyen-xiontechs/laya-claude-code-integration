# smart-context-trimming

Claude Code Mod (function hooks, Claude Code ≥ 2.1.295) that compacts long Bash **test/build** output before Claude reads it, keeping only original lines: errors, failed tests with assertion details, exception heads + first 6 frames, fatal lines, summaries, exit status, head 5 / tail 15. The raw output is saved to `~/.claude/smart-context-trimming/raw/` and the compact text points to it. Plan: `plan-01-smart-context-trimming-mod-jev.md`.

## Use

```bash
claude --plugin-dir ./smart-context-trimming
```

- Default mode **observe**: nothing changes; metrics go to `~/.claude/smart-context-trimming/metrics-*.jsonl`.
- `/smart-trim enforce` (or `SMART_TRIM_MODE=enforce`) trims; `/smart-trim off` disables for the session; `/smart-trim status`.
- Per command: add `--no-trim` or `SMART_TRIM_SKIP`, or pipe to `head`/`tail`/`grep` (excluded).
- Settings (`userConfig`): `mode`, `minLines` 250, `minBytes` 20000, `useJev`, `maxJevLatencyMs` 8000, `minJevConfidence` 0.6, `rawOutputTtlHours` 24.

## TypeSafe Jev (optional)

In enforce mode with `OPENROUTER_API_KEY` set, one decisions call per trimmed output picks a strategy and yes/no per optional candidate (repeated warnings, deep stack frames). Jev never writes text and can never remove mandatory evidence. Candidate text is redacted and capped at 12 KB; timeout, invalid/unknown answers or low confidence fall back to the rules. `useJev: false` = no network.

## Result shapes (Phase 0, proven live)

| core result | what the mod returns |
|---|---|
| success `{ result: { stdout, stderr, … } }` | `{ result: { ...result, stdout: compact, stderr: '' } }` |
| non-zero exit `{ isError, result: string }` | `{ deny: compact }` (only shape that keeps the error flag) |
| deny, interrupted, background, image, persisted output, unmatched | unchanged |

Known limit: Claude Code truncates failed-command text to ~10 KB (head+tail) **before** hooks run, so diagnostics in that middle are lost by core, not by this mod.

## Privacy

Raw logs are stored as-is under your user profile (outside source control); there is no fs delete API, so logs past the TTL are emptied at session start. Secrets are redacted only from what is sent to Jev.

## Tests

```bash
node --test "tests/*.spec.ts"
```

```bash
claude plugin test .
```

```bash
node scripts/bench.ts --live --max-calls 10
```
