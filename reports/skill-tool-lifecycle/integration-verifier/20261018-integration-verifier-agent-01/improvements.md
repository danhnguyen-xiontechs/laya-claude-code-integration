# Improvements — integration-verifier (retro run 20261018-integration-verifier-agent-01)

**Diagnosis.** On 6 two-story batches with 2 repetitions, Haiku 5.5 alone gets 10 of 12 runs right and Haiku with the verifier also gets 10 of 12 (identical answers in every run; c6 is wrong in all four), but arm B spends 28% more tokens (7.03M -> 8.99M; 114 -> 138 model turns, 141 -> 169 tool calls) and is dearer in 5 of 6 cases (cheaper only in c6). The agents ran `verify-batch.mjs` and then still checked the repo themselves (merge in a temp copy, rerun tests), so the report was an extra read, not a replacement. Jev was called twice (both in c5, label `code_regression`, 0.76 s and 1.2 s) and changed nothing, by design. The cases were also too easy: the prompt gave A the tool's own status rules, and 5 of 6 batches are the tool's own fixtures.

1. **Make the report a short verdict the agent can trust and stop on.**
   - **change**: `scripts/verify.mjs` `renderMarkdown`: print `BATCH: <status>` and one `<id>: <status> - <top reason>` line per story first, move the AC/check/cluster tables below a "details" line, and state "combined run re-executed by the verifier: exit 0".
   - **why**: B agents made 28 more tool calls than A; the 36-line report was read and then re-derived.
   - **expected effect**: B tokens from +28% towards parity; correctness unchanged.
   - **how to verify**: rerun the same 6 cases x 2 with the new report; paired tokens B <= A.
2. **Check that an AC-coverage row's test exists.**
   - **change**: `verifyStory` (verify.mjs:136-137): count a `covered` row as evidence only if its `test` path exists on the story branch (or in the merge); otherwise REVIEW_REQUIRED.
   - **why**: in c6 the matrix cites `tests/count.test.js`, which exists in no commit; the tool said PASS for S2, while all four agents (two of them holding the tool's report) answered REVIEW_REQUIRED. The tool's PASS is exactly the false PASS the report says it avoids.
   - **expected effect**: c6 passes in B, and the tool stops being wrong where the plain agent is right.
   - **how to verify**: two c6 variants, one with a real test file (PASS) and one with a missing file (REVIEW_REQUIRED).
3. **Harden the evidence paths (open Major review findings).**
   - **change**: `verify.mjs:119,129-134`: resolve `log_path` inside the batch folder only, count only required checks with non-empty logs, accept `human` sign-off only from a batch-level artifact.
   - **why**: review probes got PASS from a repo source file used as a "log" and from a made-up `human:me`.
   - **expected effect**: closes the false-PASS paths the 10 fixtures do not cover.
   - **how to verify**: add 3 forged-evidence fixtures to `tests/fixtures.test.mjs`; all must be non-PASS.
4. **Measure on harder batches.** Add 4+ story batches with several failures at once and a conflict a quick merge does not show (a config key changed in code and in a fixture), and a prompt that does not list the tool's status rules. Without that, plain Haiku matches the rules and the tool can only add cost.
5. **Keep Jev off until a case needs it.** Jev was called in 2 of 12 runs, changed no status (by design) and no agent used its label; `--jev` off would cost the same tokens and send nothing out.
