---
name: reliability-report
description: "Report on failure loops in the user's Claude Code history: error categories, failure streaks (main agent and subagents), which streaks agent-reliability Rule B (exact repeat) and Rule C (refusal loops) would have caught, what TypeSafe Jev would advise (RETRY_NEW_STRATEGY / ESCALATE_MODEL / ASK_USER / MARK_BLOCKED / STOP_AND_REPORT), and telemetry counts. Reads ~/.claude/projects transcripts read-only; writes a redacted incidents.jsonl and report.md to ~/.claude/agent-reliability/dataset/. Use on \"/reliability-report\", \"why does my agent loop\", \"analyse failures in my sessions\"."
compatibility: Node.js 22.18+ (it imports the shared redaction module as TypeScript, which Node strips without a build step). --jev needs OPENROUTER_API_KEY (hosted call that sends redacted attempts to TypeSafe Jev and costs money).
---

# Reliability report

Answers "where do my agents waste calls on failures, and would agent-reliability have stopped them?" from real history.

## Run

```bash
node "<skill dir>/scripts/report.mjs" [--since <YYYY-MM-DD|all>] [--jev] [--jev-n 60 | --jev-all] [--out <dir>] [--telemetry <dir>]
```

- `--since` defaults to the last 30 days; `all` reads every transcript (the baseline run, a few seconds).
- `--jev` labels streaks offline (asked at the 2nd failure, like the runtime advisor). Default sample 60 streaks, all streaks of 3+ first, about $0.003 per 60. Print cost is shown. Ask the user before using it: it sends redacted tool commands and error text to a hosted model. The redaction is the runtime's policy (`hooks/redact.ts`: home and drive paths, emails, Azure DevOps organizations, tokens and secrets, long ids, and the reader's own username). Unlike the runtime advisor, the offline request also carries the up to 3 calls before the streak (`before`, action cut to 160 chars). Labels carry `label_source: jev` and are not ground truth.
- `--out` defaults to `~/.claude/agent-reliability/dataset/` (outside every repo). `--telemetry` is only needed if the plugin's telemetry folder is not found automatically.

## Inputs (all read-only)

1. `~/.claude/projects/**/*.jsonl`, subagent transcripts included.
2. `~/.claude/agent-reliability/dataset/attempts-YYYY-MM.jsonl`, written by the plugin at runtime. May not exist yet.
3. The plugin's telemetry folder, if found.

## Outputs

- `incidents.jsonl`: one redacted streak per line (the same policy as above: home and drive paths, emails, Azure DevOps organizations, tokens and secrets, long ids and the reader's username removed; no prompts; error text cut to 400 chars). Never commit it.
- `report.md`: corpus counts (files read/skipped, calls, errors), error categories, streaks, would-be Rule B/C catches and the streaks they miss, Jev decision distribution, the retrospective "was the decision useful?" section, telemetry counts.

## After running

Read `report.md` and summarise for the user: the commonest failure kinds, the loops Rules B and C still miss, and (with `--jev`) Jev's most proposed actions. State plainly that section 6 is a retrospective heuristic: a decision followed by success shows the events are related in time, not that the decision caused the success. Do not paste raw transcripts or the dataset into the repo.
