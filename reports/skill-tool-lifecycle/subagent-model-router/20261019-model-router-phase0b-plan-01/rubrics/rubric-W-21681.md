# Rubric W-21681

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (three R).

## Story summary
Bug from "PM-MYR-005 - Mid-Year Review - Cancel Goal / Edit Due to Business Change" (filed 9/24/2026). The test expects: a goal can be formally cancelled with supporting justification and review history keeps the update; if a goal is cancelled, its weighting is either reassigned or the employee can add another goal and submit it for line manager approval. The comment says the Cancel/Edit goal option, the cancellation justification and the displayed cancellation reason are all missing.
Not stated: the list of goal statuses, and how weighting is split when reassigned.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes it possible to set an active goal to Cancelled and enter a cancellation justification in Mid-Year Review. Fail: it offers only a display change or a free-text note, with no Cancel option.
- **R2.** Pass: after saving, the cancellation reason is displayed and kept in review history. Fail: the reason is not displayed, or the history is not kept.
- **R3.** Pass: the answer states how the cancelled goal's weighting is handled: reassigned to other goals, or a replacement goal added and submitted for line manager approval (the story allows either; the answer chooses one). Fail: it does not deal with the weighting.

## Diagnostic (D), reported only
- **D1.** Says which goal statuses it assumes, if it adds any beyond "Cancelled". Not required.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1, R2 and R3 all pass AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
