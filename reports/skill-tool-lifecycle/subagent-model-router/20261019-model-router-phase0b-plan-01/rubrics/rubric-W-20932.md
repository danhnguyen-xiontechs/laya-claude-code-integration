# Rubric W-20932

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (two R).

## Story summary
Bug from "Manager should be able to reject leave with relevant comments" (filed 9/21/2026). The test expects: the manager rejects with a comment (step 2); a success message and status Rejected/Declined (step 3); and on reopening, the manager's comment is saved, visible to the appropriate user, and included in the request history or a notification (step 4). The comment says the line manager's rejection remarks are not visible to staff in their ESS.
Not stated: the validation rule for the rejection comment (step 2 says "any mandatory validation" without naming it), and which exact screen staff use.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes the manager's rejection comment visible to the staff member in their ESS. Fail: it makes the comment visible only to the manager or HR, or does not address visibility.
- **R2.** Pass: the answer keeps the comment saved on rejection and shows it in the request history or in the rejection notification (step 4 accepts either). Fail: the comment is lost after reopening, or there is no history or notification route for it.

## Diagnostic (D), reported only
- **D1.** States what validation applies to the rejection comment (for example, required or length limit). The story does not name it, so the answer may choose and must state the choice.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 AND R2 pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
