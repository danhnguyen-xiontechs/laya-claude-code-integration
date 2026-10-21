# Rubric W-21998

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from "Workflow - Attendance regularization - HR should be able to receive request and approve/reject the request once approved by Attendance administrator" (filed 9/28/2026). The test expects: after the attendance administrator approves, final approval rights sit with HR, and only then do attendance changes sync to the attendance master. The comment says an employee submitted a 3-hour shortage, but HR sees 7 hours in the D365 HR view.
Not stated: the cause of the 3-hour vs 7-hour difference, and whether it comes from the data, the form or the sync.

## Required (R), decisive for overall
- **R1.** Pass: the answer's proposed fix makes the HR view show the submitted 3-hour shortage, and says how. Fail: it does not address the 3-hour vs 7-hour difference, or it only asks HR to check by hand.
- **R2.** Pass: the answer keeps HR's final approval before the change syncs to the attendance master. Fail: it removes HR's approval, or syncs on the administrator's approval alone.

## Diagnostic (D), reported only
- **D1.** States a suspected cause for the 3 vs 7 hours. If not confirmed by the story, it is labelled as a guess. Not required.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
