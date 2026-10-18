# Improvements: skills-router, round 2 (20261018-skills-router-r2-agent-01)

**Diagnosis.** The round-1 fix worked. With the hint printed as one line before the listing, B cost +9.2% (1,514,780 -> 1,653,849 tokens; 24 -> 26 turns) instead of +72%. All of that gap comes from two runs, c1 B r2 (+70,286) and c6 B r2 (+69,800). The other 10 pairs differ by -411 to +116 tokens each, -1,017 in total (-0.08%), so the hint itself costs nothing measurable. In both outlier runs the extra call was a stray `mcp__ccd_session__hand_off_to_session` call with placeholder or empty arguments. The harness rejected it, and the agent then called `SubagentHandback`. The extra turn re-read the ~69k cached context. It is harness noise, not the hint: the agent did not read the listing again, did not open a hint file, and did not re-run the helper. The router was right in 12 of 12 runs (8 correct suggestions, 4 correct abstains), but arm A was also 12 of 12, so the hint changed no answer and the case set is still too easy to show any value. **Top suggestion: measure on a harder case set where plain Claude with the full listing gets some picks wrong, and give the pick subagents only Bash and SubagentHandback so stray harness calls cannot add ±70k tokens to a run.**

## Analysis

### 1. Where B's extra tokens went

| pair | A tokens | B tokens | diff | B turns / tool calls |
|---|---:|---:|---:|---|
| c1 r1 | 126,204 | 126,256 | +52 | 2 / 2 |
| c2 r1 | 126,306 | 126,278 | -28 | 2 / 2 |
| c3 r1 | 126,427 | 126,016 | -411 | 2 / 2 |
| c4 r1 | 126,224 | 126,263 | +39 | 2 / 2 |
| c5 r1 | 126,324 | 125,985 | -339 | 2 / 2 |
| c6 r1 | 126,050 | 126,058 | +8 | 2 / 2 |
| **c1 r2** | 126,186 | **196,472** | **+70,286** | **3 / 3** |
| c2 r2 | 125,992 | 126,108 | +116 | 2 / 2 |
| c3 r2 | 126,131 | 126,019 | -112 | 2 / 2 |
| c4 r2 | 126,322 | 126,322 | 0 | 2 / 2 |
| c5 r2 | 126,505 | 126,163 | -342 | 2 / 2 |
| **c6 r2** | 126,109 | **195,909** | **+69,800** | **3 / 3** |
| total | 1,514,780 | 1,653,849 | +139,069 | 26 / 26 |

- The two outliers add +140,086 tokens, which is more than the whole +139,069 gap. Without them, A has 1,262,485 tokens and B has 1,261,468 (-0.08%).
- **The third tool call** in both outlier transcripts was a call to `mcp__ccd_session__hand_off_to_session`, a desktop-harness tool that moves a session. It was not a Bash call, not a read of the listing or of a hint file, and not a second run of the helper.
  - c1 B r2 (`agent-a17f6fa14e476be15`): the call was `{"title":"placeholder","remaining_plan":"placeholder"}`. The auto-mode classifier denied it, and the agent then called `SubagentHandback` with the correct pick.
  - c6 B r2 (`agent-a627380ffc160f267`): the call was `{}`, which failed input validation, and the agent then called `SubagentHandback` with the correct pick.
- **Cost mechanism:** cache reads were 168,433 and 168,415, against about 99,050 in the other rep-2 runs, so each extra turn re-read the ~69.4k context once. Cache writes were almost unchanged (28,021 / 27,472 vs ~27,100).
- **Likely cause:** Haiku confused `SubagentHandback` with the similarly named `hand_off_to_session`. The tool was available in arm A too: its name appears in the A transcripts, which made 0 such calls. The split is 2 of 12 runs in B and 0 of 12 in A, which is not significant with 12 runs per arm.
- **Why the hint is an unlikely cause:** in c6 the hint was the 41-character line `suggest: none | abstain: empty | via: jev`, which has nothing that points toward a session hand-off.
- **Hint size:** the line is 41-183 characters (about 10-45 tokens). B's text is 29,724-29,866 characters, against 29,751 for the A listing (the evidence file sizes). That is well under the 30,000-character Bash cap, so no B output was cut or saved to a file. In round 1, every B output was cut.

