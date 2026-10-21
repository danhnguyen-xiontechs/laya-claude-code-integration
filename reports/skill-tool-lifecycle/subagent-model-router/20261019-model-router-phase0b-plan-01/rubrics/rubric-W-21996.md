# Rubric W-21996

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from "Workflow - Attendance regularization - Staff should be able to regularize missing check-in by submitting the request" (filed 9/28/2026). The test expects: staff can request regularization of attendance from ESS; attendance master is updated only after approval by an authorized approver; the attendance report is viewed at Home > Attendance. The comment says that to create the request, staff must return to Home and search for "Submit request".
Not stated: where the entry point should be placed, and the approval chain beyond "authorized approver".

## Required (R), decisive for overall
- **R1.** Pass: the answer gives staff a visible way to start the regularization request from ESS navigation (for example from Home or Attendance) without searching for it. Fail: search stays the only route, or the request is moved to a screen staff cannot reach.
- **R2.** Pass: the answer keeps the approval step: attendance master changes only after the authorized approver approves. Fail: the change applies without approval.

## Diagnostic (D), reported only
- **D1.** States where the entry point is placed. Not required.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
