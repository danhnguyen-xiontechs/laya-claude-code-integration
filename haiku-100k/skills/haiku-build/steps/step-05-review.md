# Step 05: Review (parallel Sonnet reviewers, then triage)

Goal: an independent review of the diff by three Sonnet reviewers in parallel, one per lens, then a triage of every finding against the code. No Opus call in this stage.

The phase window `05-review` was opened at the end of step 04.

1. **Build the review pack** (in the main session). First refresh the context bundle (v3); sections whose inputs did not change since the plan are reused:

   ```bash
   node "<skill-dir>/scripts/context_bundle.mjs" <runDir> 05-review
   ```

   Paste `evidence/context-bundle.txt` under `BUNDLE:` (ACs with target and verify, code locations, the capped diff, test evidence and failure records). Then add:
   - `SPEC:` the full `spec.md`, all sections.
   - `ANSWERS:` every entry of `planAnswers` in `manifest.json`, as `question → answer (section)`. Leave it empty if there are none.
   - `DIFF:` `evidence/diff.patch` through `capDiff()` in `scripts/build_report.mjs`: 60 KB and 1500 lines, whole files only. List the omitted file names in `OMITTED:`.
   - `TESTS:` the test summary from the manifest, the ladder rungs used (`attempts`), and the full text of each failing test.
   - `CONTEXT:` capped at 10 KB in total, in this order, so the reviewers judge the change against code they can see rather than guessing:
     1. the full current body of each function or method a hunk changes (the diff shows only a few lines around the change);
     2. the full current text of each changed test file (the diff does not show unchanged tests);
     3. signatures or snippets the diff calls, chosen by you.
     Name anything left out for the cap under `OMITTED:`.
   Paste the pack into `prompts/review.md`. Reviewers never read files, so the pack must contain the diff text itself.
2. **Call the reviewers in parallel.** In one message, three Agent tool calls, each `model: "sonnet"` (`05-review` in `manifest.routing`), `run_in_background: false`, the filled prompt as the whole prompt with `LENS:` set to `blind-hunter`, `edge-case-hunter` and `verification-gap` respectively. Each returns one JSON array in the format of `prompts/review.md`. Never use `tasks/*.output` as evidence: whether the review arrived is decided by `evidence/review-raw.json`, then the transcript.
3. **Save and check, in the turn the answers arrive, before anything else.** Concatenate the three arrays into one JSON array, unchanged otherwise, and write it to a file (for example `evidence/review-handback.txt`). Then run:

   ```bash
   node "<skill-dir>/scripts/save_opus.mjs" review <runDir> <runDir>/evidence/review-handback.txt --attempt <n>
   ```

   The script name is historical (from v1); it saves any review hand-back. It keeps the raw text in `evidence/review-raw.json` and checks it: one JSON array (`checkReviewJson`), each item with `severity` (`Major` or `Minor`), `lens`, `finding`, `ref`, and 800 words or fewer in total (`checkOpusOutput`). It appends a save record to `opusCalls` with `step: "04-review"` (also a historical name: it is the review save record, not an Opus call) and the measured `words` and `sha256`; never write that entry by hand. On a pass it writes `evidence/review.json`, sets `review: { "status": "done", "findings": [...] }` with `resolution: "open"` on each finding, and sets `status` to `REVIEWED`. An empty array is a valid result.
4. **If the save fails**, record it (`node "<skill-dir>/scripts/failure.mjs" record <runDir> review <n> <file with the printed reason>`), then ask the user in one line: `[R] retry` or `[S] skip`, and say why.
   - `[R]`: call the reviewers again, once, and save with `save_opus.mjs review ... --attempt 2 --approved-by "<the user's words>"`. The script records `retryApprovedBy` and `retryAt`.
   - `[S]`: set `review: { "status": "skipped", "findings": [] }`, `status: "REVIEW_SKIPPED"` and `decision: "not_approved_report"`. The report will say the code was not independently reviewed. `evidence/review.json` is then missing, so the final status is `blocked` (step 07). Skip the triage and step 06; go to step 07.
5. **Triage each finding against the code.** Read the file itself, not only the diff (the diff does not show unchanged tests or callers).
   - The finding holds: it will be fixed in step 06.
   - The file shows the finding is wrong: set `resolution: "rejected"` and give the `file:line` you read in `reason`.
   - It cannot be fixed in this run (needs a user decision, or is outside the spec's boundaries): set `resolution: "open"` with the reason. Never "it is Minor".
6. **Severity advice (optional, point `triage`).** For a finding whose severity you doubt, run:

   ```bash
   node "<skill-dir>/scripts/jev_advice.mjs" <runDir> triage <current severity> Minor,Major --state "<finding, ref and the code you read>"
   ```

   Use the printed `choice` as the severity. The script keeps the current severity when JEV is off, errors, times out (3000 ms), answers below confidence 0.8, has used its 3 calls, or would lower it: triage advice can only keep or raise a severity. JEV never rejects a finding, passes an acceptance criterion or sets a status.
7. **Set the next step.** Findings to fix: `decision: "fix_and_report"`. No findings, or all rejected or open: `decision: "re_verify_only"`. The decision follows from the triage; the user is not asked. Save the triage in `manifest.json` `review.findings` (severity, resolution, reason).
8. **Show the triage** in one table (severity, lens, finding, triage) and one line of counts. Open the next window: `node "<skill-dir>/scripts/phase.mjs" <runDir> start 06-fix`. Go to step 06.
