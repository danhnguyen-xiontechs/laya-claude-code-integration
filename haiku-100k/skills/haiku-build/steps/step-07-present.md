# Step 07: Present (main session)

Goal: compute the final status from the run folder, build the report from measured data, and present it.

1. **Final status.** Run `node "<skill-dir>/scripts/status.mjs" <runDir> final`. It writes `finalStatus` and `finalReason` to `manifest.json`:
   - `blocked`: a required artifact is missing (the reason names it: `manifest.json`, `spec.md`, `evidence/diff.patch`, `evidence/unit-tests.log`, `evidence/review.json`), or the tests still fail, or the retry ladder is used up (the reason names the ladder).
   - `done_with_findings`: tests pass and at least one finding is `open`.
   - `done`: tests pass and no finding is open.

   Never type or change `finalStatus` yourself. JEV advice is not an input to it.
2. **Close the phases:** `node "<skill-dir>/scripts/phase.mjs" <runDir> end`.
3. **Build the report:**

   ```bash
   node "<skill-dir>/scripts/build_report.mjs" <runDir>
   ```

   The script measures the run from the transcript, fills the Haiku limit fields and writes `report.html`, with a **Decisions** section for each `planAnswers` entry. Read its one summary line only.
4. **Final message to the user**, in five lines at most:
   - final status and its reason;
   - unit tests passed/failed, and the last ladder rung used;
   - findings: fixed / rejected / open counts;
   - Haiku limit: `pass`, `fail`, or `not_measured` (`not_measured` means the transcript was not found);
   - a link to `report.html`.

Nothing is committed or pushed. If the user wants a commit, they ask for it.

## v3 additions

- The report shows `manifest.diagnostics` (every failed test run and hand-back, with its category and attempt) and `manifest.trace` (each AC mapped or unmapped, with its target and verification).
- `evidence/context-bundle.json` is evidence of what the reviewers were shown; it is listed with the other evidence files and is not hand-edited.
