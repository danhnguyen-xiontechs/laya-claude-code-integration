---
description: Set main Haiku sessions to auto-compact at 100k tokens, so every Haiku request stays under the 100k price step.
argument-hint: "[--remove]"
allowed-tools: Bash(node:*)
---

Set up the haiku-100k plugin's third layer: the auto-compact window of **main** Haiku sessions. Subagents already get it from the plugin's `haiku-case` agent, and the plugin's hook covers tool results. A plugin cannot change the user's settings by itself, so this command does it, only with the user's OK.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" $ARGUMENTS` with no `--apply` first. It prints what it would change in `~/.claude/settings.json`: `modelSettings` for `claude-haiku-5-5` and `haiku`, `autoCompactWindow: 100000`, and nothing else.
2. Show the user that one line and ask whether to write it. With `--remove` in the arguments, the change takes the window off again.
3. On a yes, run it again with `--apply`, or `--remove` alone. It keeps a backup next to the file (`settings.json.bak-haiku-100k`).
4. Tell the user it takes effect in new sessions. To check it, start a Haiku session and run `/context`: it should show `/ 100k`.

Never edit `settings.json` any other way, and never print its other contents. It can hold keys and tokens.
