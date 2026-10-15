---
name: fast-compact
description: "Opt-in verbatim compaction for this session: previews how much the fast-compact rules would cut (old tool outputs and bulky tool inputs trimmed, all text and every tool call kept, no model, no summary) and arms the next manual /compact to use them once. Trigger only on \"/fast-compact\", \"/fast-compact preview\", \"/fast-compact off\" or an explicit request to compact with fast-compact; plain /compact and auto-compaction keep the built-in summary."
---

# fast-compact

`/compact` normally replaces the conversation with a summary. fast-compact replaces it with
the same conversation, verbatim, minus the bulk of old tool outputs and inputs, by fixed rules
(no model call). It is opt-in: the plugin's hook does nothing unless this skill arms it, the arm
lasts 15 minutes and is used by one manual `/compact`. Auto-compaction is never affected.

`<plugin-root>` below is the folder two levels above this SKILL.md (it holds `scripts/` and
`hooks/`). The script needs only Node.js 22.18+.

## Arguments

- none → preview, then arm (steps 1–3).
- `preview` → step 1 only; do not arm.
- `off` → run `node <plugin-root>/scripts/preview.ts --disarm`, report it, stop.

## 1. Preview

Run from the session's working directory:

```
node <plugin-root>/scripts/preview.ts
```

It reads this session's transcript (the newest `*.jsonl` of the project in
`~/.claude/projects/`, from the last compaction on; pass `--session <file>` if the newest is not
this session) and prints the estimated character reduction, the per-tool decisions and whether
function hooks are enabled. Report to the user in 3–5 lines: the reduction, what gets cut
(outputs trimmed, stale reads, inputs trimmed), and that nothing is removed.

Stop and tell the user instead of arming when:

- `hooks on: NO` → the hook cannot load, so `/compact` would summarize as usual. They need
  `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (e.g. under `env` in `~/.claude/settings.json`) and a
  restart, and the plugin installed (README.md).
- the outcome says it would fall back (below the 25% minimum) → say so; the built-in summary is
  what they would get anyway.

## 2. Arm

```
node <plugin-root>/scripts/preview.ts --arm
```

## 3. Hand over

Tell the user, in one line, to type `/compact` now (within 15 minutes). The hook shows a toast:
`fast-compact: verbatim, no summary: …`, or `fallback to built-in summary (…)` when the reduction
is too small or anything fails. You cannot run `/compact` yourself; do not claim it ran.

## Rules (what the hook does)

Every message and every tool call stays, in order. The first message and the newest 6 are not
touched. For older calls:

| Tool | Input | Output |
|---|---|---|
| Edit, MultiEdit, Write, NotebookEdit | long strings cut to 300 chars; a Write superseded by a later Write of the same file loses its content | kept |
| Read | long strings cut to 400 | dropped to a note when the file was read or edited again later, else first 300 chars |
| Grep, Glob, LS, ToolSearch, WebSearch | cut to 400 | first 150 chars |
| Agent, Task, WebFetch | cut to 400 | first 600 chars |
| Bash, PowerShell, MCP, others | cut to 400 | kept when an error or ≤ 1200 chars, else first 200 + last 200 |

Each cut leaves a `[fast-compact: N chars cut; …]` note saying how to get it back (re-read the
file, re-run the tool). Text already cut is never cut again.
