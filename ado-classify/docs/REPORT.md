# Laya ADO task classification: status report

Date: 2026-10-08 · Status: **working POC (command line)**, Claude Code integration (MCP) designed but not built yet

## TL;DR

- When a developer picks up an ADO task, a local tool reads the task and tells them **which module of the codebase it belongs to, with the code paths**, so Claude Code (or the developer) starts in the right place.
- It runs **fully on the developer's machine**: Laya (a small open-source classifier) plus a keyword search. No LLM call, no task data sent to any AI service.
- On 20 real, already-completed ESS tasks it picked the right module first time in **18/20**, in about **1 second** per task.
- Next step: package it as an **MCP server** so Claude Code and Claude Desktop can call it directly. Estimate: about one day.

## Why this use case

We tested several ways to use Laya inside Claude Code: picking the Claude model per request, per workflow step, gating subagents, choosing review/test depth. None beat the simple alternative (one fixed model, or plain rules): they added cost or latency.

What Laya is good at is narrow: **read a short text and pick one option from a small fixed list**. "Which module does this task touch?" is exactly that shape. It is also a step a large model currently spends tokens and turns on, searching the codebase at the start of every task.

## How it works

```
                         one-time / when docs change
  ess-be/docs/features/*.md ──────────────────────────► module catalog (27 modules)
  (written by the team)                                  name, short description, code paths

                         per task
  ADO work item ──► fetch (read-only, ESS items only) ──► title + description + repro steps + acceptance criteria
                                                                   │
                                     Step 1: keyword search (BM25) over all 27 module docs
                                             → 8 most relevant modules for THIS task      (< 1 ms)
                                                                   │
                                     Step 2: Laya picks 1 of those 8, with a probability  (~1 s, CPU)
                                                                   │
                                     Output: top 3 modules + probability + code paths
```

Example output:
```
ADO #19279 (Bug)
  -> attendance        0.54  Controllers/Attendance/AttendanceController.cs, Services/Attendance/AttendanceService.cs
     leave-time-off    0.16  Controllers/LeaveRequests/...
     approval-delegation 0.09 ...
```

Key design points:
- **All 27 modules stay candidates.** The keyword search only narrows to 8 per task. On the 20 test tasks the right module was always inside those 8.
- **Why two steps.** Laya scores every option inside one shared token budget. With 27 options each description is cut to a few words and the confidence score is not calibrated (11+ options). Measured: Laya alone on 27 options = 6/20; keyword search alone = 9/20; both together = 18/20.
- **Nothing is hand-maintained.** The option list and Laya's question file are generated from the team's existing feature docs. When docs change, re-run one script.
- **Fail-safe.** If Laya is unavailable, the tool returns the keyword-search result and says so.

## Before vs after

| | Today | With this tool |
|---|---|---|
| Developer gets an ADO task | Reads it, finds the relevant code manually or asks Claude Code to search | Gets "module X, files Y" in about 1 s |
| Claude Code starts a task | Spends several turns (grep, open files) finding where to work, paid with model tokens | Starts from the suggested paths |
| Where task data goes | Into the Claude conversation | Unchanged: Claude still needs the task text to code. The classification itself runs locally and adds no external call |

The time saved per task is **not measured yet** (see next steps).

## Developer workflow after rollout

Target state once the MCP server and the slash command are installed (not built yet):

```
Developer types in Claude Code:  /ado-task 19279
        │
        ▼
Claude Code loads .claude/commands/ado-task.md
        │   the command tells Claude: "call classify_ado_task first, then start the task"
        ▼
Claude calls the MCP tool
        │   request sent to the MCP server (JSON-RPC over stdio):
        │   { "method": "tools/call",
        │     "params": { "name": "classify_ado_task",
        │                 "arguments": { "id": "19279" } } }
        ▼
mcp_server.py  (runs for the whole session; Laya, keyword index and ADO token stay in memory)
  ├─ ADO: read metadata (project, area, iteration) ── read-only
  ├─ Scope check: wrong project, or no "ESS" in area/iteration
  │     → refuse with a reason, task content is NOT read
  ├─ ADO: read content (title, description, repro steps, acceptance criteria)
  ├─ Catalog: modules.json (27 modules from docs/features; rebuilt if docs are newer)
  ├─ Keyword search (BM25): score all 27 modules → keep 8 candidates   (< 1 ms)
  ├─ Laya: options = those 8 → pick 1, with a probability             (~1 s, CPU)
  ├─ Log: suggestions.jsonl (ID, top 3, probabilities; no titles)
  ├─ Laya fails / times out → return the keyword-search result, "engine": "bm25"  (fail-open)
  └─ ADO fails (login expired) → clear error: "run az login --tenant <tenant>"
        │
        ▼
Tool result returned to Claude:
  { "id": "19279", "type": "Bug",
    "task": { "title": "...", "description": "...", "repro": "...", "ac": "..." },
    "top": [ { "module": "attendance", "p": 0.54,
               "doc": "docs/features/attendance.md",
               "paths": ["src/Ess-App.API/Controllers/Attendance/AttendanceController.cs",
                         "src/Ess-App.Application/Services/Attendance/AttendanceService.cs"] },
             { "module": "leave-time-off", "p": 0.16, ... },
             { "module": "approval-delegation", "p": 0.09, ... } ],
    "engine": "bm25+laya" }
        │
        ▼
Claude sees the task + the module hint → starts in the right place
  ├─ high probability: read docs/features/attendance.md
  │     (sections 1–5; for a bug also 7–9 and 12, per the team's docs/features/README.md)
  │     → open the files in "paths" directly instead of searching the whole repo
  └─ low probability: treat the top 3 as hints and search as usual
        │   (high/low threshold is provisional until ~50 logged suggestions)
        ▼
Code → run tests → developer reviews the diff      (unchanged, the tool does not intervene)
        │
        ▼
Developer commits: "fix(attendance): ... (BUG-19279)"   (existing team convention)
        │
        ▼
feedback.py (periodic): compare logged suggestions with the files each commit actually changed
  ├─ match → nothing to do
  └─ miss  → list modules that are often wrong → improve their description or feature doc
```

