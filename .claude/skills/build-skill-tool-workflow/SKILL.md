---
name: build-skill-tool-workflow
description: Lifecycle for building and measuring a coding-agent tool (Claude Code skill, hook, plugin, MCP server, helper script) that uses TypeSafe Jev / Laya or rules, against plain Claude. Opus plans and reviews; Haiku builds, tests, measures and fixes; the user locks the idea and makes the final decision. Each phase runs in its own fresh session fed by a small capsule file, so no session carries the whole history. Two tracks: a new idea, or an existing tool. Use on "/build-skill-tool-workflow <idea|tool|experiment dir>", or when the user asks to brainstorm, build, measure or report a skill/hook/plugin/tool against plain Claude.
argument-hint: "[idea, tool name, or experiment dir]"
---

# Build Skill / Tool Workflow (v2)

Every experiment measures **what Jev / Laya (or the tool's rules) adds on top of plain Claude**: plain Claude (arm A) vs Claude + the tool (arm B) on the same cases, with real token counts, and a report the user reads in a minute. The user owns **Gate A** (idea lock, before any code) and **Gate B** (final decision). Never implement before Gate A; never merge, publish, enable a hook globally or call a tool adopted before Gate B.

## Flow, models and sessions

| Phase | Who / model | Session | In → out | Detail |
|---|---|---|---|---|
| **Control** | this session, thin | the one talking to the user | gates, accepting findings, starting phases | below |
| **P1 Plan** | a `haiku-case` agent gathers context, then **Opus** (one call, closed pack) writes brief + design | fresh | idea → `idea-brief.md`, `design.md` → **Gate A** | `phases/phase-1-plan.md` |
| **P2 Build** | **Haiku 5.5 xhigh** main model | fresh, `capsule-P2.md` | approved design → branch, diff, `unit-tests.json` | `phases/phase-2-build.md` |
| **P3 Measure** | **Haiku 5.5 xhigh** main model + `haiku-case` case agents | fresh, `capsule-P3.md` | commit → `runs/`, `evidence/`, `summary.json` | `phases/phase-3-measure.md` |
| **P4 Review + fix + report** | **Opus** review (one subagent call, closed pack) → user accepts findings → **Haiku** fixes → reports | fresh, `capsule-P4.md` | results → `agent-review.json`, fixes, `report.html`, `index.html` → **Gate B** | `phases/phase-4-review-fix-report.md` |

- **Track N (new idea):** P1 → Gate A → P2 → P3 → P4 → Gate B.
- **Track E (tool exists):** P1 is `N/A (existing tool)`; write a short `idea-brief.md` naming the question this run answers and the baseline experiment, then P2 (only the approved changes, or none) → P3 → P4 → Gate B. An approved improvement from Gate B starts a new experiment id in Track E.
- Track the phase in `manifest.json` `status` (`schemas/experiment-manifest.schema.json`); a skipped phase is `N/A` with the reason, never silently dropped. Every round's own cost is measured from `manifest.phases[]` with `scripts/phase_usage.mjs` (step 4c):
  - **Control row**, written by the control session when the round starts (at Gate A; for Track E when P2/P3 starts): `{ "phase": "Control", "cwd": "<its working directory>", "pick": "busiest", "from": "<ISO now>", "model": "<its model>" }`. P4 sets `"to"` when it builds the reports.
  - **Phase rows**, written by each phase session as its first step: `{ "phase": "P2", "cwd": "<its working directory>", "from": "<ISO now>", "model": "...", "smartTrimMode": "..." }`. No session id or transcript path needed: `phase_usage` finds the transcripts from `cwd` (all of them for a phase worktree, including headless `claude -p` runs; the busiest one inside [from, to] for the control row).

## Starting a phase (capsule handoff)

1. Control writes the capsule: `node .claude/skills/build-skill-tool-workflow/scripts/make_capsule.mjs <expDir> --phase P2|P3|P4` → `<expDir>/capsule-<phase>.md` (goal, approved decisions, branch/commit, files, test command, artifact paths, done-when, model; capped at ~3k tokens, no chat history).
2. Control starts a **fresh** session (context `fresh`, model Haiku for P2-P4) whose whole prompt is: "Read `<expDir>/capsule-<phase>.md` and follow `.claude/skills/build-skill-tool-workflow/phases/<file>`."
3. The phase session first adds its row to `manifest.phases[]` (see above), then writes its artifacts, commits on the experiment branch and ends with a hand-back of **5 lines or fewer** (what is done, where, what is blocked). It never asks the user for a gate decision: it stops and reports.
4. Control reads the hand-back and at most a few fields of `summary.json` / `agent-review.json` (one-line `node -e`), then asks the user at the gate.

**Starting rules:** a phase session can be started only on the user's own words in the control session; on a turn that another session or an automated event started, propose it as a card for the user to click. **Gate decisions** (Gate A, accepting findings, any change to frozen criteria) are written by the control session into the experiment files and committed (`resolution`, `design.md`, `manifest.json`); never relay them to a phase session by cross-session message: it cannot verify them and rightly refuses.

**Control-session rules:** never read a log, report, transcript or diff longer than ~50 lines; never run measurement or builds itself; talk to the user only at the gates and when a phase is blocked. When the control session's context grows past ~150k, suggest `/fast-compact` to the user at a phase boundary.

## Token budget

- **Opus: at most 2 calls per round**: P1 planning (Track N only) and the P4 review. Each gets a **closed input pack** pasted into its prompt (no file reading, no repo exploration), answers in under ~800 words. No other Opus calls; Opus is never the main model of a phase session.
- **Haiku everywhere else**: `subagent_type: "haiku-case"` (`.claude/agents/haiku-case.md`: Haiku 5.5, `autoCompactWindow: 98000`, tools limited to Read, Grep, Glob, Bash, Write, Edit, Skill) with `model: "haiku"`, `effort: "xhigh"`. Every Haiku agent stays **under 100k context** (the user's cost rule). The tool whitelist keeps its starting context at ~17k; with all tools it started at ~55k, and compaction (which fires near ~73k under a 100k window) thrashed and killed the agent. Never use `general-purpose` Haiku as a workaround: it has no compaction window and ran to 143k. Without `haiku-case` a Haiku 5.5 subagent compacts only near ~967k tokens.
- **Case agents**: at most 4 in flight per session, at most 2 measuring sessions on the machine at once; 4 cases × 2 repetitions unless the brief says otherwise.
- **Cheap checks before agent spend**: an offline gate (recall on gold tasks, replay of recorded transcripts, a content run with `count_tokens.mjs`) runs first, written into `design.md` before it runs; the agent run starts only if it passes.
- **Skipping a model step** (no review, no Opus call) to save quota needs the user's OK; record it as `N/A (quota, user OK <date>)` in `manifest.json` and in `deviations`.
- **smart-context-trimming** (cannot be loaded into a Claude Desktop app session; there it is off and recorded in `deviations`): `enforce` in P2 and in the fix part of P4 (test/build output, re-runs); **off** (`SMART_TRIM_MODE=observe`) in P3, because subagents share the session's hooks and arm A must stay plain. Record the mode per phase in `manifest.phases[]`.
- **Big files**: never Read a file over ~100 KB whole (e.g. a generated `.d.ts`): Grep it with `-n` and Read at most ~60 lines around a match; give agents the same rule in their prompt, naming the big files when known.
- **Few wake-ups**: launch a batch of agents, then end the turn; never poll, sleep or check status in a loop; collect a whole batch in one turn.

## Quiet commands (all phases)

Every script prints **one summary line** and writes details to a file. Git: `-q`, and `-c core.safecrlf=false` on **`git add` as well as commit** (the CRLF warnings come from `add`), long output through `| tail -n 5`. **Stage explicit paths only** (the experiment folder, `index.html`, `index.json`), never a whole `reports/` folder: untracked folders of other sessions get swept into the commit. Never paste `git diff`, logs, transcripts or JSON dumps into chat; point to the file. Combine steps into one script or one batched tool message: every model turn re-reads the whole context, so turns cost as much as length.

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
    capsule-P2.md  capsule-P3.md  capsule-P4.md   # phase handoffs (make_capsule.mjs)
    improvements.md                      # P4, when the result is bad
```

## Self-test

```bash
node --test ".claude/skills/build-skill-tool-workflow/tests/*.test.mjs"
```
