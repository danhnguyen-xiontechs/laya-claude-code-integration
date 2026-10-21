# Rubric W-20934

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (one R).

## Story summary
Bug from "Employee - Calendar - Verify correct highlighting of: Selected leave period Weekends" (filed 9/21/2026). The test expects weekends, approved leaves and public holidays to be shown in different colour codes for the selected period (step 2). The title says no different colour codes are seen.
Not stated: the exact colours, and whether the codes must be colours or may be another visual mark.

## Required (R), decisive for overall
- **R1.** Pass: the answer makes all three categories (weekends, approved leaves, public holidays) visually distinct from each other on the calendar for the selected period, by colour or by another visual code the answer names. Fail: it distinguishes only some of them, or it shows them distinctly only outside the calendar (for example, in a list).

## Diagnostic (D), reported only
- **D1.** States the colour or code chosen for each category. Not required.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 passes AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
