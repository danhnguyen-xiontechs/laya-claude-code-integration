# Rubric plan for the Phase 0B calibration (v3: R/D/E shape)

Status (2026-10-20): **14 rubric files are written, second-read once, and hashed** in `rubric-lock-0B.md`: 13 evaluable stories, plus W-19358, which is `not_evaluable` and gets no call. W-19279 keeps its pilot rubric and is pilot-exposed. No model call has been made for 0B. Nothing is approved for 0B yet: the user's OK on `run-0B-lock.md` and `budget-sheet-0B.md` v4 is still needed.

v3 replaces v2. v2 counted W-19358 as evaluable and used 99 calls. v3 records W-19358 as `not_evaluable` (`story-status-0B.json`) and uses the 93-call count of budget v4. The R/D/E shape is unchanged. v2 replaced v1, which described C1 to C4 for every story.

## 1. Why a rubric per story
Real stories have no acceptance criteria. Each output is graded blind (the grader sees only A/B/C and the story text) against a rubric locked before any output exists for that story. Without a locked rubric the grade would measure the grader's taste, not the answer.

## 2. Shape (as in each `rubrics/rubric-<id>.md`)
- **Story summary**: from the story text only. It also states what the story does not say.
- **R1, R2, ... (Required, decisive for overall)**: the behaviour the story supports. Each has a pass rule and a fail rule. There is one or more per story, as many as the story actually supports. None is invented to reach a count.
- **D1, D2, ... (Diagnostic, reported only)**: things the story does not require. They are reported and never decide overall.
- **E1 to E4 (severe errors, same for every story)**:
  - E1: the reported problem is still present after the answer.
  - E2: the answer breaks a valid case the story does not ask to change.
  - E3: the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
  - E4: no change is proposed (only questions, or a refusal).
- **Overall**: pass = all R pass AND no E. Anything else fails.
- **Quotes**: for each R verdict the grader quotes the answer text it relies on. The runner checks each quote by exact match (LF-normalised). This is a deterministic check and costs nothing.

## 3. Rules for each rubric
1. **Story text only.** No model output, no 0A bench task, no held-out story, no `truth-effort.json`.
2. **At least one R criterion that a plausible wrong answer fails.** If a story has none, it is recorded as `non_discriminative` (or `not_evaluable` if the text is too thin for pass/fail rules). That is recorded before any model call. It is reported, does not count toward `minimum_sufficient_tier`, and is not rewritten to pass. **No story was marked `non_discriminative`.** W-19358 is `not_evaluable` for a different reason: its text is not recoverable (section 4).
3. **Pass/fail rules a blind grader can apply.** No words like "good" or "clear".
4. **Story gaps are stated, not filled.** If the story leaves a choice open, the R criterion accepts either choice when the answer states it.
5. **One file per story**, with the header "Locked before any output for this story exists" and the date.
6. **Frozen once locked.** A change after the first output is seen makes a new version, and that story's grades are void.

## 4. Per-story status

Counts are from the rubric files. Every story has four E criteria, and every story has one or more R criteria.

| Story | R | D | Status and notes |
|---|---|---|---|
| W-19279 | C1, C2 (required) | C3, C4 (reported) | **Pilot-exposed.** Locked pilot rubric (sha256 `cf1769…1879c2`), not replaced. Pilot v2: all three tiers passed, so it does not separate the tiers. Runs for provenance; excluded from every 0B conclusion. |
| W-19358 | 1 | 1 | **`not_evaluable`** (`story-status-0B.json`). Full text is not recoverable locally: every copy is cut at 984 characters. The rubric file is locked and not used. No candidate, JEV or grading call is made for this story. Second read: pass. |
| W-19427 | 1 | 1 | Locked. Second read: pass. |
| W-20925 | 2 | 1 | Locked. Second read flagged R2 as a test step. Not changed: R2 restates the story's steps 2 and 3, so a wrong answer that accepts letters fails it. |
| W-20926 | 2 | 1 | Locked. Second read flagged R2 as for W-20925. Not changed, same reason. |
| W-20927 | 2 | 1 | **R2 changed after the second read** (before lock): the field is mandatory as the title states; the form and the step where the check applies moved to D1. |
| W-20932 | 2 | 1 | Locked. Second read: pass. |
| W-20934 | 1 | 1 | Locked. Second read: pass. |
| W-21635 | 2 | 1 | Locked. Second read called the story non-discriminative (R2 holds for most answers). **Kept as discriminative:** R1 separates a plausible wrong answer (manager-only fields, or only one field). **Judgment call for the user to check.** |
| W-21681 | 3 | 1 | Locked. Second read flagged R3 (weighting). Not changed: the story says weighting "should be either reassigned or there should be an option to add another goal", and R3 accepts either. |
| W-21996 | 2 | 1 | Locked. Second read: pass. |
| W-21998 | 2 | 1 | Locked. Second read: pass. |
| W-22016 | 2 | 1 | Locked. Second read: pass. |
| W-22063 | 1 | 1 | Locked. Second read: pass. |
| W-22080 | 3 | 1 | Locked. Second read flagged R3 (roles and consolidated report not in the bug title). Not changed: both are stated in the test's expected result, step 2. |

