# agent-reliability

A Claude Code mod (function hooks) that stops unproductive retry loops. This is version 0.3 of what used to be `retry-loop-breaker`. The default mode is **observe**: the mod only logs what it would have done.

## What it does

- **Command recognition (0.3).** A command is unwrapped before it is classified: a leading `cd <dir> &&` / `Set-Location <dir>;`, a trailing `2>&1` and a trailing `| tail|head|Select-Object …` are stripped. This is for classification and keys only; the command that runs is never changed. Bash and PowerShell share one handler.
  - The key keeps the `cd` folder, so failures in two projects never merge.
  - A pipe hides the runner's exit code. A piped run without an error is judged only by the runner's own summary line (`ℹ fail N`, `✖ failing tests:`, `Tests: N failed`, pytest `N failed … in Xs`, `Failed: N`, …). With no summary line it is `AMBIGUOUS`: never counted, never blocks, never closes an incident.
- **Rule B: identical repeat.** A verification command (`npm test`, `npm --prefix x test`, `npm run build`, `tsc`, `pytest`, `py -m pytest`, `npx vitest run`, `dotnet test`, `go test`, `cargo test`, …) can fail twice with the same error fingerprint while nothing changed in between. In that case the third run is refused before it executes.
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
- **Rule C: refusal loops (0.3, `ruleC`, on by default).** A refused call is recorded from the result text (an error with no `Exit code` line). Rule C applies to subagents too, whatever `mainAgentOnly` says.
  - **Harness refusal** ("needs approval", "requires approval", "contains multiple operations", "Compound command changes working directory", "isolated in the worktree", "has not been read yet", …). Resending the same form is refused. When the action itself needs approval, any form of it is refused. A later success of the action, a Read of the file, or the TTL clears it.
  - **User denial** ("The user doesn't want to proceed", "Permission to use X has been denied", an auto-mode classifier denial):
    - The same action is refused by any route: Bash ↔ PowerShell on the same command (with or without a `cd`), and Edit ↔ Write ↔ NotebookEdit on the same file. A simple shell write (`> f`, `Out-File f`) to that file is refused too.
    - It is **never lifted automatically**: not by a new prompt, not by time, not by Jev. Only the user lifts it, with `/reliability allow <n|all>` or `/reliability reset`, and the normal permission prompt still applies afterwards.
  - After 3 refusals in a row in one agent, the refusal text (enforce mode) tells the agent to stop and report.
- **Jev Recovery Advisor (0.3, `jevAdvisor`: off | shadow | apply).** From the **2nd consecutive failure** of any key (a verification, another Bash/PS command family, or an Edit/Write on a file; main agent and subagents), the mod asks TypeSafe Jev one request with three questions: `failure_kind`, `same_approach`, and `next_step`, one of `RETRY_NEW_STRATEGY | ESCALATE_MODEL | ASK_USER | MARK_BLOCKED | STOP_AND_REPORT`.
  - **When Jev is not asked:** while the incident already has a decision pending (NEEDS_USER, ESCALATION_REQUESTED, ESCALATED, BLOCKED, STOPPED), while a user denial is live in that agent, or on an exact Rule B repeat.
  - `shadow` logs the decision (telemetry `jev_advice`, with `would_apply`) and changes nothing.
  - `apply` acts only in enforce mode, and only when `p ≥ jevAdvisorMinConfidence` (0.6). The decision is a note appended to the failed result that Claude reads, and the core carries it out:

    | Jev | Core action |
    |---|---|
    | RETRY_NEW_STRATEGY | Allowed while the budget lasts. A near-identical rerun with nothing changed is refused. |
    | ESCALATE_MODEL | Main agent: `ESCALATION_REQUESTED` and the `opus-recovery` instruction, once per incident, even with `ruleA: false`. `ESCALATED` is set only when that agent actually starts. A subagent is told to stop and report to its parent. |
    | ASK_USER | `NEEDS_USER`: calls on the key are refused until the next user prompt. |
    | MARK_BLOCKED | `BLOCKED` (never success): refused until the state changes or the next prompt. |
    | STOP_AND_REPORT | `STOPPED`: unresolved, never success. Refused until the next prompt. |
  - **Hard limits, in code.** Jev never lifts a user denial, never allows a call the core refuses, never turns FAIL into PASS (only a runtime PASS closes an incident), never adds retries past the budget, and never acts in observe mode. An API error, a timeout, an invalid answer or low confidence falls back to the 0.2 behaviour.
  - This is an advisor, not an autonomous router: the core decides what each action may do.
  - **Privacy and cost.** Jev sees a redacted summary: the last 4 attempts (command ≤ 220 chars, error ≤ 400 chars, changed files), budget numbers, and the user prompt only with `includePromptInJev` (redacted the same way). One shared policy (`hooks/redact.ts`) masks home and drive paths (drive paths keep only the file name), emails, Azure DevOps organizations, tokens and secrets, and long ids. The runtime does not mask bare usernames; the offline report does. Azure project names are not masked. It goes to TypeSafe Jev via OpenRouter (`OPENROUTER_API_KEY`) and costs about $0.0001 per call, at a p50 of about 0.6 s.
