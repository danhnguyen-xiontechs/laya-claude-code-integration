# Design: jev_advisor round 2 (not measured)

**Status: built, cases generated, pre-freeze checks pass; not measured.**

## Tool change (diff/jevadv-change.diff)
- DEFAULT_ADVISOR: maxJevHints 3 -> 1; dropAnchorRepeats True; hintExcerptChars 200.
- advisor.hint_rows(): sorts by (-p, start); drops hints whose focus line repeats the local failure message (the message, the E line, or the exception-stripped text, with a 16-character floor); returns shown, flagged (non-repeat flags) and anchorRepeats.
- render.block(): status lines report flags not shown, and repeats.
- 91 unit tests pass (84 existing plus 7 new).
- The change is in a scratch git repo: baseline commit e0ef886 (the round-1 measured state) and the change commits. JEV is read-only for this session, so no branch was made in JEV.

## Cases (4 log-only scenarios, generated; not committed)
- l01_fetch: an environment value keyed by region, computed at run time.
- l02_checkout: a promo state that is not restored, and a fixed shuffled test order.
- l03_invoice: a rollout bucket that changes the rounding for one account.
- l04_export: a price-cache slot collision, with two failing tests and one cause.
- Each log is 330-400 KB (about 5,000-6,000 lines). The check confirms the cause is in no source, test, data or config file of the case folder.
- The generator is deterministic; the answer key and the check are kept outside the repo.

## Pre-freeze check (offline, no Jev)
- In all four cases the gold chunk was not among the 80 chunks sent to Jev (it ranks 265-413 of 420-490 chunks).
- This is the main risk: unless chunk selection changes, a Jev hint cannot reach the cause on these cases. The design says not to change the cases because of it; the measurement would therefore test selection, not Jev.

## Deviations
- The baseline cases h03 and h07 are dropped (their output does not change under the new rule); h01 and h05 are carried over and would be re-run.
- l04 has a second colliding SKU in the export test (SKU-1500 with SKU-1338), a design defect kept as built; the key records it.
- The flagged count excludes anchor repeats; the flag-off setting does not reproduce the old output byte for byte.
- The repo's own .jev-advisor.json still sets maxJevHints 3 (not changed here).
- The round-2 worktree on claude/jevadv-round2 was not created inside JEV (read-only); the change is in the scratch repo and carried as the diff.
