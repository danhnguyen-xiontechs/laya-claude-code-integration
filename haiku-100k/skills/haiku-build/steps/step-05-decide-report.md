# Step 05: Decide & Report (Haiku)

Goal: the user decides what happens to the findings, then the report is built from measured data.

1. **Ask the user one question**, with the test status and the findings count:
   - `[1] Fix and report`: Haiku fixes the findings, then reports.
   - `[2] Not approved, report`: no code change, then reports.

   If there are no findings, ask the same question. Option `[1]` then means **re-verify only**: re-run the unit tests and check each acceptance criterion in section 6 of `spec.md`. No fixer call and no invented fixes.

   If the plan or review was skipped (`PLAN_FAILED` or `REVIEW_SKIPPED`), skip the question and go to step 6 with `decision: "not_approved_report"`.

2. **Option `[1]` with findings:**
   - Fix every finding in one pass, **Minor as well as Major**. Severity sets the order, not the scope: never skip a finding because it is Minor. Keep edits inside the spec's files where possible, and keep to the answers in `planAnswers`.
   - Check each finding against the code before fixing it: read the file itself, not only the diff (the diff does not show unchanged tests or callers). If the file shows the finding is wrong, do not change anything for it: mark it `rejected`, and give the `file:line` you read in `reason`.
   - Re-run the unit tests and update `manifest.tests`.
   - For each finding set `resolution` to exactly one of these, with the explanation in a separate `reason` field:
     - `fixed`: the change or test that resolves it.
     - `rejected`: the finding does not hold. Say what the code read showed, with `file:line`.
     - `open`: it could not be fixed in this pass. Say why. Only for a real blocker (it needs a user decision, or it is outside the spec's boundaries), never "it is Minor".
   - Set `decision: "fix_and_report"`.
   - Save the new diff to `evidence/diff.patch` (same rule as step 03).

3. **Option `[2]`:** make no code change. Each finding stays `open` (`reason`: "not approved"). Set `decision: "not_approved_report"`.

4. **Re-verify only** (no findings, option `[1]`): run the unit tests, check each acceptance criterion from section 6 with a command or a test, and record the result. Set `decision: "re_verify_only"`.

5. **Close the phases.** Open `05-decide-report` with `node "<skill-dir>/scripts/phase.mjs" <runDir> start 05-decide-report` before asking the question in item 1, and run `node "<skill-dir>/scripts/phase.mjs" <runDir> end` after the fix (or the decision) and before building the report. Save the decision and status in `manifest.json`.

6. **Build the report:**

   ```bash
   node "<skill-dir>/scripts/build_report.mjs" reports/haiku-build/<runId>
   ```

   The script measures the run from the transcript, fills the Haiku limit fields, and writes `report.html`. The report has a **Decisions** section listing each `planAnswers` entry (question, answer, section it changed), so the reader sees why the change went this way. Read the script's one summary line only.

7. **Final message to the user**, in four lines at most:
   - status and decision;
   - unit tests passed/failed;
   - Haiku limit: `pass`, `fail`, or `not_measured` (say which, and that `not_measured` means the transcript was not found);
   - a link to `report.html`.

Nothing is committed or pushed. If the user wants a commit, they ask for it.
