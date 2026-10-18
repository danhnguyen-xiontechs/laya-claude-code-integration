# Final decision: build-skill-tool-workflow — Jev as the P3 shadow grader

- **Decision:** PILOT
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-bstw-engine-grader-01 (offline, no Claude agent run)
- **Based on:** 240 rows (120 saved answers with their script grades from 6 past rounds, 120 mismatched negatives):
  - **Jev:** 98.3% agreement on corrected labels (97.5% frozen), **0 false passes** (0/8 real fails, 0/116 mismatched), 4 false fails, all on story-batch-planner. p50 539 ms; the 240 calls cost $0.0054.
  - **Laya:** 58.8% agreement, 7/8 false passes. Rejected for this use.
- **Caveats:**
  - Only 8 real fails and one reasoning dataset.
  - On the exact-match datasets a string compare also scores 100%.
  - 4 mismatched labels were corrected after the run (deviation in `result.md`). On frozen labels Jev misses the mismatched-false-pass criterion: 2.5% against 2%.

## What PILOT means here
- One round, shadow only. `scripts/grade_with_engine.mjs --provider jev` grades free-text answers that have no grading script (`phases/phase-3-measure.md`).
- The case status stays Claude's or the script's grade.
- A Jev `fail` against a `pass` gets a human look.
- Not for order, constraint or numeric checks.

## Next
After that round, count agreement, false passes and human looks. Then decide ADOPT or REJECT in a new experiment id.
