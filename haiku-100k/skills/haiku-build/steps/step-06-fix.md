# Step 06: Fix (Haiku, at most one Sonnet re-review)

Goal: fix the findings triaged for fixing, verify the whole change once more, and have the fixes re-reviewed at most once.

The phase window `06-fix` was opened at the end of step 05.

1. **Model.** Haiku (`06-fix` in `manifest.routing`): in the main session when it is Haiku, otherwise through `haiku-100k:haiku-case`.
2. **`decision: "fix_and_report"`:** fix every finding still to fix in one pass, **Minor as well as Major**. Severity sets the order, not the scope. Keep edits inside the spec's files and keep to `planAnswers`. Set `resolution: "fixed"` with the change or test in `reason`. A finding that turns out unfixable stays `open` with the reason.
3. **`decision: "re_verify_only"`:** no code change. Check each acceptance criterion in section 6 of `spec.md` with a command or a test and record the result.
4. **Verify.** Re-run the unit test command from section 8, write the output to `evidence/unit-tests.log` and update `manifest.tests`. If the ladder from step 04 still has a rung (`status.mjs <runDir> next`), record the run with `status.mjs <runDir> record pass|fail` (a failure is recorded in `manifest.failures`); otherwise record a failing run with `failure.mjs record <runDir> test fix-1 <runDir>/evidence/unit-tests.log --stage 06-fix`. If the tests fail, Haiku makes one more fix and re-runs once; tests that still fail leave the run `blocked` (step 07).
5. **Save the diff** to `evidence/diff.patch` (same rule as step 03).
6. **Sonnet re-review (at most one).** Only when this step fixed code (`fix_and_report`). Refresh the bundle first (`node "<skill-dir>/scripts/context_bundle.mjs" <runDir> 06-fix`: only the sections whose inputs changed, typically diff, code locations and evidence, are rebuilt) and paste it under `BUNDLE:`. One Agent tool call, `model: "sonnet"` (`fallback` of `06-fix` in `manifest.routing`, `max: 1`), with `prompts/review.md` filled with the new diff, `LENS: blind-hunter` and, under `CONTEXT:`, the findings marked `fixed`. It returns the same JSON array format. Write the text unchanged to `evidence/re-review.json`, and add each item to `manifest.review.findings` with `resolution: "open"`. No second re-review and no further fix round: anything it finds stays `open` for the report.
7. **Open the next window:** `node "<skill-dir>/scripts/phase.mjs" <runDir> start 07-present`. Go to step 07.

Nothing is committed or pushed.
