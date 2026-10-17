# Experiment Plan — codebase-task-explorer (retro, agent run)

- **Experiment ID:** `20261017-cte-agent-01`
- **Idea approval reference:** none (retro of a built tool; see `idea-brief.md`)
- **Plan version:** `agent-retro-v1` (v1.2: codemap premise corrected, arm A now uses the same codemap pool, see deviations)
- **Status:** READY (frozen before step 6, see `criteriaFrozenAt` in `manifest.json`)
- **Commit/branch measured:** `7849acd` on `main`

## Design summary

The tool (`.claude/skills/codebase-task-explorer/`) builds a candidate pool for a task, ranks it with deterministic rules and, optionally, Jev batches, and hands a ranked list to Claude. This retro asks whether the ranked list gets a Claude subagent to the right first five files more often than the same candidate pool in the search engine's own order (no ranking) for the same queries, and what the run costs in tokens.

## Contracts (as built, unchanged)

- CLI: `node .claude/skills/codebase-task-explorer/scripts/explore.mjs --task T --mode bug|feature|refactor|new-feature --queries "q1|q2|…" --root R --provider jev [--json]`.
- Output: a markdown table (default), or JSON with `top[]`, `rulesTop[]`, `codemapOnlyTop[]`, `poolSize` and a `jev` block (`called`, `calls`, `batches`, `survivors`, `global`, `fallback`, `reason`, `latencyMs`, `cost`).
- Retrieval: `codemap find -json` per query (codemap 4.6.0 found at `~/tools/codemap/codemap.exe`, which the tool's own search checks; it is not on PATH), or the labelled fallback when codemap is missing.
- Jev request: `POST https://openrouter.ai/api/alpha/decisions` with `{model, state, questions}`; the answer is read from `answers.best.probabilities`.
- Off switches: `--provider none` or `CODEBASE_EXPLORER_JEV=off`.

## What Claude decides vs what the tool decides

| Step | Decides |
|---|---|
| Retrieval, cleanup, rules score (arm B) | tool (codemap engine) |
| Jev batch ranking (arm B only) | tool, advisory: orders the pool, cannot add files |
| Final five paths and reasoning | Claude subagent (both arms) |
| Verification by reading source | Claude; not scored by this run |

## Arms (same case, same prompt, same model, same effort)

| Arm | Helper output the agent sees first | Retrieval | Ranking | Tool loaded | Jev |
|---|---|---|---|---|---|
| A (`A-claude`) | the tool's own pool in codemap's raw order (`codemapOnlyTop`, top 10), paths only | codemap 4.6.0 (same as B) | none | no | no |
| B (`B-claude-jev`) | `explore.mjs --provider jev --json` rendered with the tool's own `toMarkdown` (top 10) | codemap 4.6.0 | rules, then Jev batches | yes | yes (`OPENROUTER_API_KEY` is set) |

Both arms use the same retrieval (codemap 4.6.0, same cleanup, same pool) and show the same number of rows (10); they differ only in ranking (B: rules, then Jev batches) and in the extra columns B prints (why matched, importers). `pool_check.mjs` still reports whether a gold group is in the pool, so a miss can be put down to retrieval or to ranking.

Both arms: a fresh subagent per case, a separate work folder with its own copy of the scrubbed repo, the same prompt text except the work folder path, the same `find.mjs` text except the library it loads (`lib/f1.mjs` for A, `lib/f2.mjs` for B), `effort: "xhigh"`, and a model chosen by `route.mjs --mode apply --provider none --type general-purpose` for each subagent (nothing printed = haiku).

Prompt (per case; the paths and the task differ by case, the rest is identical):

```
Work folder: <work>
Read-only task in the repo at <work>/repo. <task text>. Find where to start: answer with the 5 most relevant file paths, most relevant first, one line of reasoning each. You may search and read files; do not modify anything. A helper exists: run `node "<work>/find.mjs" "<task>" "<q1|q2|…>"` and use its output as a starting point.
```

The `Work folder:` line is the one place the work folder is named as a line of its own; `subagent_usage.mjs` finds each transcript by that line. Work folder names carry a random hex id, not the arm.

## Cases (first four of `eval/tasks.json`, one repetition)

| Case | Mode | Relevant groups (any path in a group hits it) |
|---|---|---|
| `t1-bug-merge-verdict` | bug | assess.mjs (jev or laya copy); laya-severity.mjs (jev or laya copy) |
| `t2-feature-model-hook` | feature | subagent-model-router `hook-pretooluse.mjs`; subagent-model-router `router.mjs` |
| `t3-refactor-decide` | refactor | skills-router `decision-provider.mjs`; skills-router `route.mjs`; skills-router `eval.mjs` or `shadow-hook.mjs` or `shadow-replay.mjs` |
| `t4-newfeature-gate` | new-feature | web-test-jev-gate or web-test-laya-gate `gate.mjs`; web-test-jev-gate `jev-lib.mjs` or web-test-laya-gate `laya-lib.mjs` |

The task text and queries come from `eval/tasks.json` unchanged. The first query is the task text itself, as the tool does; both helpers use the same list.

## What "pass" means

Per case and arm: **pass** iff Recall@5 = 1.0, i.e. every relevant group is hit by one of the agent's first five distinct paths. Fractional recall (groups hit / groups) is also kept. Scoring is done by `score.mjs`, not by the agent's claim. A path matches a group path when it equals it or ends with `/` + it, case-insensitively. An answer with fewer than five paths is unusable and is retried once with `route.mjs --escalate-from <model>`.

Success for this retro (fixed before the run, one threshold): B passes strictly more cases than A, or the same number with higher mean fractional recall, and no case that passes in A fails in B (guardrail). A tie at both arms 4/4 is reported as "no difference detectable", not as success. Any worse case is named in the headline.

## Scrubbed copy (case agents must not see the answer key)

- Source: `git archive 7849acd` of `main`, extracted to a short scratch path (Windows path length), then `git init`, `git add -A` and one snapshot commit in that copy only. 866 tracked files.
- Removed: `reports/`, `report/`, `HANDOFF-2026-10-16.md` (pilot results for this tool), `.xt-skills/` (saved PR reviews that quote the gold file names), `.claude/skills/codebase-task-explorer/eval/` (gold `tasks.json` and the old results), `.claude/skills/codebase-task-explorer/tests/`.
- Checked by grep in the copy: none of the four task texts appears verbatim, and no task id, `Recall@5` or `eval/tasks.json` reference is left.
- Not removed: gold file names occur in ordinary code and docs (for example `decision-provider.mjs` in about 20 files, `gate.mjs` in several). Removing every file that mentions a gold path would remove most of the repo, not only the answer key. The agent has to search for these names anyway. Recorded as a deviation.

## Helper and logs

- `find.mjs` in each work folder is generated from `helpers/find.mjs.tpl`. It bakes in the case id, mode, repo path and the library path, and prepends the ripgrep folder to PATH.
- Arm A (`helpers/f1.mjs`, v2): runs the same `explore.mjs` with `--provider none --json`, prints `codemapOnlyTop` (top 10, codemap's raw order) and logs to `_logs/<case>.A.jsonl`.
- Arm B (`helpers/f2.mjs`): runs the real `explore.mjs` from the copy with `--provider jev --json`, logs the JSON `jev` block, engine, coverage, pool size and top paths to `_logs/<case>.B.jsonl`, and prints `toMarkdown(result)` (the tool's own export).
- `_logs` and `first/` live in the scratch folder, outside each work folder.
- The first output of each helper call is saved (`first/<case>.<arm>.txt`), then copied to `evidence/texts/<case>.<A|B>.txt` with machine paths shortened.
- `explore.mjs` appends each run to `~/.claude/codebase-task-explorer/runs.jsonl`, the tool's own run log (no option to turn it off). These entries are not part of the experiment folder.

## Environment for the helpers

- `rg`: not on PATH here. Only the tool's fallback needs it (not used when codemap is found); both helper processes still get VS Code's bundled ripgrep prepended, same binary.
- `codemap`: found at `C:\Users\ADMIN\tools\codemap\codemap.exe` (4.6.0). The brief said it was not installed; that premise was wrong. The tool finds it through its own default path, so B runs the codemap engine, not the fallback.

## Diagnostics (no agent, no Jev unless stated)

- `pool_check.mjs`, per case: (1) B's candidate pool exactly as the tool builds it before Jev (`findCodemap`, `codemapFind`, `cleanup`, `rulesRank`, first 96), with a gold-group hit flag; (2) B's rules-only top five (baseline C in the tool's own terms, no model call); (3) A's pool (paths printed by the helper). Recorded in `evidence/pool-check.json`.
- Fallback content check: `fallbackFind` returned no content matches in the orchestrator's check; the cause (rg with no path argument and an empty stdin) is a hypothesis, the reviewer could not confirm it. Relevant only when codemap is missing; not an arm here.

## Tokens

- Agent run: `node .claude/skills/build-skill-tool-workflow/scripts/subagent_usage.mjs <subagentsDir> <workDir…>`. Per case: all tokens of that subagent's session (input, output, cache read, cache write), from its transcript. No match or two matches gives `null`, never a guess.
- Sum per arm over the four cases. Directional: one repetition, four cases.
- Jev calls per case come from the `_logs/<case>.B.jsonl` files (`providerCalls`, `fallbackCount`, `providerLatencyMs`).

## Fixed controls

- Task set: `eval/tasks.json`, first four tasks, repo = this repo at `7849acd` (scrubbed copy).
- Model: router-chosen per subagent (expected haiku), `effort: "xhigh"`. Reviewer: router-chosen (opus).
- Repetitions: 1. A and B of the same case are spawned in the same message.
- Jev: `typesafe/jev-1.13` (default), no config overrides. Codemap 4.6.0 with the tool's defaults.

## Test plan

- Unit: `node --test ".claude/skills/codebase-task-explorer/tests/*.test.mjs"` (5 tests, mocked Jev, no network).
- Not covered by the unit tests (listed as findings if the review confirms): malformed Jev answer, decide() timeout and provider-down paths, the fallback retrieval, the CLI, redaction.

## Stop conditions

- Critical or Major review finding not accepted by the user: step 6 does not start.
- A case where a helper cannot run in one arm: that case is `blocked`, not pass or fail.

## Expected artifacts

`idea-brief.md`, `design.md`, `unit-tests.json`, `agent-review.json`, `helpers/`, `make_tasks.mjs`, `score.mjs`, `pool_check.mjs`, `runs/A-claude/r1/results.json`, `runs/B-claude-jev/r1/results.json`, `evidence/texts/`, `evidence/answers/`, `evidence/logs/`, `evidence/usage.json`, `evidence/pool-check.json`, `manifest.json`, `summary.json`, `report.html`.

## Deviations log

| Date | Deviation | Reason | Impact on comparability | Follow-up |
|---|---|---|---|---|
| 2026-10-17 | The brief's premise "codemap is not installed" is wrong: codemap 4.6.0 is at `~/tools/codemap`. B runs the codemap engine, not the fallback. | the tool finds codemap through its default path; `which codemap` misses it | B is the tool in its intended configuration; retrieval differs from A (codemap vs git/rg), which `pool_check.mjs` reports | orchestrator to correct the brief |
| 2026-10-17 | `rg` is not on PATH; VS Code's bundled rg is prepended for both helpers | arm A and the tool's fallback call `rg` | same binary in both arms | none |
| 2026-10-17 | Scrub removes answer-key artifacts only (eval, tests, report, HANDOFF pilot, `.xt-skills` reviews); gold names remain in ordinary code and docs | a literal rule would remove most of the repo | an agent may find a gold file by name, as it would in a real repo | none |
| 2026-10-17 | Experiment folder written in the session worktree (`.claude/worktrees/skill-build-workflow-review-af9324/reports/…`), not in the base checkout; the empty folder in the base checkout is untouched | the session's edit guard | the orchestrator must read the folder from the worktree path | orchestrator |
| 2026-10-17 | Tool's fallback content match is dead when `rg` is on PATH (no path argument, empty stdin); not measured as an arm | found while checking the helper (see Diagnostics) | none for B (codemap); a real defect for machines without codemap | report as a finding |
| 2026-10-17 | Review left 8 Major findings open (Jev failure paths reported wrongly, dot-directories skipped by the fallback, non-deterministic fallback, JUNK filter dropping packages/ and bin/, design premise); the user accepted them for this run | user decision in chat | the run measures the tool as built; none of the fallback findings touch arm B (codemap engine); Jev failure-path findings can only show as a labelled fallback in B | fix before any adoption |
| 2026-10-17 | Arm A changed to the tool's own codemap pool in raw order (was git/rg lexical list, a confound the reviewer found) | reviewer Major finding on design | A and B now differ only in ranking | none |
| 2026-10-17 | Case agents forced to model haiku (the router would pick sonnet/opus for these prompts) | user decision in chat, cost | both arms the same model | none |