- **A new prompt ends the wait, not the question (0.3).** A user prompt marks every live incident (except a running recovery) `SUPERSEDED`, with `resolution: prompt_received`, never "approved". The next task starts with fresh counters. If a key that was NEEDS_USER fails again after the prompt, it gets one attempt (budget 1) and is NEEDS_USER again, with no new Jev call.
- **Local failure dataset (0.3, `datasetCapture`, on).** One sanitized line per failed attempt, refusal, Jev decision and incident end goes to `~/.claude/agent-reliability/dataset/attempts-YYYY-MM.jsonl` (`datasetDir` changes the folder). That is outside the plugin and every repo. Lines hold no tool output, no file contents and no prompt; files keep their base name only. It is data to evaluate Jev's decisions; it does not retrain Jev.
- **Fail-open everywhere.** Any error inside the hook, git missing, git over its budget, truncated output, or no baseline token all let the call run. Escalation is cooperative: the mod cannot pause the main loop, it can only refuse the next call or add a note.

## Install

**Normal install: inside haiku-100k.** haiku-100k 0.6.0 and later ship a copy of this mod in `haiku-100k/hooks/reliability/` (0.7.0: this 0.3, plus the `reliability-report` skill in `haiku-100k/skills/`), made by `node agent-reliability/scripts/ship-haiku-100k.mjs`. Run that script after every change here; `--check` reports a stale copy. In the copy, the agent is `haiku-100k:opus-recovery` and the options are haiku-100k's userConfig (titled "Reliability: …"):

```bash
claude plugin install haiku-100k@danhnguyen-xiontechs
```

The plugin folder is then Claude Code's plugin cache, which is replaced on every update. So set `telemetryDir` to a folder in your checkout, for example with `claude plugin configure haiku-100k@danhnguyen-xiontechs --values-stdin`. Put a `.gitignore` containing `*` in that folder, so no branch can commit the logs.

**Development install: this folder on its own.** Use it only while haiku-100k is disabled, because two copies would both hook Bash. It goes through the folder marketplace in `.claude-plugin/marketplace.json`. Claude Code reads the plugin live from that folder, and the telemetry defaults to `agent-reliability/telemetry/`:

```bash
claude plugin marketplace add <checkout>/agent-reliability
```

