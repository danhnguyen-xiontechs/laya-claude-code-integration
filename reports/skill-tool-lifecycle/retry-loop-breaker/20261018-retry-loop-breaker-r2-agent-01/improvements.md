# Improvements: retry-loop-breaker (from run 20261018-retry-loop-breaker-r2-agent-01)

**Diagnosis.** Both arms passed 12/12 and no case got worse, but the guard itself did almost nothing. It refused once in 12 B runs (index-warmup B r2, the 4th identical `npm test`), Jev was never called, and total tokens went up from A 5,709,312 to B 5,869,384 (+2.8%). Most of the increase came from codegen-wait (+44%: the B agents ran `vendor/codegen.mjs` directly for 120 s while the guard answered `pass` every time) and from index-warmup B r2 (+371k: 2 extra turns lost to shell quoting, then 2 inspection turns after the refusal where A had run once more).

The B savings that do show up came before the guard had shown anything. In B, 3 of the 4 runs on the two looping cases stopped after 1-2 runs (devserver-ready r1 and r2, index-warmup r1). In A, all 6 runs (pilot 2 included) did 4-5 identical runs after reading the same files. index-warmup B r1 wrote that it skipped reruns because "the retry guard would just count identical failures". B also used 11.5% fewer tokens on the three legitimate cases, where the guard never acted. So the evidence points to the arm-B prompt sentence (an announcement effect), not to the refusals. With 2 reps this is suggestive, not proven (one-sided Fisher p ≈ 0.03 on early stops, 3/4 vs 0/6).

Even a perfect guard had little to save here. At threshold 3 only runs 4-5 can be refused, and arm A often ran those inside one Bash `for` loop (index-warmup A r1 and devserver-ready A r1: 4-5 runs in 2 Bash calls). That caps the saving at about one turn, roughly 70k tokens.

## Suggestions, ranked by expected effect

1. **Measure the refusals apart from the announcement.**
   - *Change:* measurement design: `make_tasks.mjs` arm sentences and `wrapper/f1.mjs`. Both arms get the B sentence ("A retry guard (retry-loop-breaker) is attached to run.mjs; ..."), and arm A runs behind a silent placebo filter that never refuses. Use cases where plain Claude loops over several separate turns, not inside one `for` loop.
   - *Why:* the sentence was the only thing the early-stopping B agents saw that A did not. It explains the devserver-ready (-65k, -153k) and index-warmup r1 (-81k) savings and the -11.5% on cases where the guard never acted. The guard's one refusal saved no tokens.
   - *Expected effect:* turns "the B arm is cheaper" into a number that belongs to the guard, which may be about 0 on these cases.
   - *How to verify:* run index-warmup and devserver-ready with 3 reps per arm. Compare placebo-A and B on early-stop rate, turns after the 3rd identical failure, and tokens. Gate the pilot on placebo-A showing at least 3 Bash turns after the 3rd identical failure.
2. **Guard the command shapes agents actually use.**
   - *Change:* `retry-loop-breaker/hooks/core.ts` `classify()` / `COMPOUND`. Before matching `RUNNERS`, strip a leading `cd <dir> &&`, a trailing `; echo ...` or `echo EXIT=$?`, and `2>&1 | tail|head -n N`. Keep other compound commands ineligible.
   - *Why:* 54 of the 55 agent Bash calls that ran the test or build were wrapped (`cd "<dir>" && node run.mjs npm test; echo "EXIT=$?"`, or a `for` loop). `classify('cd "/x" && npm test')`, `npm test; echo EXIT=$?` and `npm test 2>&1 | tail -20` all return `null`. The wrapper hid this because it passed the inner command. Under the real hook, almost none of these calls would be guarded.
   - *Expected effect:* the real hook can act at all in practice. Without this, a real-hook re-measure shows 0 decisions.
   - *How to verify:* add unit tests for the three shapes (eligible) and for `npm test && rm -rf x` (still ineligible). Replay this run's transcripts through `classify()` and count eligible calls (now about 1 of 55).
3. **If suggestion 1 confirms the announcement effect, make the tool announce itself.**
   - *Change:* `retry-loop-breaker/hooks/register.ts`. On the first failed eligible run in a session, add one line of context: "retry-loop-breaker: identical reruns without a change are refused after 3; if the cause is outside the workspace, report it".
   - *Why:* in real use no prompt mentions the guard, so the only effect seen here (early stops) would disappear.
   - *Expected effect:* reproduces the -65k to -153k per looping run seen on devserver-ready and index-warmup r1, at about 40 tokens per session.
   - *How to verify:* a B-notice arm (no prompt sentence) against placebo-A on the looping cases. flaky-once, flaky-twice and build-flag must still pass with 0 refusals.
4. **Make a refusal end the loop, not start a new search.**
   - *Change:* `core.ts` `denialText()`. Add "or, if the cause is outside what you can change, stop and report it" next to "Inspect the failure, change the implementation, or run a different diagnostic".
   - *Why:* after the one refusal (index-warmup B r2), the agent spent 2 more turns reading `.logs/indexer.log` and `.cache/shards.json`, about 148k tokens, before handing back. A stopped after its 4th run.
   - *Expected effect:* 1-2 fewer turns per refusal on impossible cases (about 70-150k tokens).
   - *How to verify:* add a unit test on the new wording, then count the turns after the refusal in index-warmup B across 3 reps.
5. **Drop the engine call and keep rules only.**
   - *Change:* `DEFAULTS.jevEnabled: false` in `core.ts`.
   - *Why:* the near-duplicate path needs 3 identical failures and then a variant command. It never happened: 0 Jev calls in 24 B runs here and 0 in 24 in round 1. Jev adds up to a 4 s wait and sends the command and error text to OpenRouter.
   - *Expected effect:* no change on any measured case; less latency and less data sent out.
   - *How to verify:* unit tests 7 and 10 still pass with Jev off. Re-enable Jev only after a case shows a near-duplicate loop that the rules miss.

Top suggestion: re-measure with the guard sentence in both arms (arm A behind a silent placebo wrapper), on cases where plain Claude loops over several separate turns, so the guard's refusals are measured apart from the announcement.
