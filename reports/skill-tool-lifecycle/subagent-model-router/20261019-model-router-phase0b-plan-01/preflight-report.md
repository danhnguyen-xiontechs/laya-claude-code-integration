# Phase 0B pre-flight report (task 7790)

Date: 2026-10-20. Scope: offline audit of the Phase 0B lock, runner, ledger, budget and rubric plan.

**What this report does not do:** it makes no model call (no candidate, JEV, grading, repeat grading or calibration call), no commit, no push, and no ADO or external pull. It does not approve the run. The run waits for the user's explicit OK on `run-0B-lock.md` and `budget-sheet-0B.md` v4. Held-out is not approved.

## Result

- Offline checker: `node preflight-check-0B.mjs` → **18 of 18 checks passed, exit 0.** It is read-only, offline, and prints counts only (no held-out ids).
- Stub tests (15 scenarios, stub CLI, scratch copies): all pass per `stub-test-0B.md`. See the open item on the runner hash.

## Audit items

| # | Item | Evidence | Status |
|---|---|---|---|
| 1 | Run lock hashes | 25 files in `run-0B-lock.json`, 0 differ | Pass |
| 2 | Rubric lock | 15 rows in `rubric-lock-0B.md` (14 + pilot W-19279), 0 differ | Pass |
| 3 | Split integrity | `split-0B.json` `assignmentsSha256` `b157d7be…a917fa2` reproduced by the 0A pairs method; membership matches the `0B-v1` rule for 21 of 21. Split file not edited. | Pass. The earlier "not reproduced" note was wrong and is corrected in `rubric-plan-0B.md` §9, `run-0B-lock.md` and `make-run-0B-lock.mjs`. |
| 4 | Split counts | 21 stories: 15 calibration, 6 held-out | Pass |
| 5 | Story status | `story-status-0B.json`: 13 evaluable, 1 `not_evaluable` (W-19358), 1 `pilot_exposed` (W-19279) | Pass |
| 6 | W-19358 `not_evaluable` | Visible text is 984 characters in every local copy (`real/stories-text.json`, `real/stories-hindsight.json`, `raw-sources.json`, `tasks.normalized.json`, git `f873c11`). `gov-text.json`, `gov-hindsight.json` and `coverage.json` hold only the id. Checker matches stored length and sha256. No ADO pull. | Recorded before any call. **User decision:** accept, or give a reason to change. |
| 7 | Call count | 42 generation + 42 grading + 9 repeat = **93** (runner and lock agree) | Pass |
| 8 | Repeat universe | 13 evaluable × 3 tiers = 39; seed `0B-regrade-v1` | Pass |
| 9 | Baseline ledger | `baseline-ledger-0B.json` (`0B-baseline-v1`): one entry, `rubric-second-read`, sonnet, 0.0775562; matches `rubrics/second-read-raw.json` by sha256 and `total_cost_usd` | Pass. The runner reads it and fails closed (`baseline-missing` / `baseline-mismatch`). |
| 10 | Runner parameters | `run-0B.mjs` matches lock: STOP 12, runner stop 15, caps haiku 0.10 / sonnet 0.40 / opus 0.60 / grader 0.40 | Pass |
| 11 | No output in folder | No `results/`; no output-like top-level names | Pass |
| 12 | Held-out isolation | 0 matches across 18 prompt-bearing inputs and 43 text files in the folder (split file excluded because it lists the split) | Pass |
| 13 | Human review | `rubric-human-review.md`: 7 stories, each rubric sha256 matches the lock | Pass. No rubric changed. |
| 14 | Budget v4 | 93 calls; marked not approved | Pass |
| 15 | Lock status | `run-0B-lock.md` says "Waiting for the user's explicit OK" | Pass |

## Budget (v4)

- Calls only: about **2.6** (table in `budget-sheet-0B.md` §4, v2 real per-call costs).
- Counted by the runner: about **2.7**, because the run starts at the rubric-helper spend of 0.0775562.
- At 3x: about 8.0.
- Hard upper bound if every call hits its cap: 35.8. The reserve stop (12) and the runner stop (15) are the controls, not this figure.
- Held-out (not approved): about 1.0 (about 3.1 at 3x).

## Open items

1. **W-19358 `not_evaluable`.** The full text is not recoverable locally. The user decides whether to accept this or give a reason to write a rubric from the 984 visible characters (a new lock).
2. **W-21635 judgment call.** The second read called it non-discriminative. It is kept as discriminative (R1 separates a plausible wrong answer). The user decides whether to keep it or record it as `non_discriminative`.
3. **W-20925 and W-20926 R2.** Flagged as possibly testing steps. Not changed. The user decides whether to keep R2 decisive or move it to D.
4. **W-20927 R2 change.** Made after the second read and before the lock (the form and the step moved to D1). The user accepts or reverts.
5. **W-22080 and W-21681 R3.** Flagged. Not changed, because the story text supports both. The user decides.
6. **No independent human rubric check.** Only one reader (a Sonnet second read, USD 0.0776) checked the rubrics. A person should read the 14 rubrics before the run, if they want an independent check. A change after the lock needs a new lock.
7. **U+FFFD in story text.** W-19279 (2), W-19358 (1), W-19427 (3), W-20932 (1). Shown as stored, so the model input and hash stay as locked.
8. **Stub record and runner hash.** `stub-test-0B.json` does not record a runner hash. The runner was last edited at 00:22:18; the stub record was written at 00:28:00. The stub copies were not re-run in this audit. So "the stubs pass on the current runner" is inferred from the timestamps, not re-verified.
9. **Known runner gap (reported, not fixed).** `status.json` is written as `running` before the baseline check. A run that halts at `baseline-missing` or `baseline-mismatch` may leave that status on disk. It makes no call in either case.
10. **v1 Haiku anomaly.** The v1 Haiku call was charged 0.162 against a 0.10 cap. Its raw output was not saved. It was outside the runner count and is not in the 0B budget. A single overrun like this is why $15 is a runner stop, not a billing ceiling.
11. **`laya-router` MCP server** failed to connect (CONNECTION_CLOSED). Not needed for this audit; not fixed.

## Decisions awaiting the user

- Approve `run-0B-lock.md` and `budget-sheet-0B.md` v4 (the 93-call run, with Opus generation included).
- Confirm W-19358 as `not_evaluable`, or give a reason to change it.
- Held-out budget stays not approved.

Until the user gives the explicit OK, no candidate, JEV or grading call is made.
