# Step 04: Review (Opus, one closed call, three lenses)

Goal: one independent review of the diff, returned as findings.

0. **Open the window:** `node "<skill-dir>/scripts/phase.mjs" <runDir> start 04-review` (it closes `03-build-test`).
1. **Build the review pack** (Haiku, in the main session):
   - `SPEC:` the full `spec.md`, all sections.
   - `ANSWERS:` every entry of `planAnswers` in `manifest.json`, as `question → answer (section)`. Leave it empty if there are none.
   - `DIFF:` `evidence/diff.patch` through `capDiff()` in `scripts/build_report.mjs`: 60 KB and 1500 lines, whole files only. List the omitted file names in `OMITTED:`.
   - `TESTS:` the test summary from the manifest, and the full text of each failing test.
   - `CONTEXT:` capped at 10 KB in total, in this order, so Opus judges the change against code it can see rather than guessing:
     1. the full current body of each function or method a hunk changes (the diff shows only a few lines around the change);
     2. the full current text of each changed test file (the diff does not show unchanged tests);
     3. signatures or snippets the diff calls, chosen by you.
     Name anything left out for the cap under `OMITTED:`.
   Paste the pack into `prompts/review-opus.md`. Opus never reads files, so the pack must contain the diff text itself.
2. **Call Opus.** Agent tool, `model: "opus"`, `effort: "medium"`, `run_in_background: false` (foreground, as in step 02), the filled prompt as the whole prompt. As in step 02, never use `tasks/*.output` as evidence: whether the review arrived is decided by `evidence/review-raw.json`, `opusCalls`, and then the transcript.
3. **Save and check, in the turn it arrives, before anything else.** Write the returned text unchanged to a file (for example `evidence/review-handback.txt`), then run:

   ```bash
   node "<skill-dir>/scripts/save_opus.mjs" review <runDir> <runDir>/evidence/review-handback.txt --attempt <n>
   ```

   It keeps the raw text in `evidence/review-raw.json` and checks it: one JSON array (`checkReviewJson`), each item with `severity` (`Major` or `Minor`), `lens`, `finding`, `ref`, and 800 words or fewer (`checkOpusOutput`). It appends the `opusCalls` entry with the measured `words` and `sha256`; never write that entry by hand. On a pass it writes `evidence/review.json`, sets `review: { "status": "done", "findings": [...] }` with `resolution: "open"` on each finding, and sets `status` to `REVIEWED`. An empty array is a valid result.
4. **If it fails**, ask the user in one line: `[R] retry` or `[S] skip`, and say why.
   - `[R]`: call Opus again, once, and save with `save_opus.mjs review ... --attempt 2 --approved-by "<the user's words>"`. The script records `retryApprovedBy` and `retryAt`.
   - `[S]`: set `review: { "status": "skipped", "findings": [] }` and `status: "REVIEW_SKIPPED"`. The report will say the code was not independently reviewed.
5. **Show the findings** to the user in a table: severity, lens, finding, ref. Keep it to the table and one line of counts.

Go to step 05.
