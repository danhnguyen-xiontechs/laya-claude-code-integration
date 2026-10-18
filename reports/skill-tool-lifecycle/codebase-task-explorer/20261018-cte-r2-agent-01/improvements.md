# codebase-task-explorer — improvements after 20261018-cte-r2-agent-01

## Diagnosis

B used +3.84M tokens (+43%). Almost all of it came from **+53 model turns** (120 -> 173). The cost per turn was the same in both arms, about 73k tokens. The extra turns did not come from extra reading:

- Non-wait tool calls were equal (A 136, B 138). B read 18% fewer tool-result bytes (515 KB vs 631 KB).
- B made +21 more helper-polling calls (61 vs 40): `sleep`, `cat`/`Read` of the task output file, Monitor, TaskStop.
- B made fewer tool calls per turn (1.23 vs 1.58).

The helper was moved to the background at the 120 s Bash timeout in all 12 r1 runs and in r2 n1-n3. On the 3 pairs where it finished in the foreground (r2 n4-n6), the gap shrinks to +23% turns (22 -> 27) and +22% tokens (1.53M -> 1.87M). That is only 3 pairs, but it means load and waiting, not output size, drove most of the +43%.

The ranking stack changed nothing that mattered:

- **n1-n4:** B's printed #1 equals codemap's raw #1 (arm A) and is the gold file.
- **n5:** the gold file is not in the pool.
- **n6:** codemap's raw top 10 has no gold. Jev had both gold files at #5/#6, but the LOW gate (p 0.24) printed only 3 rows and hid them.

Rules order is not logged in this run. The baseline offline score on the same tasks shows Jev's only correct #1 change (n3) repairs a rules error that raw codemap order never made.

What the pass rates can and cannot show:

- A's only fail (n3 r1) had the gold file at #1 of its helper list. The agent saw it and did not read it.
- 23/24 runs found gold by their own grep.
- With n=6 tasks × 2 reps on a heavily loaded machine, the pass-rate gap is noise.
- The data cannot show whether the gate saves turns: in the 3 clean pairs it did not (n5 r2: 8 vs 8 turns; n6 r2: 10 vs 7).

## Suggestions (ranked by expected effect)

### 1. Drop the engine call from the default path (codemap order + rules-free output); keep Jev behind a flag

- **change:**
  - `.claude/skills/codebase-task-explorer/scripts/explore.mjs` `run()`/CLI: make the default `--provider none`, and when no provider is set, rank by codemap's own order (`codemapOnlyTop`) instead of the rules score. The rules score is worse than raw codemap on n3: 5 web-test `build_report.mjs` copies on top.
  - `SKILL.md`: document `--provider jev` as experimental.
  - Keep the Jev path and the gate code unchanged for later runs.
- **why:**
  - Two A/B runs in a row show B pass ≥ A only by noise (12/12 vs 12/12, then 12/12 vs 11/12), with B tokens +11% and +43%.
  - In this run, B's top-1 equals plain codemap's top-1 on all 6 tasks.
  - The one place Jev's ranking had real information (n6, gold at #5/#6) was hidden by the gate.
  - 41 Jev calls bought no rank-1 change against the true comparator.
- **expected effect:** The B-specific turn and token excess goes to about 0, because the arms become the same output. You lose about 2-4 s of Jev latency and about $0.0003 per run. Pass rate is unchanged on this set.
- **how to verify:**
  - Re-run `offline_score.mjs` on `tasks-new.json` and `eval/tasks.json`: codemap-only must match or beat rules-only, and not fall below the current Jev pass on any task where gold is in the codemap top 5.
  - Then do a 2-rep agent run on suggestion 3's harder set before turning Jev back on.

### 2. Stop the helper from blocking: parallel codemap queries, and a foreground call in the harness

- **change:**
  - (a) In `explore.mjs` `codemapFind()`/`run()`, replace the serial `spawnSync` per query with async `spawn` + `Promise.all`, at most 4 at a time, keeping the hits in query order. Reuse the `.codemap/` index across queries.
  - (b) Measurement fixes:
    - `make_tasks.mjs`: the case prompt should say to run `find.mjs` with Bash `timeout: 600000` in the foreground.
    - Run at most 4 case agents at once.
    - `helpers/f1.mjs`/`f2.mjs`: log start/end timestamps for both arms. Today A's helper time is not logged at all.
- **why:**
  - 18 of 24 helper calls hit the 120 s timeout and went to the background (n6 r1 B waited 301 s and got nothing).
  - Background helper runs coincide with the polling calls (A 40, B 61) and with the large turn gap (+49% on backgrounded pairs vs +23% on the foreground pairs).
  - Jev itself took 1.8-3.9 s; the rest of the 64-298 s `elapsedMs` was codemap under load.