What stays the same: the developer still reviews every diff, Claude still does all the coding, and nothing is written back to ADO.

## How it plugs into Claude Code: MCP (proposed)

Today the tool is a set of Python scripts (`classify.py --id <workitem>`). Each run reloads the model, so it takes 8–12 s end to end even though classification itself is about 1 s. The integration we propose:

```
Claude Code / Claude Desktop
    │  tool call: classify_ado_task(id=19279)
    ▼
MCP server "ado-classify" (local Python process, keeps Laya loaded in memory)
    ├─ classify_ado_task(id)        fetch from ADO + classify
    ├─ classify_text(title, text)   for tasks not in ADO
    └─ list_modules()               show the current module catalog
```

- **MCP** (Model Context Protocol) is the standard way to give Claude Code and Claude Desktop extra tools. Claude calls the tool, gets back the short result, and continues coding.
- The server stays running for the session, so each call is about 1 s after the first.
- A `/ado-classify <id>` command (or one line in the repo's CLAUDE.md) makes Claude call it at the start of each task.
- Everything needed is already installed with Laya. Estimate: about one day, including re-running the 20-task test through the MCP path.

## Results

20 completed ESS tasks found through work item IDs in `ess-be` commit messages. The correct answer is derived automatically: the module whose feature doc lists the code files that the task's commits changed. No manual labelling.

| Approach | Correct (top 1) | Correct in top 3 | Time per task |
|---|---|---|---|
| Laya reads all 27 modules | 6/20 | 14/20 | 2.7 s |
| Keyword search only | 9/20 | 16/20 | < 1 ms |
| **Keyword top 8 → Laya (chosen)** | **18/20** | 18/20 | **1.1 s** |

Of the two misses, one is debatable (a performance-matrix bug on the profile page: the changed files say "profile", Laya said "talent-view"). The other is a real error (an ID-document field bug predicted as "tasks"). Full per-task table: [04-results.md](04-results.md).

## Data and security

- **Read-only** access to ADO. Nothing is written back.
- Only ESS items are fetched (project + "ESS" in area/iteration). Out-of-scope items are skipped before their content is read.
- Laya runs locally on CPU. Task text is not sent to any external AI service.
- Task content and results are stored outside the code repository. Client org and tenant settings stay in a local, git-ignored config file.

## Limitations

- **Small sample**: 20 tasks, one repo, one run each. One or two tasks of difference is not significant.
- **Depends on feature docs.** `ess-be` has good per-feature docs. A repo without them needs a hand-written module list or a code scan, which will be less accurate.
- **Not compared with an LLM yet.** Claude Haiku might do equally well. That comparison decides whether Laya is worth it over a cheap LLM call.
- **Benefit for coding not measured.** Accuracy is proven; turns or time saved for Claude Code is not.
- English tasks only so far. Earlier tests showed Laya is weak on Vietnamese text.

## Next steps

| # | Step | Effort | Decides |
|---|---|---|---|
| 1 | Build the MCP server + `/ado-task` command + suggestion log | ~1 day | Usable inside Claude Code / Desktop (workflow above) |
| 2 | Compare with Claude Haiku on the same 20 tasks | ~0.5 day, small quota | Is Laya better or cheaper than an LLM for this |
| 3 | A/B on 2 real tasks, with and without the hint | ~0.5 day, some quota | Does it actually save Claude Code turns and time |
| 4 | Extend to `ess-fe` (same feature names) and more tasks | ~1 day | Generalises beyond one repo |

**Recommendation: pilot further.** The mechanism works and is accurate on real tasks. Steps 1–3 are needed before deciding whether to roll it out to the team.