### 2. Worse cases
None. Both arms passed 12 of 12, B made 0 picks worse than A, arm A made 0 forbidden calls, and no transcript in either arm referred to the answer key.

### 3. What the engine decided
- **c1 web-test:** Jev picked `web-test` and BM25 agreed (conf high).
- **c3 review-pr-laya-classify:** Jev picked `review-pr-laya-classify` and BM25 agreed (conf high).
- **c2 web-test-jev-wait:** Jev picked `web-test-jev-wait`. BM25's top was `web-test-jev-verdict` (wrong), so the line showed conf low. Jev was right.
- **c4 code-review:** Jev picked `code-review`. BM25's top was `integration-verifier` (wrong), so the line showed conf low. Jev was right.
- **c5 none:** abstain `none-first` (conf medium in r1, low in r2). Correct.
- **c6 none:** abstain `empty`, because the BM25 shortlist was empty. Correct. **Jev was not called** (route.mjs:457 skips the provider when the shortlist is empty), but the line still says `via: jev`, because `formatLine` takes `via` from `out.mode`, which stays `provider` (route.mjs:447, 526). One B answer then wrote that "the Jev decision also return[ed] none". The summary's `providerCalls: 12` counts route.mjs runs (collect.mjs:73); the actual number of Jev calls was 10. The summary's `providerLatencyMs: 1265` is not a total: the per-call latencies in the logs add up to 14,608 ms (about 1.2-1.7 s per Jev call, about 0.2-0.35 s on the empty path).
- **Did the hint change an answer?** No. A and B made the same pick in all 6 cases in both repetitions. 7 of the 12 B answers mention the hint, but only as agreement with a pick the listing already supported. Jev's override of BM25 on c2 and c4 was right, so the engine adds value over BM25 alone, but not over Haiku with the full listing.

### 4. Could the cases show value?
No. As round 1 found, arm A gets 12 of 12 with the full 48-entry listing (about 30 KB), so B has no room to be better. The two overlap cases (c2, c3) name the variant in the request ("use Jev for waiting", "Laya severity"), and Haiku resolves them from the descriptions. Round 1's suggestion 3 (a harder case set) is still open and is now the main blocker. Cost is no longer the question; value is.

### 5. Open review findings (agent-review.json)
None of the open findings affected this run.
- **SKILL.md:40** ("the hint comes first, before anything else you read"): a documentation sentence about the harness. The measurement used b.mjs, not SKILL.md, so it had no effect here. It should still be removed before adoption.
- **route.test.mjs provider-mode coverage:** tests for the provider path through `route()` with a fake provider (abstain gate, provider failure, `via`) are missing. The `via: jev` on an empty shortlist found above is exactly the kind of bug those tests would catch, so this finding is now more than a gap in coverage.
- **Round-1 helper parse:** round 1 cannot be re-run against ada217d without pinning `--format json`. This had no effect on round 2, which uses `--json`.
- **Overlap ids not cleaned:** no live path. The one `overlaps: all` line (c2) was well formed.
- **Bad `--format` error text:** cosmetic, no effect.

## Suggestions (ranked by expected effect)

1. **Measure on cases plain Claude gets wrong.**
   - **Change:** this experiment's `cases.json` (via `make_tasks.mjs`).
     - Replace or extend the six cases with requests where arm A misses. Candidates: vague or typo requests, and overlap requests that do not name the variant (a `-jev-` / `-laya-` family without the word "Jev" or "Laya").
     - Add held-out prompts that no test or eval scenario quotes.
     - Add the skills the eval does not cover: `codebase-task-explorer`, `story-batch-planner`, `integration-verifier`.
     - Run arm A alone first, and keep only the cases where A scores below 100%.
   - **Why:** with A at 12/12, the run can only show cost, never gain. The engine was right in 12/12 and beat BM25 in 2 cases, so a harder set could show a real difference.
   - **Expected effect:** B's pass rate becomes measurable against A. Tokens should stay about equal, because the hint is about 10-45 tokens.
   - **How to verify:** a pre-run of arm A on the new set scores below 100%. Then run A/B with 3 repetitions and compare passes per pair.

