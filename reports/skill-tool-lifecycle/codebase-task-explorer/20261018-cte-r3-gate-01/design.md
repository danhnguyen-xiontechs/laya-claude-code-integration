# Design — 20261018-cte-r3-gate-01 (offline gate on ess-be)

Brief: `idea-brief.md` (Gate A 2026-10-18, repo = ess-be). Branch `claude/cte-r3` (from `claude/cte-round2`; codegraph branch not merged, codegraph is out).
**Frozen 2026-10-18, before any task, gold or engine output exists.** Changes after this line go to `deviations`.

## 1. Code changes (explore.mjs)
| Change | Contract |
|---|---|
| Provider default | `none` unless `--provider jev\|laya\|kev` is passed; `DECISION_PROVIDER` alone no longer turns Jev on |
| Order with no engine | `codemapOrder()`: best per-query rank, then hit on the task-text query, then queries matched, then path. `result.order = 'codemap'`; rules order still in `rulesTop` |
| Parallel codemap | async `spawn`, at most 4 at a time, 60 s per query; output identical to serial order; failed/timed-out query → no hits + coverage note |
Tests: `node --test "tests/*.test.mjs"` in the skill folder; results go to `unit-tests.json`.

## 2. Where data lives (privacy)
ess-be is private; the Laya repo is public. Everything that contains ess-be text or paths stays in `D:/cte-r3/` (not in git): unit list, PR text, task texts, gold, snapshots, engine outputs. The Laya repo gets only scripts (`scripts/` in this folder) and `gate-offline.json` with **task ids and numbers only** (no paths, no text). Each script takes `--data D:/cte-r3`.

## 3. Task set
**Units** (change sets of ess-be, `D:/XionTechs/ess-be`, read-only): fixed list below, chosen by the author from `git log` subjects and changed-file *counts* only (no file names looked at). Merged PRs use `<merge>^1..<merge>`; single commits use `<c>^..<c>`. Commits already inside a listed PR are not listed again.

| id | unit | subject (short) |
|---|---|---|
| e01 | PR 5199 `e80552a3` | overtime list only employees with records |
| e02 | PR 5201 `991a4f87` | save review progress replaces save-rating |
| e03 | PR 5207 `7faa2e41` | cancelled leave shown as approved |
| e04 | PR 5208 `583c8c3a` | pending leave overlay |
| e05 | `1b357ed5` | calibration rating filter fallback |
| e06 | `ee6d2b2d` | payslip token flow, worker id |
| e07 | `1d6d5102` | probation members |
| e08 | PR 1862 `0b02b833` | task is due today |
| e09 | PR 1868 `dd99bb9b` | add task status |
| e10 | PR 1853 `9d8dd278` | update status task |
| e11 | `73390274` | payment endpoint inactive case |
| e12 | `9ec51510` | active condition issue |

**Gold** (script `build_units.mjs`, before any task text is written): files with status `M` (modified, so they exist at the parent) in the unit diff, `.cs` only, excluding paths matching `test|migration|designer|snapshot` (case-insensitive). Added files cannot be found at the parent and are not gold. A unit with 0 gold files is dropped.

**Snapshot**: `git archive <parent>` → `D:/cte-r3/snap/<id>/` (no `.git`, so history cannot leak the fix).

**Task text and queries**: one Haiku 5.5 (`haiku-case`, xhigh) agent per batch sees only the unit's commit subject + body (the PR description), never the diff or file names, and writes for each unit: `task` (1-2 sentences, as a developer would ask "where do I start"), `mode` (bug|feature), `queries` (3-4 search phrases a developer would try). Rule given to it: no file names, class names or CamelCase identifiers.
**Leak check** (mechanical, `check_tasks.mjs`): lower-case the task + queries, remove spaces; if any gold file stem (basename without `.cs`, lower-case, length ≥ 6) is a substring → leak. Leaking unit: rewritten once by the agent with the leaking words named; still leaking → dropped.

**Hardness filter** (neutral baseline `rg`, section 4): keep a unit if no gold file is in rg's top 3. At most 1 unit that fails the filter is kept as an easy control (the newest). Keep up to 8 units (newest first). Fewer than 5 kept → stop, report "not enough hard tasks".
Known bias: the filter selects tasks where rg is weak, so rg's score on the filtered set is pushed down. The gate decides on the filtered set (that is the population the tool is for), and every engine's score on **all** units is reported next to it.

## 4. Engines (gate adapters, `scripts/engines.mjs`; none of them is added to explore.mjs)
Every engine gets the same `task`, `queries` and snapshot and returns an ordered list of paths (repo-relative, `/`), cut at 8 for scoring. Timeout 30 s per task query → `failed` (counts as a miss). Index build is done once per snapshot before the queries, timed separately.

| Engine | Call |
|---|---|
| `rg` (reference) | words of task + queries (lower-case, length > 2, minus a fixed stop list); `rg -c -i -F -e w` per word over `*.cs`; score = 10 × distinct words matched + log2(1 + total hits); ties by path. Binary: `RG_BIN` (copilot-bundled rg on this machine) |
| `codemap` | `explore.mjs --engine codemap --provider none --json --task <task> --queries <q1\|q2\|…> --mode <mode>` → `top[].path` (codemap 4.6.0, `~/tools/codemap`) |
| `ck` | `ck --index .` once; then `ck --hybrid --jsonl --topk 50 "<task>" .` → unique files in order (ck 0.8.1, default model bge-small, embeddings local) |
| `repomap` | RepoMapper (pdavis68, MIT) `repomap.py . --mentioned-idents <idents> --map-tokens 4096 --exclude-unranked`; idents = query words + each query in PascalCase (e.g. "overtime records" → `OvertimeRecords`); files in order of appearance |
`ck --sem` is also run and reported for information, not used for the decision.

## 5. Metrics and gate (frozen)
- Per task: `Recall@8 = |gold ∩ top8| / min(|gold|, 8)`; `Hit@8` = any gold in top 8; latency = wall time of the query call.
- **Gate pass** = some engine E (codemap, ck hybrid or repomap) with mean Recall@8 on the filtered set **≥ rg + 0.15**, latency **p50 < 5 s and max < 15 s**. If several pass, the one with the highest Recall@8 goes to the agent run.
- codemap guardrail: the unit tests prove parallel = serial order. Recall@8 of explore on Laya `eval/tasks.json` before (round-2 rules order) and after (codemap order) is reported; a loss is a caveat, not a gate fail (codemap order is the approved default).
- Coverage: share of the snapshot's `.cs` files each engine indexed (where the engine reports it), reported.
- Gate fail → stop, no agent run, no Opus call. Write `gate-result.md`.

## 6. Agent run (only if the gate passes; designed in a later `design-agents.md` before it runs)
8 tasks × 2 reps, Haiku 5.5 xhigh, `haiku-case`, at most 4 in flight; A = plain Claude, B = Claude + gate winner via a neutral wrapper; answer keys never in the snapshot; `subagent_usage.mjs --forbid`.
