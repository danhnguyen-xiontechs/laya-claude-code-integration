# Step 03: Build & Test (Haiku)

Goal: implement `spec.md` in the main session and run the unit tests.

1. **Read `spec.md` once**, then work in its task order (section 6). Read `planAnswers` from `manifest.json` with it. Answers are authoritative decisions: where an answer conflicts with the spec, the answer wins. If an answer conflicts with a constraint in section 2, stop and record a blocker in section 9 instead of picking one.
2. **Scope.** Keep edits inside the files listed in section 6 and respect section 2. If a needed change is outside the list, do not make it: record it as a finding for step 04. Do not widen the scope yourself.
3. **Red first.** For each `red:` line in section 7:
   - Write the named test or check.
   - Run it and keep the failing output (the `red` evidence) in `evidence/unit-tests.log`.
   - Then implement the change.

   A line `red: N/A — no behavior change: <reason>` needs no test. Do not invent one.
4. **Implement** the tasks in order. Use Read, Edit and Write. Do not commit.
5. **Run the unit test command** from section 8, offline. Write the full output to `evidence/unit-tests.log` and print only the summary line.
6. **Test failures.** Fix and re-run, up to 3 attempts in total. If tests still fail, stop trying: record `TESTS_FAIL` and go on to step 04 so the failure is reviewed.
7. **Implementation Notes.** Write section 9 of `spec.md`: each deviation from the spec and why, each answer that changed a detail, and each blocker. Write nothing else into the spec.
8. **Save the diff.** Stage only explicit paths (new files get intent-to-add, `git add -N <paths>`), then write `git diff` to `evidence/diff.patch`. Use `git -q` and `-c core.safecrlf=false` on `git add`. Never stage a whole folder.
9. **Record** in `manifest.json`:
   - `tests: { "command": "<cmd>", "passed": <n>, "failed": <n> }`;
   - `status`: `TESTS_PASS` or `TESTS_FAIL`, or `BUILT` if no tests exist;
   - `phases`: run `node "<skill-dir>/scripts/phase.mjs" <runDir> start 03-build-test` when the build starts (it closes `02-plan`).

Nothing is committed or pushed. Go to step 04.
