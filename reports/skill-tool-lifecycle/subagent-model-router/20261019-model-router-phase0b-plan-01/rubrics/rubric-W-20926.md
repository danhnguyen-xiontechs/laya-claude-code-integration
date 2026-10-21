# Rubric W-20926

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from test case "Employee - Fields validation - Address verify mandatory/optional behavior" (filed 9/21/2026). The test expects alphanumeric entry to be allowed (step 2) and special characters to be blocked (step 3). The comment says there is no field to enter an address during leave.
Not stated: whether the field is mandatory or optional, and the exact form.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes an address field available in the leave request flow. Fail: it adds no field, or adds one only on a screen that is not part of leave.
- **R2.** Pass: the answer makes the field accept letters and digits, and block special characters, as steps 2 and 3 require. Fail: it accepts special characters, or accepts only letters or only digits.

## Diagnostic (D), reported only
- **D1.** States whether the field is mandatory or optional, and why. The story does not say, so the answer may choose and must state the choice.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
