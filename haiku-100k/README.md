# haiku-100k

Haiku input above 100k tokens per request is billed at the higher rate ($0.50 vs $0.10). Each request carries the whole conversation, so the rule is: **the context of every Haiku request stays under 100k**. This plugin bundles the three layers that keep it there.

| Part | What it does |
|---|---|
| `agents/haiku-case.md` → subagent type `haiku-100k:haiku-case` | Haiku 5.5, `autoCompactWindow: 100000` (the minimum Claude Code accepts; lower values are silently ignored), tools limited to Read, Grep, Glob, Bash, Write, Edit, Skill, so it starts at ~14-17k |
| `/haiku-100k:setup` (`commands/setup.md`, `scripts/setup.mjs`) | Run once per machine. With your OK it writes `modelSettings` → `autoCompactWindow: 100000` for `claude-haiku-5-5` and `haiku` in `~/.claude/settings.json`, so **main** Haiku sessions compact at 100k too. A plugin cannot change settings by itself. `--remove` undoes it. |
| `hooks/register.ts` | On a Haiku loop (main or subagent), cuts a tool result that would push the next request past 92k to head + tail, with a note on how to get the rest. Toasts every Haiku request over 100k, so a leak is visible. |

The engine compacts before the window is reached (about 66-74k for a 100k window; the margin is not documented).

**Not covered:** a single prompt or subagent brief that is itself over 100k. Put long input in a file and read it in parts.

## Install

```bash
claude plugin marketplace add <path-to>/haiku-100k
claude plugin install haiku-100k@haiku-100k
```

Then run `/haiku-100k:setup` once. Function hooks need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Tested (2026-10-19)
A `haiku-100k:haiku-case` subagent read a 20-chunk file of about 240k tokens in full: 21 requests, max 64,369 tokens, 4 auto-compactions (at 66-70k), 0 requests over 100k, all 20 answers right. `claude plugin test ./haiku-100k`: 6/6.
