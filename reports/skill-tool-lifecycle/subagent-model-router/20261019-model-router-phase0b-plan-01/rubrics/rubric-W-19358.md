# Rubric W-19358

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (one R).

## Story summary
WebESS > Time and Attendance shows "Approved Leave" for 03/09/2026. The leave was submitted on 27/07/2026 and cancelled on 30/07/2026. The story says that after cancellation there is no effective approved leave for that date in F&O. Leave Request Detail shows several transactions for the same employee and leave date.
The story text is cut off mid-sentence at the status of the original transaction ("has Amount = 1 and St"). This rubric does not use the cut-off part.
Not stated: which transaction's status is wrong, and whether the fix is in the data or the display.

## Required (R), decisive for overall
- **R1.** Pass: the answer proposes a change so that WebESS does not show 03/09/2026 as Approved Leave once the leave was cancelled on 30/07/2026. The change may be in how the transactions are read or shown, or in the data; the answer may name either. Fail: it only says to check with HR or to resubmit the leave, or it changes labels without stopping the cancelled leave from showing as approved.

## Diagnostic (D), reported only
- **D1.** Pass: the answer says the story text is cut off, or labels its assumptions about the unseen status values. Fail: it assumes those values as fact.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 passes AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
