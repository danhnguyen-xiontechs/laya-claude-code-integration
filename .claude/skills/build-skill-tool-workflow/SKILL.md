---
name: build-skill-tool-workflow
description: Lifecycle for building and measuring a coding-agent tool (Claude Code skill, hook, plugin, MCP server, helper script) that uses TypeSafe Jev / Laya or rules, against plain Claude. Opus plans and reviews; Haiku builds, tests, measures and fixes; the user locks the idea and makes the final decision. Each phase runs in its own fresh session fed by a small capsule file, so no session carries the whole history. Two tracks: a new idea, or an existing tool. Use on "/build-skill-tool-workflow <idea|tool|experiment dir>", or when the user asks to brainstorm, build, measure or report a skill/hook/plugin/tool against plain Claude.
argument-hint: "[idea, tool name, or experiment dir]"
---

# Build Skill / Tool Workflow (v3)

Every experiment measures **what Jev / Laya (or the tool's rules) adds on top of plain Claude**: plain Claude (arm A) vs Claude + the tool (arm B) on the same cases, with real token counts, and a report the user reads in a minute. The user owns **Gate A** (idea lock, before any code) and **Gate B** (final decision). Never implement before Gate A; never merge, publish, enable a hook globally or call a tool adopted before Gate B.

**v3 keeps v2's phase capsules, manifest and artifact handoff.** It adds: one numbering (P1–P4, with 4a/4b/4c as sub-steps), an explicit v2 mapping, the Opus cap, Track N/E rules, the Mods vs smart-context-trimming split, the answer-key and arm-fairness rules, and the Jev PILOT scope. A single-session variant is **not** the default: it is only tested as a controlled arm, and adopted only if its numbers beat fresh sessions + capsules.

| v3 step | v2 file |
|---|---|
| P1 Plan (intake, context pack, idea brief, design, Gate A) | `phases/phase-1-plan.md` |
| P2 Build | `phases/phase-2-build.md` |
| P3 Measure | `phases/phase-3-measure.md` |
| P4a Opus review, P4b fix, P4c report, Gate B | `phases/phase-4-review-fix-report.md` |

## Flow, models and sessions

| Phase | Who / model | Session | In → out | Detail |
|---|---|---|---|---|
| **Control** | this session, thin | the one talking to the user | gates, accepting findings, starting phases | below |
| **P1 Plan** | a `haiku-100k:haiku-case` agent gathers context, then **Opus** (one call, closed pack) writes brief + design | fresh | idea → `idea-brief.md`, `design.md` → **Gate A** | `phases/phase-1-plan.md` |
| **P2 Build** | **Haiku 5.5 xhigh** main model | fresh, `capsule-P2.md` | approved design → branch, diff, `unit-tests.json` | `phases/phase-2-build.md` |
| **P3 Measure** | **Haiku 5.5 xhigh** main model + `haiku-100k:haiku-case` case agents | fresh, `capsule-P3.md` | commit → `runs/`, `evidence/`, `summary.json` | `phases/phase-3-measure.md` |
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

Each rule below, and how it is carried (skill rule, script, subagent definition, mod hook or settings) with its measured effect: `IMPROVEMENTS.md`.

- **Opus: at most 2 calls per round**: P1 planning (Track N only) and the P4a review. Each gets a **closed input pack** pasted into its prompt (no file reading, no repo exploration), answers in under ~800 words. No other Opus calls; Opus is never the main model of a phase session. A third call needs the quota figure and the user's OK, recorded as `N/A (quota, user OK <date>)`. Opus never sees gold labels or the answer key: the closed pack leaves them out.
- **Haiku everywhere else**: `subagent_type: "haiku-100k:haiku-case"` (`haiku-100k/agents/haiku-case.md`: Haiku 5.5, `autoCompactWindow: 100000`, tools limited to Read, Grep, Glob, Bash, Write, Edit, Skill) with `model: "haiku"`, `effort: "xhigh"`. **Every Haiku request stays under 100k input tokens** (the user's cost rule: a request over 100k is billed at the higher rate, and each request carries the whole context). All three layers come from the `haiku-100k` plugin (repo folder `haiku-100k/`, install: `claude plugin marketplace add <repo>/haiku-100k`, `claude plugin install haiku-100k@haiku-100k`): (1) its `haiku-case` agent with `autoCompactWindow: 100000`, the minimum Claude Code accepts (98000 was silently ignored, falling back to the ~967k default); (2) `/haiku-100k:setup`, run once per machine, writes `modelSettings` for Haiku (`autoCompactWindow: 125000`, compaction near 95k; 100000 made app sessions, which start at ~73k, compact on every request) for main Haiku sessions such as P2-P4; (3) its hooks: in a Haiku session they defer rarely used tools behind ToolSearch at session start (first request 42.5k -> 22.1k headless; `HAIKU_100K_SLIM=0` turns it off), and cut a tool result that would push the next Haiku request past 92k and toasts every Haiku request over 100k. Tested 2026-10-19: 20 chunks, about 240k tokens read, max request 64k, 4 compactions, 0 requests over 100k. The tool whitelist keeps the starting context at ~17k; with all tools it started at ~55k, and compaction (which fires near ~73k under a 100k window) thrashed. Never use `general-purpose` Haiku as a workaround.
- **Case agents**: at most 4 in flight per session, at most 2 measuring sessions on the machine at once; 4 cases × 2 repetitions unless the brief says otherwise. **Flat only**: a case agent never spawns agents, and the only subagent type used is `haiku-100k:haiku-case`, so every request stays under 100k.
- **Cheap checks before agent spend**: an offline gate (recall on gold tasks, replay of recorded transcripts, a content run with `count_tokens.mjs`) runs first, written into `design.md` before it runs; the agent run starts only if it passes.
- **Skipping a model step** (no review, no Opus call) to save quota needs the user's OK; record it as `N/A (quota, user OK <date>)` in `manifest.json` and in `deviations`.
- **Mods auto-compact and smart-context-trimming (SCT) are different mechanisms.** Auto-compact is the Haiku window setting above (`autoCompactWindow`). SCT trims tool output through hooks. Record each one separately in `manifest.phases[]` and in `deviations`, and never count one as the other in a metric.
- **smart-context-trimming** (cannot be loaded into a Claude Desktop app session; there it is off and recorded in `deviations`): `enforce` in P2 and in the fix part of P4b (test/build output, re-runs); **off** (`SMART_TRIM_MODE=observe`) in P3, because subagents share the session's hooks and arm A must stay plain. Record the mode per phase in `manifest.phases[]`. Before a result claims an SCT effect, check the mode in the transcript or the phase row.
- **Jev in the workflow itself**: only as the P3 shadow grader for free-text answers that have no grading script (`scripts/grade_with_engine.mjs --provider jev`, PILOT for one round, see `phases/phase-3-measure.md`). Its grade never replaces the case status, and a Jev `fail` gets a human look. Laya was rejected for this (58.8% agreement). Neither engine routes models, steers agents or decides gates; earlier rounds showed rules do that better. Scope and status come from `final-decision.md` (2026-10-18); after the pilot round, ADOPT or REJECT goes in a new experiment id.
- **Answer key and arms**: the gold key and grading script never go into an agent's prompt, capsule or closed pack. Arms are fair: the same cases, model, effort and repetitions for A and B (and C, if a single-session arm is tested). Arm A has the tool unloaded and Jev/Laya off. `subagent_usage.mjs --forbid` checks that arm A never called the tool.
- **Metrics**: from scripts only (`phase_usage.mjs`, `transcript_usage.mjs`, `count_tokens.mjs`, `build_tool_report.mjs`, `build_main_report.mjs`). A missing number is `null` in the JSON and "not measured" in the report, never an estimate.
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
