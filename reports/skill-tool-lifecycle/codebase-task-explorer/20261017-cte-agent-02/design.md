# Experiment Plan — codebase-task-explorer re-measure after rework

- **Experiment ID:** `20261017-cte-agent-02`
- **Follows:** `20261017-cte-agent-01` (REWORK, LOW). Same arms, helpers and scorer as v1.2 of that design; only the changes below.
- **Commit measured:** `6a338b4` (tool fixes) on branch `claude/cte-rework`; repo copy = `git archive a89dc8a`, answer-key files removed as in agent-01.

## Changes from agent-01

1. **Tool rework** (commit 6a338b4): Jev failure paths (non-JSON / timeout / answer-less 200 → error; missing `answers.best` → rules order; failed global rerank → rules order; first-call guard reason shown), fallback (rg `--hidden` + explicit path, rg/git spawn and exit errors in coverage notes, path tie-break, JUNK no longer drops `packages/ bin/ out/`), numeric CLI validation. 10 new tests, 15 total.
2. **Offline score first** (`offline_score.mjs`, no agents): Recall@5 of the tool's own `rulesTop` (rules only) vs `top` (rules + Jev) vs `codemapOnlyTop` on the same pool, for `eval/tasks.json` (5 tasks) and for the new tasks.
3. **New tasks** (`tasks-new.json`, 6 cases, one per mode at least): task texts written in user words; **queries written blind** by a separate Haiku agent that saw only the task texts (no tools, no repo) — the author's queries in `eval/tasks.json` were written with the answer in mind. Gold groups set by the orchestrator from the code before any case agent ran. One gold group per case.
4. **2 repetitions**, Haiku 5.5 case agents, effort xhigh, rep 2 launched B first. Same codemap pool in both arms: A sees the pool in codemap's raw order (top 10), B the tool's rules + Jev order (top 10).
5. **Arm A contamination check**: `subagent_usage.mjs --forbid "codebase-task-explorer|explore.mjs"` on every A work dir.

## Pass rule and success threshold (unchanged)

Pass = every gold group hit by one of the first five distinct numbered paths. Success = B passes strictly more cases than A, or the same with higher mean recall, and no case worse. A tie at the ceiling is "no difference detectable".
