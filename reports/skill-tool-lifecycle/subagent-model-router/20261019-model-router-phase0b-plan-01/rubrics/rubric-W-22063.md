# Rubric W-22063

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (one R).

## Story summary
Bug from "Employee - Attendance Reports - Staff should be able to view the attendance data" (filed 9/30/2026). The test expects the employee to see their own attendance data in StaffXP (step 2). The title says holidays are not reflected in ESS My Attendance or Team Attendance.
Not stated: where holiday data comes from, and whether Team Attendance should show the same holidays as My Attendance.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes public holidays appear on both My Attendance and Team Attendance in ESS. Fail: it fixes only one of the two, or it changes labels without showing holidays.

## Diagnostic (D), reported only
- **D1.** Says where it expects the holiday data to come from. If the story does not say, the answer labels this as an assumption.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 passes AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
