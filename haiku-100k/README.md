# haiku-100k

Haiku input above 100k tokens per request is billed at the higher rate ($0.50 vs $0.10). Each request carries the whole conversation, so the rule is: **the context of every Haiku request stays under 100k**.

Two layers:

1. **Engine auto-compact at 100k** (the minimum Claude Code allows):
   - `autoCompactWindow: 100000` in `.claude/agents/haiku-case.md` for subagents;
   - `modelSettings` for Haiku in `~/.claude/settings.json` for main Haiku sessions.
   The engine compacts before the window is reached (observed near 73k for a 100k window; the margin is not documented).
2. **This mod**, for what auto-compact cannot catch:
   - **`tool.call`:** on a Haiku loop (main or subagent), a tool result that would push the next request past 92k tokens is cut to head + tail. The model reads how to get the rest (re-run narrower).
   - **`turn.step`:** every Haiku request above 100k is counted and shown as a toast, so a leak is visible.

Not covered: a single prompt or subagent brief that is itself over 100k, and compaction timing inside the engine.

Install (user scope, all sessions):

```bash
claude plugin marketplace add D:/XionTechs/Laya/haiku-100k
claude plugin install haiku-100k@haiku-100k
```

Needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Tests: `claude plugin test ./haiku-100k`.