```bash
claude plugin install agent-reliability@agent-reliability
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
| Clear this session's records/incidents (also lifts user denials) | `/reliability reset` |
| Lift one user denial (Rule C) after the user agreed | `/reliability allow <n>` (numbers in `/reliability`), or `allow all` |
| Rule C off | userConfig `ruleC: false` |
| Jev advisor: log decisions only (pilot) | userConfig `jevAdvisor: shadow` + `OPENROUTER_API_KEY` |
| Jev advisor: carry decisions out | userConfig `jevAdvisor: apply`, and mode `enforce` |
| Jev advisor off | userConfig `jevAdvisor: off` (default) |
| Stop the local dataset | userConfig `datasetCapture: false` |
| Emergency off | env `AGENT_RELIABILITY=off`, or `claude plugin disable agent-reliability` |

Suggested rollout:
1. Run in observe mode with `jevAdvisor: shadow` and read the telemetry (`would_block`, `would_escalate`, `jev_advice`) and `/reliability-report` for lines that would have been wrong.
2. Turn on `enforce` (Rules B and C).
3. Only after reviewing shadow decisions, set `jevAdvisor: apply`. Turn on `ruleA` separately.

Any false-positive block means going back to `/reliability observe` and opening an issue that includes the telemetry line.

## Telemetry

One JSONL line per decision goes to `<plugin folder>/telemetry/<session-id>.jsonl`. With a folder install that is `agent-reliability/telemetry/` in the checkout, which is git-ignored because the repo is public. The userConfig `telemetryDir` (an absolute path) moves it, and `/reliability` prints the folder in use. Each file is trimmed to about 1 MB. Versions before this change wrote to `~/.claude/agent-reliability/`.

- **Fields:** `ts`, `agentId`, `toolUseId`, `tool`, `commandKey`, `mode`, `modeSource`, `event`, `classification`, `reason`, `action` (`allow`, `would_block`, `deny_repeat`, `deny_refusal`, `would_escalate`, `deny_escalate`, `would_deny_needs_user`, `deny_needs_user`, `would_hold`, `deny_hold`), `preReason`, `errorKey`, `incidentId`, `incidentState`, `decidedBy`, `stateToken` (12-character prefix), `hookMs`. `jev_advice` adds `advisor`, `status`, `failure_kind`, `same_approach`, `decision`, `p`, `probabilities`, `would_apply`, `applied`, `fallback_action`, `jevMs`.
- **Events:** `incident_opened`, `repeat_failed`, `strategy_failed`, `escalation_due`, `escalation_requested`, `escalation_started`, `recovery_in_progress`, `recovery_done`, `needs_user`, `needs_user:after_prompt`, `hold`, `incident_closed`, `repeat_blocked`, `retry_repeat`, `refusal`, `refusal_repeat`, `jev_advice`, `jev_skipped`.
- **What is never logged:** tool output or file contents. `errorKey` is a hash. An example is in [docs/telemetry-sample.jsonl](docs/telemetry-sample.jsonl).
- **Diagnostics dump:** `dumpRaw` (off by default) writes filtered result fields to `diag-<session>.jsonl`. It is meant only for re-checking the runtime API.

## Migration from retry-loop-breaker 0.1

- The folder, plugin name and state key are now `agent-reliability`. `/retry-guard status|reset` still works as an alias. All old userConfig keys keep their meaning.
- Changed defaults: `jevEnabled` is now **false**, because it needs an OpenRouter key.
- 0.2 → 0.3: the session state keeps its schema; new fields are filled in. New options are `ruleC`, `jevAdvisor`, `jevAdvisorMinConfidence`, `includePromptInJev`, `datasetCapture` and `datasetDir`. A user prompt now supersedes open incidents instead of only closing NEEDS_USER ones.
- Session state from 0.1 is **not imported**. State lives per session, and an old-shaped state is dropped rather than reused.
- Remove any `--plugin-dir ./retry-loop-breaker`, so that only one mod hooks Bash.

## Limits

- Edits outside Claude's tools are seen only through the git token. Outside a git repository, if the diff is over 4 MiB, if there are more than 50 untracked files, or if git takes more than 1.5 s, the token is unknown and Rule B does not block.
- A strategy is "at least one change between two failing runs". An unrelated edit still counts, so escalation may come early.
- The mod can only refuse calls or add a note. It cannot stop the main loop from editing while recovery runs.
- "Recovery finished" for a background recovery agent relies on that agent's `turn.complete`. That path was not exercised in a real session.
- Rules A and B leave subagent verifications alone by default (`mainAgentOnly`). Rule C and the Jev advisor cover subagents always.
- Rule C recognises refusals by their text. A new runtime wording is missed until it is added. Three wordings were found in live 0.3 runs; "needs approval" is today's. Matching never guesses: `touch f` and `New-Item f` are different commands to Rule C.
- An interactive "user pressed Deny" could not be produced headless. It is assumed to read like the observed denial texts (engine tests cover the rule itself).
- A streak key for a non-verification command is its first two tokens (`node scripts/x.mjs`, `az boards`), so related commands share one incident.

## Report: `/reliability-report`

The `reliability-report` skill reads the transcript history (read-only), the local dataset and the telemetry. It writes a redacted `incidents.jsonl` and a `report.md` to `~/.claude/agent-reliability/dataset/`. The report covers error categories, failure streaks, the calls Rules B/C would have refused, the Jev decisions (runtime, or offline with `--jev`), and a retrospective "was the decision useful?" section. That section is a heuristic, not ground truth.

## What the history shows

From a full-corpus run on 2026-10-20 (`/reliability-report --since all --jev`):
- 683 transcript files; 595 had tool calls, and 88 without tool calls were skipped.
- 17,752 tool calls and 887 tool errors (~5%).
- 111 failure streaks (at least 2 consecutive errors), 55 of them in subagents.

The commonest failures are:
- a nonzero exit of an ad hoc command (28%, much of it informational: diff, `where`, multi-file `cat`);
- harness refusals (13%);
- user denials (9%);
- a wrong path (6%);
- MCP/browser errors and timeouts (5% each).

Real test/build failures are under 5%.

Replayed over that history:
- Rule B as in 0.2 would have refused **0** calls, because agents almost always write `cd X && npm test 2>&1 | tail`. With 0.3's unwrapping it refuses 1.
- Rule C would have refused **77** calls (35 harness, 42 user denials) and touched 14 streaks, including the two longest: 10 and 11 retries after a denial, in subagents.
- 20 streaks of 3 or more are caught by neither rule. These are mechanical mistakes (path, shell syntax, missing module) and environment failures, which is where the Jev advisor is meant to help.

Offline Jev labels on 60 streaks (asked at the 2nd failure, every streak of 3+ included) came back 60/60, at a p50 of 590 ms, for $0.0032 in total:
- **Decisions:** RETRY_NEW_STRATEGY 70%, ASK_USER 22% (permission, approval and login loops), MARK_BLOCKED 8%.
- **failure_kind:** harness_refusal 53%, agent_mistake 18%, environment_or_external 17%.
- **Retrospective heuristic (not ground truth):**
  - 27 RETRY decisions were followed by a different action and a recovery.
  - 11 non-retry decisions came where the agent kept failing anyway; 31 failed calls would have been saved.
  - 1 RETRY decision was a miss (a 5-long PowerShell streak).
  - 21 decisions gave no clear signal.

**Against the first mining in this work** (660 files, 17,318 calls, 859 errors, 155 harness refusals, 63 user denials, 106 streaks), the differences have these causes:
- **Window.** That mining took files modified since 2026-09-20; this run reads all history plus the sessions added since, including the 0.3 live test runs. That gives more files, calls, errors and streaks.
- **Classification.** That count matched refusal phrases over every error text, so one error could count as both kinds. It also counted plugin "withheld its result" notes, which are not refusals. The report gives each error exactly one category, with a user denial taking precedence, and it counts auto-mode classifier denials as user denials. So the harness count drops from 155 to 112 and the user count rises from 63 to 82.

Whether the decisions help at runtime is what the shadow pilot measures. The data is in `attempts-YYYY-MM.jsonl` and in telemetry `jev_advice`.

**Live checks of 0.3** (headless Haiku sessions on a scratch repo, 2026-10-20):
- A `cd app && npm test 2>&1 | tail -20` failure was recognised from the runner summary and opened an incident.
- Jev was asked at the 2nd failure, in the main agent and in a subagent.
- In apply + enforce mode, ASK_USER (p=1.00) became NEEDS_USER, and Claude quoted the note.
- A resent `touch` that needed approval was refused by Rule C.
- An interactive user Deny was not produced (headless cannot); engine tests cover that path.

## Test

```bash
cd agent-reliability && npm test
```

```bash
claude plugin validate agent-reliability && claude plugin test agent-reliability
```