The table covers 14 rubric files (W-19279 excluded; it has its own pilot rubric): 26 R, 14 D. Evaluable for 0B is 13 stories (W-19358 excluded), so the runnable count is 25 R, 13 D and 52 E checks (4 per story). Each story keeps its R criteria as locked; the table is a count, not a re-check.

## 5. Second read (one call)
- One Sonnet call read all 14 evaluable rubrics against rule 2 and grounding. Cost USD 0.077556 of the 0.50 helper cap. Raw output: `rubrics/second-read-raw.json`. Script: `rubric-second-read-0B.mjs`.
- The reader flagged six stories (W-20925, W-20926, W-20927, W-21635, W-21681, W-22080). Each was adjudicated against the story text (table above). Only **W-20927 R2** changed.
- **Limits.** One reader, not an independent human review. The reader did not have repository context. The drafting agent's own check is not independent of its drafting. A person should read the 14 rubrics if they want an independent check. Any change after the lock needs a new lock, not a silent edit.

## 6. Scope of the result (what `minimum_sufficient_tier` can and cannot say)
- The calibration is **text-only**: each model gets the story text and no repository, no tools and no tests. Grading is against the written rubric and the story text.
- It can say which tier gives answers that pass the rubric, for these 14 stories, under this brief and this grader.
- It cannot say which tier codes well in the real repository. That needs repo access, test runs and real PR outcomes, which this phase does not measure.
- Every report states this scope next to `minimum_sufficient_tier`. The tier is not presented as a proven routing decision. The report also shows per-tier answer length and format, because a reader may see tier from style. This is disclosed, not controlled.
- No routing change and no held-out run follow from 0B without a separate approval.

## 7. Lock and run order
1. User OK on `run-0B-lock.md` and `budget-sheet-0B.md` v4. (Nothing runs before this.)
2. `node run-0B.mjs` once, sequential. The runner refuses to start if any hash differs from the lock or if `results/` exists. It starts spend at the rubric-helper total from `baseline-ledger-0B.json` and makes 93 calls: 42 generation, 42 grading, 9 repeat grading. W-19358 gets no call.
3. Report from `results/`: `summary.json` shows 15 calibration stories (13 evaluable, W-19279 flagged and excluded, W-19358 `not_evaluable`), 93 calls, total spend, halt status and held-out check. Repeatability and human agreement are reported in separate rows.

## 8. Held-out
The 6 held-out stories have no rubric in this plan. Their rubric is written before the held-out run, under the held-out budget, which is not approved. Nothing in this file names them.

## 9. Open items
- **Split file:** `split-0B.json` records assignmentsSha256 `b157d7be…a917fa2`. It is reproduced by the 0A pairs method (sha256 of `JSON.stringify` of the id-sorted `[id, split]` pairs), and membership matches the `0B-v1` rule for 21 of 21 stories. The file is not edited and version stays `0B-v1`. An earlier note said no serialisation reproduced it; that was wrong.
- **W-19358** is `not_evaluable`: its source text is truncated and the full text is not recoverable locally. Decision for the user: accept that, or give a reason to change it (budget v4, section 8, item 3).
- **Independent rubric check** by a person is not done. Recommended before the run. If it changes a rubric, the lock must be regenerated first.
