# Rubric W-22016

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from "Year-End Review - Complete Self-Rating and goals status / achievement details against each goal" (filed 9/29/2026). The test expects: the employee records a self-assessment against all goals (step 1); the employee adds supporting comments explaining accomplishments (step 5); and entries are retained after save (step 7). The comments say the self rating is not available per goal (step 4), and the employee cannot attach a document at the EOY review stage (step 5).
Not stated: file types, size limits, and where the self-rating field sits in the layout.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes self rating, status and achievement details available for each goal. Fail: it offers only one general comment box for the whole review.
- **R2.** Pass: the answer lets the employee attach a supporting document at the EOY review stage. Fail: attachment is still not possible at that stage, or attachment is offered only at another stage.

## Diagnostic (D), reported only
- **D1.** States the file types or size limit it chose. Not required.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
