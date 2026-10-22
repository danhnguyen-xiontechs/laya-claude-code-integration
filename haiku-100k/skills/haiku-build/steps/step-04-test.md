# Step 04: Test (Haiku, retry ladder)

Goal: get the unit tests green within the fixed retry ladder, and record every run.

1. **Model.** This stage runs on Haiku (`04-test` in `manifest.routing`): in the main session when it is Haiku, otherwise through `haiku-100k:haiku-case` with `model: "haiku"`.
2. **Run the unit test command** from section 8 of `spec.md`, offline. Write the full output to `evidence/unit-tests.log` and print only the summary line.
3. **Retry ladder.** Before each run, `node "<skill-dir>/scripts/status.mjs" <runDir> next` names the rung and its model; after each run, record it with `node "<skill-dir>/scripts/status.mjs" <runDir> record pass|fail`. The ladder is fixed:
   - `T1` Haiku, `T2` Haiku (Haiku fixes the code between runs), one `sonnet-retry` (the one Sonnet fallback of step 03: Agent tool, `model: "sonnet"`, given the spec, the failing test output and the diff), then `T3` Haiku as the final verification run.
   - A pass ends the ladder. When `next` prints `refused` (exit 1), stop retrying: the run is `blocked` and the reason names the ladder. Go on to step 05 so the failure is still reviewed.
   - **Recovery advice (optional, point `recovery`).** Before the Sonnet retry you may run `node "<skill-dir>/scripts/jev_advice.mjs" <runDir> recovery <baseline> fix-code,fix-test,rewrite --state "<failing test summary>"`, where `<baseline>` is the approach you would take without advice. JEV only advises the approach; it never skips a rung, adds one or marks the tests passed. Off, an error, a timeout over 3000 ms, confidence below 0.8 or the 3-call limit all keep the baseline.
4. **Save the diff** again if the ladder changed code (same rule as step 03) to `evidence/diff.patch`.
5. **Record** in `manifest.json`: `tests: { "command", "passed", "failed" }` and `status`: `TESTS_PASS`, `TESTS_FAIL`, or `BUILT` if no tests exist. Then open the next window: `node "<skill-dir>/scripts/phase.mjs" <runDir> start 05-review`.

Nothing is committed or pushed. Go to step 05.
