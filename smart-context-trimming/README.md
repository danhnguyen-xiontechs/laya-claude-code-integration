# smart-context-trimming

Claude Code Mod (function hooks, Claude Code ≥ 2.1.295) that compacts long Bash **test/build** output before Claude reads it, keeping only original lines: errors, failed tests with assertion details, exception heads + first 6 frames, fatal lines, summaries, exit status, head 5 / tail 15. The raw output is saved to `~/.claude/smart-context-trimming/raw/` and the compact text points to it. Plan: `plan-01-smart-context-trimming-mod-jev.md`.

**Ships in `haiku-100k` since 0.14.0.** The mod's code lives in `haiku-100k/hooks/trim/` (`core.ts` + `register.ts`, engine tests in `engine.test.ts`). This folder keeps the fixtures, the node spec, the benchmarks and the reports; they import `../haiku-100k/hooks/trim/core.ts`. The standalone plugin is gone: install `haiku-100k` instead.

## Use

- Default mode **enforce** (haiku-100k userConfig `trimMode`): long test/build output is trimmed; metrics go to `~/.claude/smart-context-trimming/metrics-*.jsonl`.
- `/smart-trim observe` measures only; `/smart-trim off` disables it for the session; `/smart-trim status`. `SMART_TRIM_MODE=off|observe|enforce` overrides the setting.
- To turn it off for good, set `trimMode` to `off` in the plugin's settings (`pluginConfigs` → `haiku-100k@haiku-100k` → `options`). The other haiku-100k features keep running.
- Per command: add `--no-trim` or `SMART_TRIM_SKIP`, or pipe to `head`/`tail`/`grep` (excluded).
- Settings (haiku-100k `userConfig`): `trimMode`, `trimMinLines` 250, `trimMinBytes` 20000, `trimJev`, `trimJevTimeoutMs` 8000, `trimJevMinConfidence` 0.6, `trimRawTtlHours` 24.

## TypeSafe Jev (optional)

In enforce mode with `OPENROUTER_API_KEY` set, one decisions call per trimmed output picks a strategy and yes/no per optional candidate (repeated warnings, deep stack frames). Jev never writes text and can never remove mandatory evidence. Candidate text is redacted and capped at 12 KB; timeout, invalid/unknown answers or low confidence fall back to the rules. `trimJev: false` = no network.

## Result shapes (Phase 0, proven live)

| core result | what the mod returns |
|---|---|
| success `{ result: { stdout, stderr, … } }` | `{ result: { ...result, stdout: compact, stderr: '' } }` |
| non-zero exit `{ isError, result: string }` | `{ deny: compact }` (only shape that keeps the error flag) |
| deny, interrupted, background, image, persisted output, unmatched | unchanged |

Known limit: Claude Code truncates failed-command text to ~10 KB (head+tail) **before** hooks run, so diagnostics in that middle are lost by core, not by this mod.

## Privacy

Raw logs are stored as-is under your user profile (outside source control); there is no fs delete API, so logs past the TTL are emptied at the next session's first Bash call. Secrets are redacted only from what is sent to Jev.

## Tests

```bash
node --test "tests/*.spec.ts"
```

Engine tests run with the whole plugin, from the repository root:

```bash
claude plugin test ./haiku-100k
```

```bash
node scripts/bench.ts --live --max-calls 10
```
