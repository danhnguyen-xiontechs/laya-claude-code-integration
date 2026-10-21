# Rubric W-21635

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from "PM-GS-014 - Goal Setting - Submit Goal Plan for Approval" (filed 9/23/2026). The test expects: all goal-related sections completed; the goal plan submitted and routed for manager review; a confirmation message; and status changed to Submitted. The comment says that goal-related details and a Measure of success field are not available for the staff member to fill in against each goal.
Not stated: whether Measure of success is required, and the exact layout.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes goal-related details and a Measure of success field available to the employee for each goal. Fail: only one of the two is added, or the fields are added for the manager only.
- **R2.** Pass: the answer keeps the submit path working: a goal plan with the new fields completed is submitted, the confirmation appears, and status becomes Submitted. Fail: the new fields stop the submit or the status change.

## Diagnostic (D), reported only
- **D1.** States whether Measure of success is mandatory, and why. Not stated in the story, so the answer may choose and must state the choice.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
