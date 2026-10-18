# Idea brief (retro, round 2): dead-code-finder, short report

**Baseline:** [20261018-dcf-agent-01](../20261018-dcf-agent-01/manifest.json) (round 1, REWORK, 2026-10-18). Its `improvements.md` ranks the top suggestion first: make the report short (Tier A and B only, Tier C as a count). This folder applies that suggestion and nothing else, then measures it on the same cases with the same rules.

## Question this run answers

> With the short report, does Claude + dead-code-finder (Jev live) cost no more tokens than plain Claude, at the same pass rate, on the same four cases?

Round 1 measured B at +61% tokens (2.01M -> 3.23M over 8 runs per arm), 1-5 extra model turns spent reading the 31-line Tier C list and re-checking, and dcf-04 recall 6/8 vs 8/8 for A.

## What changed (tool, JEV repo, not committed there)

- `jev_skills/dead_code/report.py`: default `report.md` = funnel line, Tier A table without the evidence column, Tier B table with it, Tier C as a count only; `--full` lists Tier C.
- `jev_skills/dead_code/scan.py`, `__main__.py`: `full` flag threaded from `scan --full` to the report.
- `tests/test_dead_code.py`: one test that the default report has no Tier C list and that `full=True` has one.
- Full diff: [tool-change.patch](tool-change.patch). The code lives in the JEV worktree (untracked files, commit e551872); it was copied to scratch and changed there. The JEV repo is not edited.

Not applied (kept for the next round): suggestion 2 (Tier B "0 refs incl. strings" column and sort), suggestion 3 (`__init_subclass__` keep rule), suggestion 4 (accepted Major findings), suggestion 5 (drop Jev, not warranted yet).

## Success criteria (fixed before any round-2 data)

1. B passes at least as many cases as A in every pair (repetition 1 and 2).
2. No case that passes in A fails in B.
3. Paired B tokens do not exceed A tokens by more than the noise between repetitions (or more than 10% with one repetition).

If all three hold, the result is "clearly better" and the verdict is left to the user at Gate B. If not, `improvements.md` is written again (step 7b).

## Wrong, slow or down

Unchanged from round 1: the wrapper falls back to rules (no Tier A without Jev); every Jev call is logged in `evidence/_logs/`.

## Non-goals

Fixing the tool beyond the report change; a verdict on large repositories; the hook, prune and backtest parts of the skill; the model router (case agents are Haiku 5.5, effort xhigh, by the user's rule).
