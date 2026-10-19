# haiku-100k

Haiku input above 100k tokens per request is billed at the higher rate ($0.50 vs $0.10). Each request carries the whole conversation, so the rule is: **the context of every Haiku request stays under 100k**. This plugin bundles the three layers that keep it there.

| Part | What it does |
|---|---|
| `agents/haiku-case.md` → subagent type `haiku-100k:haiku-case` | Haiku 5.5, `autoCompactWindow: 100000` (the minimum Claude Code accepts; lower values are silently ignored), tools limited to Read, Grep, Glob, Bash, Write, Edit, Skill, so it starts at ~14-17k |
| `/haiku-100k:setup` (`commands/setup.md`, `scripts/setup.mjs`) | Run once per machine. With your OK it writes `modelSettings` → `autoCompactWindow: 125000` for `claude-haiku-5-5` and `haiku` in `~/.claude/settings.json`, so **main** Haiku sessions compact near 92k (see "Window 100k vs 125k" below). A plugin cannot change settings by itself. `--remove` undoes it. |
| `hooks/register.ts` (slim start) | In a Haiku session, tools a Haiku session rarely needs go behind ToolSearch once, at session start: every MCP tool except the app's `ccd_turn`/`ccd_session`, and every built-in except Agent, Bash, Edit, Glob, Grep, Read, Write, Skill, ToolSearch, AskUserQuestion. The model loads one by name when it needs it. Measured: the first request of a headless Haiku session went 42,499 -> 22,058 tokens. `HAIKU_100K_SLIM=0` turns it off. `/context` still counts the deferred built-ins at full size; the real request is smaller. |
| `hooks/register.ts` (guard) | On a Haiku loop (main or subagent), cuts a tool result that would push the next request past 92k to head + tail, with a note on how to get the rest. Toasts every Haiku request over 100k, so a leak is visible. |
| `skills/haiku-build/` → skill `haiku-100k:haiku-build` | The bmad-build flow on Haiku: Opus writes the spec and reviews the diff (2 closed calls), the Haiku main session builds and runs the unit tests, you pick `[1] Fix and report` or `[2] Not approved, report`. Every run is measured per request against the 100k step. See `skills/haiku-build/README.md`. |
| `skills/subagent-model-router/` → skill `haiku-100k:subagent-model-router` | Picks the model tier (haiku / sonnet / opus) for each subagent before it is spawned, from local rules plus TypeSafe Jev or Laya, with a cascade retry and USD / call caps. Ships **off the hook**: nothing is registered, the default mode is `shadow` with provider `none`. `SUBAGENT_ROUTER_MODE=off` turns it off. See `skills/subagent-model-router/SKILL.md`. |

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
