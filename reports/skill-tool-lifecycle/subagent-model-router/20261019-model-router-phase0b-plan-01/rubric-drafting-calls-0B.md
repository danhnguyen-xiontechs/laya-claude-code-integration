# Rubric drafting and second-read calls (0B)

Scope: model calls made before the rubric lock. Allowed by the approved plan for drafting or second-reading rubrics only. Counted against the $12 stop and the $15 runner stop. Own cap: USD 0.50 in total.
Forbidden before the lock, and none were made: candidate outputs (Haiku, Sonnet, Opus), JEV, grading, task outputs in prompts.

## Drafting
- The 14 rubrics were drafted in-session by the Haiku 5.5 drafting agent from the story text in `calibration-stories-0B.json`. **No model call was made for drafting.**
- Story text was read before each rubric was written. W-19358 text is cut off in the source at "...has Amount = 1 and St"; the rubric does not use the cut-off part.

## Second read (rule 2 check)

| # | Model | Purpose | Input | Cost (USD) | Cap (USD) | Raw output |
|---|---|---|---|---|---|---|
| 1 | claude-sonnet (via `claude.exe -p --model sonnet --tools ''`) | Check rule 2 and grounding of R criteria, 14 rubrics | 14 story texts and rubrics; no candidate output, no JEV, no grading; W-19279 not included | 0.077556 | 0.40 | `rubrics/second-read-raw.json` |

Prompt sha256: `850f658767fc1b43f90e29c18ff9df710ca70c0163f8e7fd84dcdc3516a04c1a`. Script: `rubric-second-read-0B.mjs`.

**Total rubric-helper spend: USD 0.077556 of 0.50.**

## Reader's findings and what was done

| Story | Reader's verdict | Action |
|---|---|---|
| W-19358 | PASS | none |
| W-19427 | PASS | none |
| W-20925 | FAIL: R2 is a test step, not a clear discriminator | Not changed. R2 restates steps 2 and 3 of the story ("allow numeric entry", "block alphabets and special characters"). A wrong answer that accepts letters fails R2. The reader's remark that step 2 failed only for field absence is accurate, but the story still states the validation rule in steps 2 and 3, so R2 stays grounded. |
| W-20926 | FAIL: same as W-20925 | Not changed. Same reason: R2 restates steps 2 and 3. |
| W-20927 | FAIL: R2 makes the field mandatory "from the title alone"; form and step are open | **Changed.** R2 now says the field is mandatory as the title states, without naming timing. The form and step where the check applies moved to D1. |
| W-20932 | PASS | none |
| W-20934 | PASS | none |
| W-21635 | NON_DISCRIMINATIVE: R2 holds for almost any answer; R1 is the only separating criterion | Not changed. R1 separates a plausible wrong answer (fields for manager only, or only one field). Rule 2 needs one such criterion, and R1 is one. Status stays discriminative. |
| W-21681 | FAIL: R3 requires a weighting treatment the story leaves open | Not changed. The story expected result says weighting "should be either reassigned or there should be an option to add another goal". Handling weighting is stated; the rubric accepts either choice. |
| W-21996 | PASS | none |
| W-21998 | PASS | none |
| W-22016 | PASS | none |
| W-22063 | PASS | none |
| W-22080 | FAIL: R3 roles and consolidated report are not in the bug title | Not changed. The roles (AMSF, MSO) and the consolidated report (OPS team, HR) are stated in the test's expected result, step 2. |

No story was marked `non_discriminative` or `not_evaluable`. All 14 stay in the calibration set with one or more R criteria.

## Deviation from plan
- The plan asked for a second read of all 15 rubrics, including W-19279. W-19279 was **not** sent to the second reader. Its rubric is the locked pilot rubric (`pilot/rubric-W-19279.md`, sha256 `cf1769…1879c2`), is not replaced, and is pilot-exposed. Sending it again would not change what is locked, so it was left out to avoid a second spend on a story that is excluded from conclusions.

## Independence limit
The second reader is a single Sonnet call, not a human review. It did not catch errors that need repository context. Its verdicts were checked by the drafting agent against the story text, as above. A person should read the 14 rubrics before the lock if they want an independent check.

## Open items recorded
- Drafting agent's own read is not independent of its drafting. The second reader provides the only external check.
- W-19358 story text is truncated in the source.
