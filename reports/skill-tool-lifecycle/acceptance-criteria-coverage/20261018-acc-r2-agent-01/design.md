# Design: acceptance-criteria-coverage round 2 (not measured)

**Status: built, not frozen, not measured.**

## Tool change (diff/tool-change.diff)
- `digest --pack P [--results R] [--max-asserts 4] [--show-skippable] [-o out]`: per criterion, the candidate tests with their assertion lines (first 4, each cut to 160 characters), helper calls, and the Jev label. Skippable pairs are hidden unless --show-skippable. The digest never prints a coverage word.
- `candidates --top` keeps the default of 5.
- SKILL.md step 6 points at the digest.
- 19 unit tests pass (10 existing plus 9 digest tests).

## Cases (4 stories, generated; not committed)
- Each story: 9-11 criteria, 81-89 test items in 15-18 files, a package of 457-473 lines, tests of 1,109-1,118 lines.
- Traps built into the suites: name-only tests, parametrised tests that skip the decisive row, helper-based asserts (full and partial), split coverage across files, vocabulary mismatch, a snapshot test that cannot run, and criteria with no test.
- Totals: 40 criteria. The answer key holds the gold verdict and accepted set per criterion; it is not in this folder.
- The generator is deterministic and writes the cases and the key to a scratch folder outside the repo, so the agents never see the key.

## Freeze status
- The independent fixture review (Opus) read every criterion against its tests. It found 6 criteria where a careful reader could defend a verdict outside the accepted set (acc-11: 1, acc-12: 1, acc-13: 2, acc-14: 2). Those are not fixed yet; they need your review before the freeze.
- Offline recall@5 of the decisive tests is not run yet; it runs after the freeze.

## Measurement plan (not run)
- Arms: A plain Claude (tool disabled); B Claude + the digest flow (candidates, classify with Jev, digest).
- Two repetitions, Haiku 5.5 with effort xhigh, at most 6 case agents in flight, A and B of a case in the same message.
- Scoring by script against the key; forbid check on arm A (subagent_usage.mjs --forbid).
- Pass rule: every criterion's verdict is in its accepted set.
