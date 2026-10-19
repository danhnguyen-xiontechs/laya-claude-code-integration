# Phase 0: runtime API findings

Claude Code 2.1.303; types file `types/claude-code.d.ts` (2.1.299). The spike was a throwaway mod that logged
filtered fields on `session.start`, `agent.spawn` and `tool.call`. It ran in one headless session
(`claude -p --model haiku --plugin-dir <spike>`) in a scratch git repo on 2026-10-20. The rows below
come from that run's dump. Snippets are trimmed to 200 characters and the paths are shortened.

## Bash outcomes as a `tool.call` hook sees them after `next(e)`

| Case | `isError` | `result` | `text` (start) | `returnCodeInterpretation` |
|---|---|---|---|---|
| `npm test` whose script exits 1 | `true` | string | `Exit code 1\n\n> test …\nFAIL a.test\nAssertionError: expected 1` | — |
| `node -e "process.exit(3)"` | `true` | string | `Exit code 3` | — |
| `grep zzzq package.json` (no match) | absent | object | `(Bash completed with no output)` | `No matches found` |
| `test -f nope.txt` (false) | absent | object | `(Bash completed with no output)` | `Condition is false` |
| `sleep 5`, `timeout: 1000` | `true` | string | `Exit code 143\nCommand timed out after 1s` | — |
| `touch denied.txt` (permission refused, sensitive path) | `true` | string | `Claude requested permissions to edit … which is a sensitive file.` | — |
| `echo ok` | absent | object | `ok` | — |

Conclusions:
- **No exit-code field.** On failure `result` is a string, and the exit code exists only as `Exit code N` in the text. The existing `exitCodeOf` parse stays.
- **The runtime already turns expected nonzero results into non-errors.** A grep with no match and a `test` that is false come back without `isError` and with `returnCodeInterpretation` set. The classifier labels them `EXPECTED_NONZERO` from that field and never from the exit code.
- **A timeout looks like a failure** (`Exit code 143` plus `Command timed out after`). The old `outcomeOf` recorded it as a failure. It is now `AMBIGUOUS`: it is not counted and never blocks.
- **A permission refusal** is `isError` with no `Exit code` line. The existing `DENIED` regex (`permission`, …) matches it. An interactive "user pressed Deny" could not be produced headless, so it is **not observed**. It is assumed to look the same, and the rule is that an error with no `Exit code N` line is never a FAIL.

## Subagents

- `agent.spawn` fires with `subagentType`, `background`, `model`, `prompt`, `description`, `tool_use_id`, `cwd` (and `agentId`, the parent loop's id, which is absent on main). `next(e)` returns the started subagent's `agentId`. **This is the runtime evidence that a recovery agent started** (`escalation_started`).
- The subagent's own Bash calls arrive in `tool.call` with `agentId` set to that id.
- A foreground `Agent` tool call returns after the subagent is done, with `result.status === "completed"` (plus `agentId`, `content`, `totalTokens`, …). For a background agent the types say the run ends with the subagent loop's `turn.complete`, matched by `agentId`. **The background path was not exercised in the spike.**

## Mod environment limits

- `import … from "node:crypto"` and dynamic `import()` are **rejected by `claude plugin validate`**: "a hooks module imports its own files by relative path and "claude-code", nothing else". So there is no Node `child_process` and no streamed `createHash`.
- `globalThis.crypto.subtle.digest('SHA-256', …)` **works** (the spike got a 32-byte digest).
- `$.process.run(['git','status','--porcelain'], { timeoutMs })` **works** (exit 0). Output is buffered up to 4 MiB with `isStdoutTruncated`.
- Absolute-path writes with `$.fs.write` are used by context-governor under the home directory. The spike wrote relative to the session cwd.

## Design changes these findings force

1. **The state fingerprint cannot be streamed.** It is SHA-256 (WebCrypto) over the buffered output of `git status --porcelain=v1 -uall -z`, `git diff HEAD --no-ext-diff --binary`, and `git hash-object` of untracked files (at most 50). If any output is truncated (over 4 MiB), any exit code is nonzero, a call times out, or the folder is not a repo, the token is `unknown`, and an unknown token never allows a block. The 1500 ms total budget is unchanged. Large diffs therefore fail open rather than block. This is a known limitation.
2. A timeout is `AMBIGUOUS`, not `FAIL`.
3. `ESCALATED` is set only from an `agent.spawn` whose `subagentType` is `agent-reliability:opus-recovery`. "Recovery done" comes from that `Agent` tool call's result (foreground) or from the subagent's `turn.complete` (background, unverified).
