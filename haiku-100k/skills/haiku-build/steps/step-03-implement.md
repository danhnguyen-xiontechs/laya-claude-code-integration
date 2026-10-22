# Step 03: Implement (Haiku, one Sonnet fallback)

Goal: implement `spec.md` on Haiku, red tests first, and save the diff.

1. **Model.** This stage runs on Haiku (`03-implement` in `manifest.routing`). If the main session is Haiku, implement here. Otherwise brief `haiku-100k:haiku-case` with `model: "haiku"` and the spec path, and let it implement. The phase window `03-implement` was opened at the end of step 02.
2. **Read `spec.md` once**, then work in its task order (section 6). Read `planAnswers` from `manifest.json` with it. Where an answer conflicts with the spec, the answer wins. If an answer conflicts with a constraint in section 2, stop and record a blocker in section 9 instead of picking one.
3. **Scope.** Keep edits inside the files listed in section 6 and respect section 2. A needed change outside the list is recorded as a finding for the review (step 05), not made.
4. **Red first.** For each `red:` line in section 7, write the named test, run it once, and keep the failing output in `evidence/unit-tests.log`. A line `red: N/A — no behavior change: <reason>` needs no test.
5. **Implement** the tasks in order. Use Read, Edit and Write. Do not commit.
6. **One Sonnet fallback.** The stage has exactly one Sonnet fallback (`fallback` of `03-implement` in `manifest.routing`, `max: 1`). It is used as the `sonnet-retry` rung of the test ladder in step 04: Agent tool, `model: "sonnet"`, given the spec, the failing test output and the diff. It is never used a second time, and never in place of the Opus plan.
7. **Implementation Notes.** Write section 9 of `spec.md`: each deviation and why, each answer that changed a detail, each blocker. Nothing else.
8. **Save the diff.** Stage only explicit paths (new files get intent-to-add, `git add -N <paths>`), then write `git diff` to `evidence/diff.patch`. Use `git -q` and `-c core.safecrlf=false` on `git add`. Never stage a whole folder.
9. **Record** `status: "BUILT"` in `manifest.json`, then open the next window: `node "<skill-dir>/scripts/phase.mjs" <runDir> start 04-test`.

Nothing is committed or pushed. Go to step 04.
