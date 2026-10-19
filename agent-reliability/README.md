# agent-reliability

A Claude Code mod (function hooks) that stops unproductive retry loops on test and build commands. This is version 0.2 of what used to be `retry-loop-breaker`. The default mode is **observe**: the mod only logs what it would have done.

## What it does

- **Rule B: identical repeat.** A verification command (`npm test`, `npm run build`, `tsc`, `pytest`, `dotnet test`, `go test`, `cargo test`, …) can fail twice with the same error fingerprint while nothing changed in between. In that case the third run is refused before it executes.
  - "Changed" means a successful Edit/Write/NotebookEdit, a Bash command that may mutate, a user prompt that asks for a rerun, or a different git content token.
  - The git token is a SHA-256 over `git status -uall`, `git diff HEAD --binary` and the untracked blobs. It catches edits made outside Claude's tools.
- **Rule A: recovery budget.** A failing verification opens an incident. A rerun that fails after at least one change counts as a failed recovery strategy.
  - After `maxRecoveryStrategies` (2) of those, the next verification is refused. The refusal asks Claude to call the **`agent-reliability:opus-recovery`** agent (model `opus`) with an incident summary.
  - If Claude does not start that agent, or the agent finishes and verification still fails, the incident becomes **NEEDS_USER**. Verification is then refused with "ask the user" until the next user message.
  - A passing verification closes the incident. A new failure after that opens a fresh one.
- **The mod does not judge results itself.** Classification uses the runtime's own fields (see [docs/api-findings.md](docs/api-findings.md)):
  - `FAIL` needs `isError` together with an `Exit code N` line.
  - Grep with no match, or a `test` that evaluates false, is `EXPECTED_NONZERO` (the runtime's `returnCodeInterpretation`).
  - A timeout, an interrupt, or an error with no exit code is `AMBIGUOUS`. It is never counted and never blocks.
  - A refused permission is `USER_DENIED`. It is never counted, and the mod never works around it.
- **Fail-open everywhere.** Any error inside the hook, git missing, git over its budget, truncated output, or no baseline token all let the call run. Escalation is cooperative: the mod cannot pause the main loop, it can only refuse the next verification.

## Install

From this repo's marketplace:

```bash
claude plugin marketplace add D:/XionTechs/Laya
```

```bash
claude plugin install agent-reliability@danhnguyen-xiontechs
```

To try it in one session without installing:

```bash
claude --plugin-dir ./agent-reliability
```

## Modes, enforcement and rollback

The effective mode is decided by the first of these that applies:

1. `AGENT_RELIABILITY=off` (the kill switch).
2. `/reliability observe|enforce|off` for this session.
3. `AGENT_RELIABILITY=observe|enforce`.
4. The userConfig `mode`.
5. `observe`.

| Want | Do |
|---|---|
| See status, incidents, recent decisions | `/reliability` (or `/retry-guard`) |
| Enforce in this session only | `/reliability enforce` |
| Enforce everywhere | userConfig `mode: enforce`, or env `AGENT_RELIABILITY=enforce` |
| Also enforce Rule A (escalation) | userConfig `ruleA: true` (off by default: it is logged only) |
| Back to logging only, now | `/reliability observe` |
| Undo a session override | `/reliability auto` |
| Clear this session's records/incidents | `/reliability reset` |
| Emergency off | env `AGENT_RELIABILITY=off`, or `claude plugin disable agent-reliability` |

Suggested rollout:
1. Run in observe mode and read the telemetry for `would_block` and `would_escalate` lines that would have been wrong.
2. Turn on `enforce` (Rule B only).
3. Only after that, turn on `ruleA`.

Any false-positive block means going back to `/reliability observe` and opening an issue that includes the telemetry line.

## Telemetry

One JSONL line per decision goes to `~/.claude/agent-reliability/<session-id>.jsonl`. The file is trimmed to about 1 MB.

- **Fields:** `ts`, `agentId`, `toolUseId`, `tool`, `commandKey`, `mode`, `modeSource`, `event`, `classification`, `reason`, `action` (`allow`, `would_block`, `deny_repeat`, `would_escalate`, `deny_escalate`, `would_deny_needs_user`, `deny_needs_user`), `preReason`, `errorKey`, `incidentId`, `incidentState`, `stateToken` (12-character prefix), `hookMs`.
- **Events:** `incident_opened`, `repeat_failed`, `strategy_failed`, `escalation_due`, `escalation_requested`, `escalation_started`, `recovery_in_progress`, `recovery_done`, `needs_user`, `incident_closed`, `repeat_blocked`.
- **What is never logged:** tool output or file contents. `errorKey` is a hash. An example is in [docs/telemetry-sample.jsonl](docs/telemetry-sample.jsonl).
- **Diagnostics dump:** `dumpRaw` (off by default) writes filtered result fields to `diag-<session>.jsonl`. It is meant only for re-checking the runtime API.

## Migration from retry-loop-breaker 0.1

- The folder, plugin name and state key are now `agent-reliability`. `/retry-guard status|reset` still works as an alias. All old userConfig keys keep their meaning.
- Changed defaults: `jevEnabled` is now **false**, because it needs an OpenRouter key.
- Session state from 0.1 is **not imported**. State lives per session, and an old-shaped state is dropped rather than reused.
- Remove any `--plugin-dir ./retry-loop-breaker`, so that only one mod hooks Bash.

## Limits

- Edits outside Claude's tools are seen only through the git token. Outside a git repository, if the diff is over 4 MiB, if there are more than 50 untracked files, or if git takes more than 1.5 s, the token is unknown and Rule B does not block.
- A strategy is "at least one change between two failing runs". An unrelated edit still counts, so escalation may come early.
- The mod can only refuse verification calls. It cannot stop the main loop from editing while recovery runs.
- "Recovery finished" for a background recovery agent relies on that agent's `turn.complete`. That path was not exercised in a real session.
- Subagents are left alone by default (`mainAgentOnly`). When this is off, each agent's incidents are tracked separately.

## Test

```bash
cd agent-reliability && npm test
```

```bash
claude plugin validate agent-reliability && claude plugin test agent-reliability
```