2. **Remove the stray harness-tool noise from the pick runs.**
   - **Change:** the harness that spawns the pick subagents (the task template in `make_tasks.mjs` / `helpers/pick.mjs.tpl`).
     - Give the subagent only Bash and SubagentHandback, or spawn it without the `ccd_session` MCP server.
     - In `collect.mjs`, count any tool call other than the helper call and the handback as `strayCalls`, and report paired tokens both with and without the stray runs.
     - Use 3 repetitions instead of 2.
   - **Why:** one stray `hand_off_to_session` call costs about 70k tokens (a full re-read of the context). Two such calls turned a -0.08% result into +9.2%.
   - **Expected effect:** B's tokens fall to within about 1% of A's on the current cases, and the confidence of the result rises from LOW.
   - **How to verify:** re-run the same 6 cases × 3 repetitions. Expect `strayCalls` to be 0 in both arms and turns to be 2 per run in both arms (24/24 for 12 runs).

3. **Make `via` honest when the provider was not called, and count real provider calls.**
   - **Change:**
     - `scripts/route.mjs` `route()`: set `out.mode = 'bm25-only'` (or add `providerCalled: false`) when `short.length === 0`, so that `formatLine` prints `via: bm25-only`.
     - `collect.mjs:73-75`: count `providerCalls` only for logs with `mode === 'provider'` and a non-null `agreement`, and report latency as the sum and the median separately.
     - Add a `route()` test with a fake provider and an empty shortlist (this also covers the open test-coverage finding).
   - **Why:** in c6, the agent repeated "Jev returned none" when Jev was never asked, and the summary claims 12 provider calls when Jev was called 10 times.
   - **Expected effect:** 0 tokens and 0 pass rate. The hint and the report become accurate.
   - **How to verify:** `node scripts/route.mjs --provider jev --query "viết vòng for in số chẵn"` prints `... | via: bm25-only`. The new test passes, and re-collecting this run gives `providerCalls: 10`.

4. **Close the remaining open review findings before adoption.**
   - **Change:**
     - Remove the harness sentence at `SKILL.md:40`.
     - Wrap the overlap ids in `clean()` in `formatLine` (route.mjs:533).
     - Add a note to the round-1 folder that its helper needs the pre-ada217d tool or `--format json`.
     - Optionally, make the bad `--format` error match the spec.
   - **Why:** none of these affected the result, but SKILL.md:40 tells Claude something false about the CLI, and the rest are small hygiene fixes.
   - **Expected effect:** 0 tokens and 0 pass rate on this set.
   - **How to verify:** `tests/route.test.mjs` passes. `grep "comes first" SKILL.md` finds nothing.

5. **Gate the router call to uncertain requests (round-1 suggestion 2), but only if suggestion 1 shows a gain.**
   - **Change:** `SKILL.md` step 2. Skip the route call when the request names a skill (`/name`) or only one listed entry fits. Run it for families that share a name base and for vague requests.
   - **Why:** the line now costs about 10-45 tokens, so the saving is mainly Jev latency (about 1.3 s per call) and Jev cost, not context tokens.
   - **Expected effect:** about 0 tokens. It saves roughly half of the Jev calls on a mixed set, with no change in pass rate.
   - **How to verify:** on the suggestion-1 set, compare Jev calls and passes with the gate on and off.

No "drop the tool" or "keep rules only": the tool now costs about 0% when the harness noise is taken out, and the engine was right in 12/12 runs. What is missing is evidence of value, and suggestion 1 is the way to get it.
