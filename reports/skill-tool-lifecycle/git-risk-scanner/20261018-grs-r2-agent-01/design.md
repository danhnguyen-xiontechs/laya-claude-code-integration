# Design: git-risk-scanner round 2 (not measured)

**Status: built and tested; cases generated; not measured.**

## Tool change (diff/)
- DEFAULTS guidanceVersion 2 (1 = round-1 text, byte for byte, kept as _guidance_v1).
- v2 text: step 1 finds the commit that added a check (git log -S with a quote-free fragment), step 2 reads the last 5 fixes, step 3 finds callers, step 4 runs the covering tests before and after each edit and adds a characterization test only for changed behaviour, step 5 keeps the diff small and reports the kept checks.
- SKILL.md section 2 updated; guidanceVersion 1 restores the old text.
- 21 unit tests pass (17 existing plus 4 guidance tests).

## Cases (4 generated repos; not committed)
- Each case: a target module of 141-150 lines, 36-55 commits on the target, with a trap guard whose reason lives only in a commit message, a few decoys (unused import, constant and helper), and visible tests that do not cover the traps.
- Scoring: visible tests green and unchanged; hidden tests green (the trap tests and the sanity tests); at least 2 of 3 decoys removed.
- The answer key (hidden tests, trap commits, decoys, mutation check, formula band) is not in this folder.

## Build self-checks (all pass)
- Subject labels agree with is_fix; no fix subject carries a cosmetic word.
- Each trap's hidden test fails when its trap is removed; visible tests pass without the traps; the INC- id appears only in commit messages.
- The formula band of each case is fixed in the key.

## Deviations
- No real long-history file fits: the JEV repo has 5 commits on any file, and Laya's files have at most 5. All four cases are generated.
- grs-11 and grs-12 modules are 141 lines, not 170-180: at that size the fixed commit, fix and author counts do not fit under the 45 KB history cap.
- grs-14: HEAD is 63 days after the last target commit, so the dormant part of the formula adds 0.33.
- Each repo has 2 extra commits on collaborator files only.
- grs-13: the bucket test fails without the guard only on a non-UTC machine; the late_rows test fails everywhere.
- The step 1 quoting fix changed the v2 text from the decision spec, after review.
- Open review items are listed in agent-review.json.