- **expected effect:**
  - About −40 to −60 polling calls across both arms.
  - Fewer serial "check output" turns.
  - The A/B token gap becomes measurable instead of load-driven: it should fall toward the +11 to +22% seen without backgrounding.
- **how to verify:**
  - Count the helper tool_results containing "moved to the background": the target is 0/24.
  - Compare B−A turns per pair against this run.
  - `elapsedMs` in `runs.jsonl` should be under 60 s at 4 concurrent agents.

### 3. Replace the case set: these 6 tasks cannot show a ranking gain

- **change:** In a new `tasks-new.json`, choose at least 6 tasks with `offline_score.mjs` before any agent runs. The gold file must be in the pool but not in codemap's raw top 3, n6-like. Keep at most 1 retrieval miss like n5 as a control. Hold out these tasks for the gate thresholds (0.5 / 0.9 / 5 / 3), which are still in-sample.
- **why:** In this set:
  - 4/6 tasks have gold at raw #1 in both arms.
  - n5's gold (`fast-compact/hooks/*`) is not in the pool.
  - Only n6 needed ranking.
  - 23/24 agents found gold by grep anyway.

  So only the cost side of the tool is measurable here.
- **expected effect:** The next A/B can show a real recall or turns-to-gold difference, or show that there is none. It also gives an out-of-sample check of the gate cut.
- **how to verify:**
  - Offline: codemap-only fails Recall@5 on at least 4 of the new tasks, and Jev passes at least half of those.
  - In the agent run, add a "turns until first gold file opened" measure from the transcripts, which are available via `usage.scrubbed.json`.

### 4. Fix the gate's two observed failure modes before any further Jev run

- **change:** In `explore.mjs` `confidenceGate()`/`toMarkdown()`:
  - (a) On `low`, print up to 5 rows, not 3. Alternatively, on `low` with `noneP` < 0.5, print the rows down to p ≥ 0.05. n6 had gold at Jev #5/#6 behind a p 0.24 top-1.
  - (b) Print the "Re-run with --no-gate" hint only when the caller can pass the flag. The eval wrapper `helpers/find.mjs.tpl` forwards no flags, so n4 r2 B's second run with `--no-gate` was ignored and returned the same 2 rows (one wasted helper run).
  - (c) Fix the empty query labels in "why it matched" (`2 queries: ` with no names, for example n2/n3/n6 rows).
- **why:**
  - The gate hid the only gold-bearing rows in the run.
  - The hint led an agent into a no-op re-run.
  - Blank evidence cells look like noise to agents.
- **expected effect:** Only matters if Jev stays on (see 1): the gold is visible in n6-like tasks, and there is 1 fewer wasted helper run per affected case.
- **how to verify:**
  - Unit tests in `tests/explore.test.mjs`: a low gate with gold at #5 must be shown; no hint in library mode; a non-empty query label.
  - Re-render `n6-feature-subagent-tokens.r2` from its logged `jev` block and check that `subagent_usage.mjs` is printed.

### 5. Close the open review and bookkeeping findings

- **change:**
  - (a) Regenerate `summary.json` and `report.html` from the current `evidence/scores.json`:
    - `summary.json` still says A pass 10 / fail 2 and lists n6 as an improvement.
    - `scores.json`, after the uncommitted backslash fix in `score.mjs`, says A 11/12 with only n3 r1 failing.
    - Fix the `manifest.json` deviation text too ("no gold group missed? see scores.json").
  - (b) Have `helpers/f2.mjs` log the pre-Jev rules order (`rulesTop`) and the `gate` block, so "did the engine change rules, and was it right" can be answered from this run's own logs.
  - (c) Open Minor findings in `agent-review.json`:
    - `noneP` mass makes "high" print 5 low-p rows.
    - `parseArgs` treats `--no-gate false` as truthy.
    - Missing wiring tests: `explore()` gate, CLI `--no-gate`, multi-batch path, the 0.5 boundary.
    - The pool-size dependence of p.
- **why:**
  - The report's headline numbers disagree with the scorer.
  - The rules-vs-Jev question had to be answered from the previous run's offline file.
- **expected effect:** Correct report numbers (A 11/12, not 10/12) and auditable gate and engine decisions. No token effect.
- **how to verify:**
  - `collect.mjs` output matches `scores.json`.
  - The B log lines contain `rulesTop` and `gate.confidence`.
  - `node --test tests/explore.test.mjs` passes with the new tests.

### On "drop the tool"

- Not supported on its own.
- Arm A *is* the tool's retrieval in codemap order, and it found gold at #1 on 4/6 tasks, so that part has value.
- The evidence supports dropping the **engine call and the rules re-rank** (suggestion 1).
- Drop the whole tool only if a run with suggestion 2 in place, on an unloaded machine, still shows A (helper) ≥ plain Claude with no helper. That comparison has not been made yet.
