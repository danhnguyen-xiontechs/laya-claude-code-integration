# agent-reliability 0.2 — implementation report

Date: 2026-10-20. Branch `agent-reliability-v0.2`. Spec: `C:\Users\ADMIN\.claude\plans\t-i-ngh-l-n-n-woolly-haven.md` (it is based on the user's "Agent Reliability Mod — Implementation Plan" v2).

## What was built

`retry-loop-breaker` 0.1 was upgraded in place (`git mv`) to `agent-reliability` 0.2. One mod now hooks Bash.

| File | Role |
|---|---|
| `hooks/core.ts` | Case B from 0.1: eligibility, command and error fingerprints, epoch, `decideBefore` / `recordAfter`, JEV contract. New here: options, `resolveMode`, `upgradeState`. |
| `hooks/incident.ts` (new, pure) | `classifyRun`, the incident state machine (`OPEN → ESCALATION_REQUESTED → ESCALATED → CLOSED`, or `→ NEEDS_USER`), Rule A strategy counting, escalation and NEEDS_USER texts, the recovery agent prompt. |
| `hooks/io.ts` (new) | Telemetry JSONL, session id, git content token (SHA-256 via WebCrypto, with a time budget). |
| `hooks/register.ts` | Wiring for `session.start` (commands and the `opus-recovery` agent), `/reliability` plus the `/retry-guard` alias, `prompt.submit`, the Edit/Write hooks, `agent.spawn`, `tool.call{Agent}`, `turn.complete` and `tool.call{Bash}`. |
| `types/index.d.ts` | State schema 2 (incidents, mode override, stats). |
| `.claude-plugin/plugin.json`, root `marketplace.json` | 0.2.0, the new options, and a marketplace entry. |
| `docs/api-findings.md` | Phase 0 evidence. |
| `docs/telemetry-sample.jsonl` | Telemetry sample: real lines first, then hand-written lines in the same format, labelled as such. |

## Key decisions

- **Case B is kept as it was.** The 0.1 logic and its tests are unchanged; the only edits are the message text and defaults. All 0.1 tests still pass.
- **The git token can only veto a block.** It is computed after each failing verification (the baseline) and again only when Rule B is about to deny. If the token is unknown or there is no baseline, the call is allowed and counted as `fail_open`. If git sees a change, a new epoch starts, so a new identical chain is recognised from its first failure.
- **Classification follows the runtime.** A failure needs `isError` plus `Exit code N`. A timeout is AMBIGUOUS. `returnCodeInterpretation` marks EXPECTED_NONZERO. A permission refusal is USER_DENIED.
- **Escalation is cooperative and backed by evidence.** The mod denies with a payload. It sets `ESCALATED` only when it sees an `agent.spawn` of `agent-reliability:opus-recovery`. "Done" comes from the `Agent` tool result (`status: completed`) or from the subagent's `turn.complete`.
  - If verification fails while recovery is still running, the state stays `ESCALATED`.
  - If verification fails after recovery is done, the state becomes `NEEDS_USER`.
  - If escalation was requested but ignored (a second verify attempt, or a failure with no recovery started), the state becomes `NEEDS_USER`.
- **Rule A is off by default** (`ruleA: false`) even in enforce mode. It is logged until it is turned on, so escalation defects can be told apart from Rule B defects.
- **Mode precedence:** env `off` > `/reliability` > env `observe|enforce` > userConfig > `observe`.
- **State is not migrated.** `$.state` is per session, and an old-shaped state is dropped by `upgradeState`. The `retry-loop-breaker` plugin was not installed or enabled in any settings file checked (`~/.claude/settings*.json`, `.claude/settings*.json`, installed plugins).

## Limits of the runtime API (verified)

- A hooks module may import only its own files and `"claude-code"`. `node:crypto` and `node:child_process` are rejected by `claude plugin validate`. So the token is **buffered, not streamed**: `$.process.run` caps output at 4 MiB, and truncated output makes the token unknown.
- Bash results carry no exit-code field, so the code is parsed from the `Exit code N` line.
- An interactive "user pressed Deny" could not be produced headless. Only a sensitive-file permission refusal was observed. Both are assumed to share the shape "isError, no `Exit code`".
- The background-recovery completion path (`turn.complete` matched by `agentId`) follows the types file and was not run.
- A helper that receives `$` must be a top-level function declaration, and `$.state` references must be literals. The validator enforces both.

## Tests actually run (2026-10-20)

| Command | Result |
|---|---|
| `npm test` (node --test: `cases.unit.ts` from 0.1 plus the new `incident.unit.ts`) | 32 pass, 0 fail, 1 skipped (the JEV live test, which needs `JEV_LIVE=1`) |
| `claude plugin test .` (engine, Claude Code 2.1.303) | 18 pass, 0 fail (8 from 0.1 plus 10 new) |
| `claude plugin validate .` and the root marketplace | passed |
| Real headless session: `AGENT_RELIABILITY=enforce claude -p --model haiku --plugin-dir agent-reliability`, asked to run a failing `npm test` four times | Runs 1 and 2 executed. Run 3 was denied with the Rule B text. The model stopped and pointed to `/reliability reset`. The telemetry has 3 lines (`incident_opened`, `repeat_failed`, `repeat_blocked`), and the denial took `hookMs` 66. |
| Real headless session, default mode (observe), same repo, 3 runs | All 3 ran. The telemetry shows `incident_opened`, `repeat_failed`, `repeat_blocked/would_block`, `repeat_failed`, with `hookMs` 60–122. |

What the tests cover (the plan's 14 essential cases):
- **Pure logic:** cases 1–2, 5, 6 (grep and `test`), 7 (permission), 9–13, timeout, baseline refresh, mode precedence.
- **Engine:** case 3 (deny on the 3rd attempt), case 4 (an edit or an outside change via git allows the run), case 8 (git broken fails open), Rule A deny, NEEDS_USER and lift on a user prompt, the Rule A lifecycle (`ESCALATED` only after `agent.spawn` of the recovery agent; failing verifications while it runs stay allowed; `NEEDS_USER` only after the `Agent` call returns `completed` and verification still fails), Rule A off by default, the kill switch, the session override, `/retry-guard reset`, case 14 (registration).

**Scenarios covered by the two headless runs** (real Claude Code 2.1.303, Haiku, a scratch git repo whose `npm test` always fails, no edits between runs):
- **Enforce run:** Rule B in the real runtime (third identical run denied, before it executes); FAIL classification from a real Bash result; the git baseline token computed in a real repo; telemetry written to `~/.claude/agent-reliability/<session>.jsonl`; the model respecting the deny.
- **Observe run (default mode):** nothing denied, `would_block` logged on the third run; real `hookMs`.
- **Not covered by either run:** edit-then-rerun allowed, Rule A / Opus escalation, NEEDS_USER, the kill switch, a git failure or timeout, subagents. These are covered only by the engine and unit tests above.

**Review before commit (2026-10-20):** two fixes. A `sha256` failure inside `gitToken` now returns `unknown` instead of throwing past the bookkeeping. With `AGENT_RELIABILITY=off`, the recovery-tracking hooks (`agent.spawn`, `Agent`, `turn.complete`) no longer write state or telemetry.

**Not run:**
- `tsc` type check, because TypeScript is not installed and was not downloaded. Node type stripping and `claude plugin validate` both pass.
- Rule A in a real session.
- A real interactive Deny.

## Remaining risks

1. Hook overhead: one `git` pass after each failing verification, capped at 1.5 s. The observe-mode real run (small repo) measured `hookMs` 60–122 per eligible call. A large repo will cost more; watch `hookMs`.
2. Build artefacts that are untracked and not ignored change the token on every run. Rule B then never blocks in that repo (safe, but no protection there).
3. The model may ignore the escalation request. Rule A then goes to NEEDS_USER, which is only as strong as the next deny.
4. No real-use data yet. Nothing here claims effectiveness. Next step: run in observe mode for real work, then review `would_*` lines.
