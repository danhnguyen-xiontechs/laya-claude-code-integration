---
name: build-skill-tool-workflow
description: Lifecycle for building a coding-agent tool (Claude Code skill, hook, plugin, MCP server, helper script) that uses TypeSafe Jev / Laya or rules, from brainstorm to the user's final review. Idea brief and user lock, design, implement behind a flag, unit tests, independent agent review, then one fair comparison on the same cases (plain Claude vs Claude + the tool with Jev/Laya/rules), with real token counts per case, a per-tool report.html and a main index.html that links to it. Use on "/build-skill-tool-workflow <idea|tool>", or when the user asks to brainstorm, build, measure or report a skill/hook/plugin/tool against plain Claude.
argument-hint: "[idea, tool name, or experiment dir]"
---

# Build Skill / Tool Workflow

The point of every experiment is to **measure what Jev / Laya (or the tool's rules) adds on top of plain Claude**. The deliverable is a small decision package: approved idea → implementation → tests → independent review → A vs B on the same cases → report the user can read in a minute.

The user owns two gates: **Gate A (idea lock)** before implementation and **Gate B (final decision)** at the end. Never implement before Gate A; never merge, publish, enable a hook globally or call it adopted before Gate B.

```text
0 Intake → 1 Brainstorm ─[Gate A]→ 2 Design → 3 Implement (flag) → 4 Tests → 5 Agent review
 → 6 Measure A vs B on the same cases (real tokens) → 7 Per-tool report → 8 Main report ─[Gate B]→ decision
```

Track the phase in `manifest.json` `status` (`schemas/experiment-manifest.schema.json`). A skipped phase is marked `N/A` with the reason, never silently dropped.

## The comparison: two arms only

| Arm | Folder | What runs |
|---|---|---|
| **A** | `runs/A-claude/<runId>/` | plain Claude Code, tool off |
| **B** | `runs/B-claude-<engine>/<runId>/` | Claude + the tool, with Jev / Laya live (or its rules when it has no engine; falls back to rules when the engine fails) |

Same case ids, prompt, fixtures, model and effort in both arms; each arm in its own session so it cannot see the other's edits; A must not load the tool. Rotate the order; repeat nondeterministic cases 2–3 times; with few cases call the result directional. `manifest.tool.provider` (`JEV`, `Laya`, `none` = rules) names the engine in the report.

## Artifact layout

```text
reports/skill-tool-lifecycle/
  index.html, index.json                 # main report: one row per experiment, links to report.html
  <tool-slug>/<experiment-id>/           # e.g. 20261016-sct-bench-01
    manifest.json                        # tool, status, recommendation, confidence, headline, deviations
    idea-brief.md  design.md  final-decision.md
    unit-tests.json                      # { suites: [{ level, command, passed, failed, skipped, notRun }] }
    agent-review.json                    # { findings: [{ severity, finding, ref, resolution }] }
    runs/A-claude/<runId>/results.json   # + run-notes.json, execution-log.html for agent runs
    runs/B-claude-jev/<runId>/results.json
    evidence/                            # what Claude read per case, token counts, sanitized logs
    summary.json  report.html            # built by build_tool_report.mjs, never hand-written
```

## 0. Intake

Classify: `skill | hook | plugin | mcp | helper | provider`. Read the existing implementation and its neighbours first (in this repo: `.claude/skills/*`, `hooks/`, `routing/`, `eval/`, `report/`, HANDOFF/REPORT files, the `web-test-laya-*` / `web-test-jev-*` pattern). Reuse the existing provider wrapper and fixtures. Create the experiment id and folder.

## 1. Brainstorm → idea brief (no code)

Fill `templates/idea-brief.md`: problem, what plain Claude does today, hypothesis, smallest useful intervention, **what Jev/Laya decides** and what happens when it is wrong, slow, down or malformed, alternatives (rules only, plain Claude, Jev, Laya), risks, non-goals, and **success criteria fixed before any data** (usually: tokens or turns saved, and no case gets worse). Offer 2–3 options with a recommendation; if a model call does not plausibly beat rules, say so.

**Gate A** — show the brief and ask the user (AskUserQuestion): approve / revise / hold / reject. Record the decision and date; set `status: APPROVED_FOR_IMPLEMENTATION`.

## 2. Design

Short `design.md` (`templates/experiment-plan.md` as checklist): contracts (hook I/O, CLI/JSON, MCP schema), what Claude decides vs what the tool decides, the flag that turns it off, timeout/malformed/unavailable fallback, redaction, the case set with what "pass" means per case, and how tokens will be measured. Freeze it (`evaluation.criteriaFrozenAt`) before running step 6.

## 3. Implement

Dedicated branch/worktree, repo conventions, provider behind a narrow adapter so tests can use a fake, no secrets in fixtures, shadow/advisory by default for a new decision engine, flag off = old behaviour so arm A stays runnable.

## 4. Tests

Run the whole relevant suite (unit, contract, integration such as `claude plugin test`). Minimum for a Jev/Laya integration: valid answer, borderline threshold, malformed answer, timeout / provider down, each mode, fallback, no unintended writes, redaction. Write `unit-tests.json` from the real output: skipped ≠ pass, not run = `notRun`. No measurement with failing tests.

## 5. Independent agent review

Spawn a separate reviewer (Agent tool, fresh context, read-only) with the brief, design, diff and test output. Checklist: matches the approved scope; edge cases, timeouts, fallback; hidden coupling to Jev/Laya; secrets, unsafe writes; weak or in-sample tests; whether the measurement is really sourced. Save `agent-review.json` (`Critical | Major | Minor | Suggestion`). Open Critical/Major block step 6 unless the user accepts them; a resolution starting with `fixed` or `accepted` closes a finding.

## 6. Measure A vs B — real tokens per case

Write one `results.json` per arm and run: `{ experimentId, arm, runId, startedAt, finishedAt, cases: [...] }`, one case per case id (`schemas/case-result.schema.json`): `status` pass/fail/blocked/skipped/error, `observedOutcome` (one line, shown under the case name), `usage`, `evidenceRefs`. Blocked never counts as pass or fail, and only cases that are pass/fail in both arms are compared (better/worse and token totals); the rest are listed as "not compared". Missing number = `null`, never an estimate shown as real.

Where the tokens come from — pick the one that matches the tool:

- **Agent run** (the tool changes how Claude works through a task: skills, routers, gates): run each case as its own Claude Code session per arm, then sum the real API usage of that window into `case.usage` (subagent transcripts under `<session>/subagents/` are included; `--no-subagents` to skip):
  ```bash
  node .claude/skills/build-skill-tool-workflow/scripts/transcript_usage.mjs "<session.jsonl>" --from <ISO> --to <ISO>
  ```
  Also write `run-notes.json` and build the execution log for the run:
  ```bash
  node .claude/skills/web-test/scripts/build_execution_log.mjs "<runDir>" --transcript "<session.jsonl>"
  ```
- **Content run** (the tool changes what Claude reads: trimming, context shaping, summaries): save what Claude would read per case and arm under `evidence/texts/<case>.<A|B>.txt` and count it for real (each file is one `claude -p` call, a few cents):
  ```bash
  node .claude/skills/build-skill-tool-workflow/scripts/count_tokens.mjs evidence/texts/*.txt
  ```
  A failed call gives `null` and exit 1, never a guess. Put the count in `usage.inputTokens`; identical text reuses A's count (the count varies by ±5 between calls). Keep the import script (`import_*.ts|mjs`) in the experiment folder so the numbers can be rebuilt.

Record Jev/Laya calls per case in `usage.providerCalls`, `fallbackCount` and `providerLatencyMs`.

## 7. Per-tool report

Set `recommendation` (`ADOPT | PILOT | REWORK | DROP | INSUFFICIENT_EVIDENCE`), `confidence` (LOW/MEDIUM/HIGH), a plain one-to-two-sentence `headline` (tokens A → B, whether any case got worse, what blocks adoption) and `evaluation.deviations` (caveats in plain words) in `manifest.json`, then:

```bash
node .claude/skills/build-skill-tool-workflow/scripts/build_tool_report.mjs "reports/skill-tool-lifecycle/<tool>/<experiment-id>"
```

`report.html` reads top-down: verdict + headline → 4 cards (tokens A → B, cases passed, engine calls/latency, tests · review) → case-by-case table (pass/fail each arm, tokens each arm, change, bar, links to what Claude read) → caveats → collapsed review, tests, all numbers, raw data. A case that passes in A and fails in B is highlighted as **worse** and must be in the headline.

## 8. Main report

```bash
node .claude/skills/build-skill-tool-workflow/scripts/build_main_report.mjs
```

One row per experiment from its `summary.json`: verdict, tokens A → B, cases passed A → B, engine calls, headline, linking to the per-tool `report.html` (a reference, not a copy), plus "Waiting on you". Check every link opens and no secret or PII is in `evidence/`.

## 9. Gate B — final user review

Send `index.html` and the experiment's `report.html` (SendUserFile, `display: "render"`). In chat: what was built (branch/commit), tests and review, tokens A → B and any worse case, recommendation, and the one decision needed. Record it in `manifest.approvals.finalDecision` + `final-decision.md`, rebuild both reports. Until then the tool stays behind its flag.

## Self-test

```bash
node --test .claude/skills/build-skill-tool-workflow/tests/reports.test.mjs
```
