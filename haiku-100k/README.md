# haiku-100k

Haiku input above 100k tokens per request is billed at the higher rate ($0.50 vs $0.10). Each request carries the whole conversation, so the rule is: **the context of every Haiku request stays under 100k**. This plugin bundles the three layers that keep it there.

| Part | What it does |
|---|---|
| `agents/haiku-case.md` → subagent type `haiku-100k:haiku-case` | Haiku 5.5, `autoCompactWindow: 100000` (the minimum Claude Code accepts; lower values are silently ignored), tools limited to Read, Grep, Glob, Bash, Write, Edit, Skill, so it starts at ~14-17k |
| `/haiku-100k:setup` (`commands/setup.md`, `scripts/setup.mjs`) | Run once per machine. With your OK it writes `modelSettings` → `autoCompactWindow: 125000` for `claude-haiku-5-5` and `haiku` in `~/.claude/settings.json`, so **main** Haiku sessions compact near 92k (see "Window 100k vs 125k" below). A plugin cannot change settings by itself. `--remove` undoes it. |
| `hooks/register.ts` (slim start) | In a Haiku session, tools a Haiku session rarely needs go behind ToolSearch once, at session start: every MCP tool except the app's `ccd_turn`/`ccd_session`, and every built-in except Agent, Bash, Edit, Glob, Grep, Read, Write, Skill, ToolSearch, AskUserQuestion. The model loads one by name when it needs it. Measured: the first request of a headless Haiku session went 42,499 -> 22,058 tokens. `HAIKU_100K_SLIM=0` turns it off. `/context` still counts the deferred built-ins at full size; the real request is smaller. |
| `hooks/register.ts` (guard) | On a Haiku loop (main or subagent), cuts a tool result that would push the next request past 92k to head + tail, with a note on how to get the rest. Toasts every Haiku request over 100k, so a leak is visible. |
| `skills/haiku-build/` → skill `haiku-100k:haiku-build` (v3) | The bmad-build flow on Haiku in seven stages, each routed to a model by a script: Opus writes the spec (its only call), Haiku implements and runs the unit tests on a fixed retry ladder (T1, T2, one Sonnet retry, T3), three parallel Sonnet reviewers review the diff and the main session triages, Haiku fixes with at most one Sonnet re-review, and a script sets the final status (`done`, `done_with_findings`, `blocked`). Optional JEV advice (`HAIKU_BUILD_JEV=apply\|off`). Every run is measured per request against the 100k step. See `skills/haiku-build/README.md`. |
| `skills/haiku-build-auto/` → skill `haiku-100k:haiku-build-auto` | The same flow with no human: it never asks the user (an Opus or Fable start moves the main stages to Sonnet by itself, a failed plan or review is retried once, blocking questions halt as `intent gap`), the fix loop stops after 3 rounds, and every run ends in exactly one status with `result.json` and, under spec folder + story id dispatch, the story spec updated. `scripts/auto.mjs` makes those decisions; the stage mechanics are haiku-build's own steps. See `skills/haiku-build-auto/SKILL.md`. |
| `skills/subagent-model-router/` → skill `haiku-100k:subagent-model-router` | Picks the model tier (haiku / sonnet / opus) for each subagent before it is spawned, from local rules plus TypeSafe Jev or Laya, with a cascade retry and USD / call caps. Ships **off the hook**: nothing is registered, the default mode is `shadow` with provider `none`. `SUBAGENT_ROUTER_MODE=off` turns it off. See `skills/subagent-model-router/SKILL.md`. |
| `hooks/reliability/` (agent-reliability 0.3) | Stops unproductive retry loops. **Observe mode by default**: it only logs.<br>• **Rule B:** a 3rd identical failing test/build with nothing changed is refused. `cd X && … 2>&1 \| tail` is recognised, and so is PowerShell.<br>• **Rule C:** a refused call is not resent, and a user denial is not worked around by another tool or path; only `/reliability allow <n>` lifts it.<br>• **Rule A** (off by default): after 2 failed recovery attempts it asks for the `haiku-100k:opus-recovery` agent, then the user.<br>• **Jev Recovery Advisor** (`jevAdvisor`: off \| shadow \| apply, default off; needs `OPENROUTER_API_KEY` and is paid per call): from the 2nd consecutive failure, Jev picks one of 5 recovery actions inside the core's limits.<br>• **Local dataset:** sanitized attempts go to `~/.claude/agent-reliability/dataset/`.<br><br>`/reliability` shows status, switches mode and lifts denials. `AGENT_RELIABILITY=off` is the kill switch. Telemetry: userConfig `telemetryDir` (empty = `telemetry/` in the plugin folder, git-ignored). Source and docs: `agent-reliability/` in the repo; this is a copy made by `agent-reliability/scripts/ship-haiku-100k.mjs`. |
| `hooks/pace/` (effort-pace, 0.9; formerly haiku-pace) | Per-step effort for **Haiku and Sonnet** model requests (**apply by default**; Opus is never touched), and a guard for Bash calls that would hold a turn for minutes (every model, Opus included).<br>• **Routine step** (every call of the previous step read something and succeeded) → effort `low`.<br>• **Pivot step** (start of a turn, after a failed call, after an Edit/Write of ≥ 30 lines) → TypeSafe Jev picks `low`/`medium`/`high` from the redacted previous calls (`paceJev`, needs `OPENROUTER_API_KEY`, paid per call, at most `paceJevBudget` = 40 per session, 1.5 s timeout); off, unsure (p < 0.6) or failed → `high`.<br>• Anything else, or a session/caller already at `xhigh`/`max`: unchanged.<br>• **Guard:** a GNU `timeout N` as a command word with N ≥ 3600 (GNU timeout counts seconds; e.g. `timeout 300000` is refused), a foreground `claude plugin test` / `claude -p`, and `python -` fed by a heredoc (hung twice in Git Bash) are refused with how to run them instead. Windows `timeout /t 300` and `echo timeout 300000` are not matched. Only the Bash tool is checked; when unsure it does not refuse.<br><br>`/effort-pace` (`/haiku-pace` is an alias for one version) shows the mode and its source, the guard state, the effort switches (e.g. `medium→low ×40`), the step and Jev counts (read from the session's telemetry file, so they survive a reload), and p50 step time and output tokens per class. `/haiku-pace shadow\|off\|apply\|auto` switches it for the session. `/haiku-pace off` stops effort adaptation and Jev but keeps the guard on; `EFFORT_PACE=off` (`HAIKU_PACE` is read as a fallback for one version) is the kill switch for the whole mod, guard included. Telemetry: `pace-<session>.jsonl` next to agent-reliability's (one line per step: model, class and why, effort before/after and whether it was applied, Jev choice, p and latency, duration, output and cache tokens; one line per guarded command). Why: in session 830cca7b ~70% of a Haiku turn was hidden thinking (single Grep/Read steps at 27–40 s), and one foreground command cost 321 s. |
| `skills/reliability-report/` → skill `haiku-100k:reliability-report` | A report over your Claude Code history (read-only) and the local dataset/telemetry. It covers error categories, failure streaks, what Rules B/C would have refused, and the Jev decisions (offline labels with `--jev`), with a retrospective heuristic section. Output: `incidents.jsonl` and `report.md` in `~/.claude/agent-reliability/dataset/`, outside the repo. |

## Window 100k vs 125k: what the number means

The window is **not** the size of a request. It decides **when the engine compacts**. The engine keeps a fixed 33,000-token "autocompact buffer" below the window (`/context` shows it), so:

| Window | Compacts at | Room for work after the fixed start | Used for |
|---|---|---|---|
| 100k | ~67k | subagent (starts ~14k): ~53k. App main session (starts ~73k): **none**. It is already past 67k, so it compacts on every request until the chat reports the context window full | subagents |
| 125k | ~92k | app main session: ~19k (more with the slim start) | main sessions |

Every request is the fixed start (system prompt, tools, skills) plus the conversation so far. It grows until it reaches the compaction point, then drops back. With either window it stays **under 100k**, the price step. At 125k the guard hook covers the last 8k: a tool result that would push past 92k is cut. 100k is the lowest window Claude Code accepts. `/haiku-100k:base` saves the full `/context` breakdown to `~/.claude/haiku-100k-base.json`.

**Not covered:** a single prompt or subagent brief that is itself over 100k. Put long input in a file and read it in parts.

## Install

From GitHub, in one line (the repo root has a marketplace named `danhnguyen-xiontechs` that points to this folder):

```bash
claude plugin marketplace add danhnguyen-xiontechs/laya-claude-code-integration --sparse .claude-plugin haiku-100k
claude plugin install haiku-100k@danhnguyen-xiontechs
```

`--sparse` fetches only the marketplace file and this plugin, not the rest of the repo. To update later:

```bash
claude plugin marketplace update danhnguyen-xiontechs
claude plugin update haiku-100k@danhnguyen-xiontechs
```

From a clone you already have, add the repo root instead:

```bash
claude plugin marketplace add <path-to-clone>
claude plugin install haiku-100k@danhnguyen-xiontechs
```

Then run `/haiku-100k:setup` once. The `haiku-build` skill comes with the plugin; it needs Node.js 22+ for its scripts. Function hooks need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Tested (2026-10-19)
A `haiku-100k:haiku-case` subagent read a 20-chunk file of about 240k tokens in full: 21 requests, max 64,369 tokens, 4 auto-compactions (at 66-70k), 0 requests over 100k, all 20 answers right. `claude plugin test ./haiku-100k`: 6/6.

## Offline Jev evaluation (2026-10-20, observed)
`reliability-report --since all --jev` on the local history: 596 transcripts read, 111 failure streaks. Jev labelled the default sample of 60 (all 28 streaks of 3+ failures, then 32 of 2). Offline only: `jevAdvisor` stayed `shadow`, nothing was enforced, and no runtime code changed. Output stays in `~/.claude/agent-reliability/dataset/`.

**Payload check, before the call.** Each request held only `model`, `state` (the first 2 failed attempts, plus up to 3 earlier calls; action ≤220 chars, error ≤400 chars) and `questions`. No prompts, no full tool output, no auth values (header names only were recorded). A dry run of the payloads from that run found drive-letter paths (4 requests), one email and two Azure org URLs. The live run above was made before the shared redaction policy (`hooks/redact.ts`) and is not repeated. A later capture of 60 offline requests, with the network replaced by a local recorder, found no drive path, home path, username, email, Azure org URL, token or key-value secret. The only long-id hit was a 36-character tool-name field (`attempts[].tool`), which is not masked. The Azure project segment (`dev.azure.com/<org>/<project>`) is not masked either. The 400-char error excerpts are tool output, so they are included by design.

**Results (observed).**
- 60 asked, 60 answered, all HTTP 200. Latency p50 558 ms, p90 1,140 ms, max 1,210 ms. Input tokens 76,228. Cost $0.0032.
- `next_step` (top choice): RETRY_NEW_STRATEGY 43 (72%), ASK_USER 13 (22%), MARK_BLOCKED 4 (7%), ESCALATE_MODEL 0, STOP_AND_REPORT 0.
- `failure_kind` (top choice): harness_refusal 32, agent_mistake 11, environment_or_external 10, informational_nonzero 4, real_failure 3, user_refusal 0.
- `same_approach` noul: median 0.71 (range 0.18 to 0.98).
- Confidence: median top probability 0.99 for `failure_kind`, 0.91 for `next_step`.

**ASK_USER / MARK_BLOCKED (17 streaks).** ASK_USER 13 (9 harness refusals, 4 environment failures); MARK_BLOCKED 4 (all harness refusals). Missing credentials: at least 2 deploy streaks failed with "no credentials" (2 of the 4 environment cases were checked). Repeated refusals: 2 MARK_BLOCKED streaks ran 8 to 9 further failed calls. Unavailable dependencies: no environment failure was labelled MARK_BLOCKED.

**Retrospective heuristic, not ground truth, not causal.** This compares each recommendation with what the agent did next in the historical transcript. The recommendation was never shown to that agent, so these counts show what happened without it, not what would happen with it. Timing is not causation.
- RETRY_NEW_STRATEGY (43): the next call differed in 38; the next 3 calls all succeeded in 31.
- ASK_USER (13): 12 further failed calls across these streaks; the next 3 calls all succeeded in 3.
- MARK_BLOCKED (4): 17 further failed calls; the next 3 calls all succeeded in 2.
- Section 6 buckets: agreed 28, saved_calls 9 (29 further failed calls), miss 1, neutral 22.

**Agreement with the regex classifier.** A rough mapping of my own, not a ground truth: 27 of 42 comparable streaks agree. All 5 streaks the regex labels `user_denied` were labelled `harness_refusal` by Jev. Their error text says the denial came from the Claude Code auto mode classifier, so the regex label may be the wrong one. Review `classify()` before using these labels to evaluate anything.

**What this implies for the next iteration.**
- These numbers do not show that Jev improves outcomes. The evaluation has no comparison arm and no outcome that the advice caused.
- Jev never picked ESCALATE_MODEL or STOP_AND_REPORT as its top choice, and their mean probabilities are 0.01 or less. Either the history has no such cases or the criteria do not fit it. Check this before trusting the five-way choice.
- Keep `apply` off. The next evidence needs advice shown in shadow mode, with outcomes recorded over time, not more offline labels.
- Fix the `user_denied` rule in `classify()` first.
- Runtime and offline redaction share one policy (`hooks/reliability/redact.ts`): home and drive paths (drive paths keep only the file name), emails, Azure DevOps organizations, tokens and secrets, and long ids. The offline report also masks the reader's username; the runtime does not mask bare usernames. Azure project names are not masked. The advisor and near-duplicate payloads were checked by a local capture (counts only), prompt on and off.
