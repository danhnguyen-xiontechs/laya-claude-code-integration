# Rubric W-19427

Locked before any output for this story exists. Date: 2026-10-19. Source: story text only (`calibration-stories-0B.json`).
Status: discriminative (one R).

## Story summary
Performance Management > Goal Review on WebESS should support attachments as supporting evidence (certificates, emails, other relevant evidence). The story says the detailed WebESS behaviour and approach will be confirmed separately.
Not stated: file types, size limits, who can view the files, or the exact screen. The answer may choose these and must state its choice.

## Required (R), decisive for overall
- **R1.** Pass: the answer adds a way for users to attach supporting documents inside the Goal Review process. Fail: it offers only a free-text field or a link with no attachment, or it puts the attachments somewhere other than Goal Review (for example, goal setting only).

## Diagnostic (D), reported only
- **D1.** Pass: the answer states at least one choice it made on the open points (file types, size, visibility), or says they are open. Fail: it presents an invented detail as given by the story.

## Severe errors (same for every story)
- **E1:** the reported problem is still present after the answer.
- **E2:** the answer breaks a valid case the story does not ask to change.
- **E3:** the answer claims it ran, tested or inspected code, or cites a file or line as verified. It has no repository access. Labelled guesses are not E3.
- **E4:** no change is proposed (only questions, or a refusal).

## Overall
Pass = R1 passes AND no E. Anything else fails.
Grading note: for each R verdict the grader quotes the answer text it relies on (exact match, LF-normalized).
