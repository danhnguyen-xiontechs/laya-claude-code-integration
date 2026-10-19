# Rubric: W-19279 (pilot, calibration split)

Locked before any model output for this story exists. Written from the story text only (`real/stories-text.json`, id W-19279). Any change after the first output is seen makes this a new version (`rubric v2`), and the pilot is then void.

## What the story asks

In the WebESS Overtime tab, employees with Overtime Eligible = Yes are shown even when they have no overtime records in the selected date range. Expected: only employees with overtime records inside the selected date range are shown.

The story does not say whether the date range is inclusive or exclusive at its ends. It also does not name a file, a function or a test. The answer does not have repository access.

## Criteria (each: pass or fail, with a quote)

- **C1 (required). Display rule.** The answer makes the Overtime tab show an employee only when that employee has at least one overtime record inside the selected date range.
  - Pass: the rule is implemented or stated on that basis.
  - Fail: the rule depends on Overtime Eligible alone, or on anything other than overtime records in the date range.
- **C2 (required). No valid row hidden.** An employee with an overtime record inside the range stays visible.
  - Pass: the rule keeps every such employee. Boundary handling is accepted either way if the answer states its choice.
  - Fail: the rule hides an employee whose record is clearly inside the range (for example, it filters by a different field or compares dates in a way that drops in-range records).
- **C3 (reported, not decisive). Scope.** The change is limited to the Overtime tab list. It does not change the Overtime Eligible value or other tabs.
- **C4 (reported, not decisive). Empty range.** If no employee has a record in the range, the tab shows an empty list.

## Severe errors (any one makes the answer fail, whatever the criteria say)

- **E1.** The answer still shows employees with no overtime record in the range (the reported bug remains).
- **E2.** The answer hides employees who have overtime records in the range (same as a C2 fail).
- **E3.** The answer says it ran, tested or inspected code, or cites a specific file or line as verified, though it has no access. Labelled guesses ("probably in X, not checked") are not E3.
- **E4.** The answer proposes no change: only questions, or a refusal.

## Overall

- **pass** = C1 pass AND C2 pass AND E1, E2, E3, E4 all absent.
- **fail** = anything else.
- C3 and C4 are recorded and reported. They do not decide the overall result in the pilot.

## Grading rules

- Judge only from the rubric and the task text. Do not give credit for intent the answer does not state.
- If the answer does not clearly meet a criterion, mark it fail and say why.
- The grader does not know which model wrote the answer.
