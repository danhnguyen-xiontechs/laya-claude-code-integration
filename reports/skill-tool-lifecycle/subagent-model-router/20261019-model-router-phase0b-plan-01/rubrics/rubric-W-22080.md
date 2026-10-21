# Rubric W-22080

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (three R).

## Story summary
Bug from "Workflow - Overtime process - Attendance administrator should be able to view all overtime entries calculated by system. Must have an option to select all and approve (or not approve) a particular entry" (filed 10/1/2026). The test expects: AMSF and MSO have access to view and approve individual overtime entries for staff; a consolidated report is also available to the OPS team and HR. The title says the screen keeps showing a confirmation pop-up on each checkbox click.
Not stated: how the access roles are set up, and the exact layout of the select-all control.

## Required (R), decisive for overall
- **R1.** Pass: the answer adds a select-all option and lets the approver approve or not approve an individual entry. Fail: there is no select-all, or there is no per-entry choice.
- **R2.** Pass: the answer removes the confirmation pop-up on each checkbox click. A single confirmation for the bulk action is allowed. Fail: the pop-up still appears on each checkbox click.
- **R3.** Pass: the answer gives AMSF and MSO view and approve access to individual overtime entries, and provides a consolidated overtime report to the OPS team and HR. Fail: either part is missing.

## Diagnostic (D), reported only
- **D1.** Names the roles or permissions it uses to set the access. Not required.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1, R2 and R3 all pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
