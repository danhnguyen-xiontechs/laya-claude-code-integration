# Rubric W-20927

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from test case "Employee - Fields validation - Handover Details & Remarks" (filed 9/21/2026). The title says there is no field to enter handover details mandatorily. The test expects the system to save the entered data (step 2).
Not stated: the form or request type the field belongs to, when the mandatory check applies, and what the remarks field should do.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes a Handover Details field available so the employee can enter handover details. Fail: it adds no handover field, or adds only a remarks field.
- **R2.** Pass: the answer makes the handover details field mandatory (the title says it must be entered mandatorily), and entered data is still saved when the field is filled. Fail: the field stays optional, or a filled field blocks saving.

## Diagnostic (D), reported only
- **D1.** States the form the field belongs to and the step where the mandatory check applies. The story does not say, so the answer may choose and must state the choice.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
