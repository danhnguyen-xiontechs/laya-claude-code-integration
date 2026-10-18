# Phase 3: Measure A vs B (Haiku 5.5 xhigh + haiku-100k:haiku-case case agents)

Input: `capsule-P3.md` (commit to measure, cases, frozen design). Output: `runs/`, `evidence/`, `summary.json` (built by `build_tool_report.mjs`). **smart-context-trimming off** (`SMART_TRIM_MODE=observe`) for the whole phase. Case agents: `subagent_type: "haiku-100k:haiku-case"`, at most 4 in flight.

## The comparison: two arms only

| Arm | Folder | What runs |
|---|---|---|
| **A** | `runs/A-claude/<runId>/` | plain Claude Code, tool off |
| **B** | `runs/B-claude-<engine>/<runId>/` | Claude + the tool, with Jev / Laya live (or its rules when it has no engine; falls back to rules when the engine fails) |

Same case ids, prompt, fixtures, model and effort in both arms; each arm in its own session so it cannot see the other's edits; A must not load the tool. Rotate the order; repeat nondeterministic cases 2–3 times; with few cases call the result directional. `manifest.tool.provider` (`JEV`, `Laya`, `none` = rules) names the engine in the report.

## 6. Measure A vs B — real tokens per case

Write one `results.json` per arm and run: `{ experimentId, arm, runId, startedAt, finishedAt, cases: [...] }`, one case per case id (`schemas/case-result.schema.json`): `status` pass/fail/blocked/skipped/error, `observedOutcome` (one line, shown under the case name), `usage`, `evidenceRefs`. Blocked never counts as pass or fail, and only cases that are pass/fail in both arms are compared (better/worse and token totals); the rest are listed as "not compared". Missing number = `null`, never an estimate shown as real.

Where the tokens come from — pick the one that matches the tool:

- **Agent run** (the tool changes how Claude works through a task: skills, routers, gates, or what it reads across a whole task): real prompts, one fresh session per case, arm and repetition. Two ways to run it:
  - **Subagents (cheapest, default)**: spawn the cases with the Agent tool using the haiku-subagent settings (`model: "haiku"`, `effort: "xhigh"`, at most 4 in flight, A and B in the same batch, rep 2 launched B first). Subagents share this session's hooks and plugins, so a hook cannot be on for B only: give both arms the **same command** through a neutral wrapper (e.g. `node run.mjs test`) that returns raw output in A and runs the tool's own core function in B, logging each engine decision to `_logs/<case>.<arm>.r<n>.jsonl`. Same prompt text in both arms except the folder (and one sentence about the tool, below); one fresh folder per case (`make_tasks.mjs`). Grade afterwards yourself: re-run the raw command (not the wrapper) and check protected files (tests) by hash; the subagent's own "it passes" is not evidence.
    **Keep the answer key away from both arms.** A case fixture handed to the agents has no `expected`/gold block (strip it from the copy). Gold lists that live in the repo (eval `tasks.json`, old results, reports, saved reviews) are removed from the repo copy the agents work on (`git archive HEAD`, then delete them); gold names that remain in ordinary code are fine, say so in `deviations`.
    **Arm A cannot hide the tool.** Subagents see this session's skill list and the repo, so a tool that is a skill or sits in the repo is reachable from A (seen: 3 of 4 arm-A agents called the planner skill on their own). A's prompt says "No <tool> is available in this task: decide yourself; do not look for or use any skill or script", B's prompt says it is available. Then check mechanically that A did not use it, and discard and re-run (in a new work folder name, e.g. `<case>.A2`, so transcripts cannot be mixed up) any A case that did; keep the discarded run in `evidence/contaminated-run<n>/`, outside `runs/`, and say so in `deviations`:
    ```bash
    node .claude/skills/build-skill-tool-workflow/scripts/subagent_usage.mjs <subagentsDir> --forbid "<tool-slug>|<tool-script>" <workDir...>
    ```
    `<subagentsDir>` is `~/.claude/projects/<project>/<session>/subagents`: one flat folder of `agent-<id>.jsonl` files (no sub-folders per run; agents spawned by a subagent are in the same folder), where `<project>` is the session's starting working directory with `:` `\` `/` replaced by `-`. The script finds each case's transcript by the work dir in its prompt (no match or two matches = `null`) and, with `--forbid`, counts the agent's tool calls (Skill calls included) that mention the pattern as `forbiddenCalls`; the report builder does not read it, so look at it before grading.
    The agent's answer comes back through its hand-back message, not a final assistant text: read it from the transcript's `SubagentHandback` tool call, save it verbatim to `evidence/answers/<case>.<A|B>.txt` and score it with a script (see `collect.mjs` in `reports/skill-tool-lifecycle/codebase-task-explorer/20261017-cte-agent-01/`).
    **Jev shadow grader (PILOT, one round from 2026-10-18).** Use it when a case's answer is free text graded against a key (a verdict, a pick, a list of statuses) and no grading script exists. Write `evidence/grade-rows.json`: `{ rows: [{ id, rule, gold, answer, label? }] }` (rule = the frozen pass rule from `design.md`, label = the grade you or the script gave). Then run:
    ```bash
    node .claude/skills/build-skill-tool-workflow/scripts/grade_with_engine.mjs evidence/grade-rows.json --provider jev
    ```
    It writes `evidence/engine-grades.jev.json`.
    - The case status always stays your own or the script's grade.
    - Any row Jev grades `fail` while you graded `pass` gets a human look. List it in `deviations`.
    - Never use it for order, constraint or numeric checks: write a script for those.
    - Record agreement and disagreements in `summary.json` `notes`. Offline evidence: `reports/skill-tool-lifecycle/build-skill-tool-workflow/20261018-bstw-engine-grader-01/result.md`.
  - **Separate sessions** (`claude -p --plugin-dir …`) when the real hook must run: run each case as its own Claude Code session per arm, then sum the real API usage of that window into `case.usage` (subagent transcripts under `<session>/subagents/` are included; `--no-subagents` to skip):
  ```bash
  node .claude/skills/build-skill-tool-workflow/scripts/transcript_usage.mjs "<session.jsonl>" --from <ISO> --to <ISO>
  ```
  For separate sessions also write `run-notes.json` and build the execution log for the run:
  ```bash
  node .claude/skills/web-test/scripts/build_execution_log.mjs "<runDir>" --transcript "<session.jsonl>"
  ```
- **Content run** (the tool changes what Claude reads: trimming, context shaping, summaries): save what Claude would read per case and arm under `evidence/texts/<case>.<A|B>.txt` and count it for real (each file is one `claude -p` call, a few cents):
  ```bash
  node .claude/skills/build-skill-tool-workflow/scripts/count_tokens.mjs evidence/texts/*.txt
  ```
  A failed call gives `null` and exit 1, never a guess. Put the count in `usage.inputTokens`; identical text reuses A's count (the count varies by ±5 between calls). Keep the import script (`import_*.ts|mjs`) in the experiment folder so the numbers can be rebuilt.

Record Jev/Laya calls per case in `usage.providerCalls`, `fallbackCount` and `providerLatencyMs`.

**Save what Claude read, for both arms, every time** (content and agent runs alike): `evidence/texts/<case>.A.txt` and `<case>.B.txt`. For an agent run that is the output of the case's first test/build run in each arm, with machine-specific paths shortened (rebuild the task fresh and run the wrapper once per arm, see `make_evidence.mjs` in `smart-context-trimming/20261017-sct-agent-02`). Engine logs (`evidence/filter-logs/…jsonl`) are extra, never a substitute for A's text. The report links `evidence/texts/<case>.<A|B>.txt` on its own and lists any case with one arm missing as a caveat. Keep `make_tasks`, the import and the evidence scripts in the experiment folder so everything can be rebuilt.

Before the report: `unit-tests.json` from the real test output of the commit that was measured, Then run `build_tool_report.mjs` once to produce `summary.json` for the P4 review (the review card says "no agent review" until P4).

End with a hand-back of 5 lines or fewer: cases passed A → B, tokens A → B, any worse case, anything blocked.
