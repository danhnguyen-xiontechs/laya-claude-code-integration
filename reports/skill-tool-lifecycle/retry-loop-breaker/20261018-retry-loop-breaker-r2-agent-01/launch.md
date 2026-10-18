# Launch order: retry-loop-breaker round 2

`<S>` = the orchestrator's scratchpad (never inside the repo). `<E>` = this folder. `<subagentsDir>` = `~/.claude/projects/<project>/<session>/subagents` of the session that launches the agents.
Every case agent: Agent tool, `model: "haiku"`, `effort: "xhigh"`, prompt = the text of the filled prompt file, verbatim (nothing added: no control path, no answer key). At most 6 case agents in flight. `OPENROUTER_API_KEY` must be in the environment the agents' Bash inherits (else B logs `jev error:no_key` and allows).

## 1. Pilot (arm A only, not counted)
```bash
node <E>/make_tasks.mjs <S>/rlb2-pilot/work --pilot
```
Launch 3 agents in one message, prompts from `<S>/rlb2-pilot/ctl/prompts/`:
`index-warmup.A.p1.txt`, `devserver-ready.A.p1.txt`, `codegen-wait.A.p1.txt`.

When all 3 have handed back:
```bash
node <E>/collect_and_grade.mjs <S>/rlb2-pilot/ctl <subagentsDir> --out <E>/evidence/pilot
```
Read `<E>/evidence/pilot/grades.json`:
- `summary.loopBar.met` must be `true` (>= 4 identical failing runs of one command on at least 2 of the 3 cases; `perCase` gives the counts);
- `metrics.transientFailedRuns` must be 0 and `summary.contaminated` empty;
- skim `<E>/evidence/pilot/evidence/_logs/*.jsonl`: is the repeated command `npm test` through the wrapper, and is the folder unchanged between the repeats (`treeChanged: false`)?

If the bar is not met, stop: do not tune the cases silently. Report per case the max identical failing runs and what the agent did instead (read the log, edited files, varied the command). Any case change is an amendment to `design.md` and needs a new pilot in a new work root.

**Pilot 2 (after Amendment 1 in `design.md`):** the same steps with `<S>/rlb2-pilot2/work` (prompts in `<S>/rlb2-pilot2/ctl/prompts/`) and `--out <E>/evidence/pilot2`.

## 2. Full run (24 agents)
```bash
node <E>/make_tasks.mjs <S>/rlb2/work
```
Filled prompts: `<S>/rlb2/ctl/prompts/<case>.<A|B>.<r1|r2>.txt`. A and B of a case go in the same message; rep 2 launches B first. Four waves of 6 (start the next wave when the previous one has handed back, or keep a rolling queue of at most 6):

| Wave | Rep | Launch order in the message |
|---|---|---|
| 1 | r1 | index-warmup A, index-warmup B, devserver-ready A, devserver-ready B, codegen-wait A, codegen-wait B |
| 2 | r1 | flaky-once A, flaky-once B, flaky-twice A, flaky-twice B, build-flag A, build-flag B |
| 3 | r2 | index-warmup B, index-warmup A, devserver-ready B, devserver-ready A, codegen-wait B, codegen-wait A |
| 4 | r2 | flaky-once B, flaky-once A, flaky-twice B, flaky-twice A, build-flag B, build-flag A |

Optional check after waves 1-2: `node <E>/collect_and_grade.mjs <S>/rlb2/ctl <subagentsDir> --rep r1`.

## 3. Grade, contamination, re-runs
```bash
node <E>/collect_and_grade.mjs <S>/rlb2/ctl <subagentsDir>
```
This runs `subagent_usage.mjs` twice: `--forbid` with the tool pattern (`retry-loop-breaker|retry-guard|hooks/core|core.ts|_lib|/jobs/`, checked for arm A) and with the answer-key pattern (`tasks.json|/prompts/|_logs|_state|/ctl` plus this experiment folder and its scripts under `reports/skill-tool-lifecycle`, checked for both arms). For each run listed in `summary.contaminated`:
```bash
node <E>/make_tasks.mjs <S>/rlb2/work --rerun <case>.<arm>.<rep>
```
Launch the new prompt (`<S>/rlb2/ctl/prompts/<case>.<arm>2.<rep>.txt`), then grade again. The discarded run's evidence goes to `<E>/evidence/contaminated-run1/`; say so in `deviations`.

Outputs in `<E>`: `grades.json` (per-run grades, loop metrics, `summary`), `runs/A-claude/r1,r2` and `runs/B-claude-jev/r1,r2` (`results.json`, case-result schema), `evidence/answers`, `evidence/_logs`, `evidence/texts` (`<case>.<A|B>.txt` and `<case>.B.first-intervention.txt`), `evidence/usage.json`. Home folder and user name are replaced in everything written.
