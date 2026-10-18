# improvements.md — 20261018-sbp-r2-agent-01 (step 7b review)

## Diagnosis

Both arms passed 6/6, but B still used 1,644k tokens to A's 654k (2.5x; baseline 20261017-sbp-agent-02 was 1,747k vs 656k). The idea-brief success criterion (B tokens <= A) failed. Per case, B went from 745k to 899k on h1 (+21%), from 647k to 282k on h2 (-56%, the endpoint fix worked) and from 355k to 463k on h3 (+30%). Each model turn re-reads about 53-97k of cached context. A always took 2 turns and 2 tool calls (~109k). B took 2-9 turns: 2 on h2.B.r1 (112k, the only run at parity), 3 on h2.B.r2, 4 on h1.B.r1, h3.B.r1 and h3.B.r2, and 9 turns with 13 calls on h1.B.r2 (671k). That one run is 561k of B's 990k excess. The other ~430k is process overhead, not wrong output. 5/6 B runs opened the `plan.mjs` wrapper before running it, 4/6 called `update_plan`, and most read `batch.json` in a separate call. h3.B.r2 trusted the planner completely, returned exactly its waves, and still cost 226k (4 turns). With these cases the tool cannot beat A on cost. At best it reaches parity, as h2.B.r1 did (112k vs 109k), because A's floor is already 2 turns.

**Where the rest went, by run:**
- **h1.B.r2 (671k):** read SKILL.md and the whole of `planner.mjs` (27.4k chars), wrote and ran a `check-waves.mjs` script, then answered.
- **h3.B.r1 (237k):** dumped the raw plan.json (15k chars) and then held R-5.
- **h1.B.r1 (228k):** one extra turn to re-pack the waves.

**Trust and overrides.** Round 2 fixed the incomplete-story and endpoint problems. The planner's own PLAN_JSON now passes all three cases, and on h2 and h3 it is identical to what A produced. Two overrides remain:
- **h1.B.r2: right.** `layer()` (planner.mjs:171-193) computes longest-path levels and then chunks each level by `maxConcurrency` = 4. Level 0 (P-1, P-3, P-5, P-10, P-11) splits 4+1 and level 1 (P-2, P-4, P-6, P-9, P-12) splits 4+1. That gives 4 waves: [P-1,P-3,P-5,P-10], [P-11], [P-2,P-4,P-6,P-9], [P-12]. Ten schedulable stories with a cap of 4 need only 3, which is what B.r2 returned. h1.B.r1 fixed it differently: it ignored the cap (two waves of 5), which it could do because the task prompt never states a cap and grade.mjs does not check one. A also returns 5-wide waves.
- **h3.B.r1: over-cautious and induced by the planner.** The "Needs a decision" list contains "[pair] R-1, R-5: incomplete description". R-1 ("Misc.") is already held, and the only overlap is the token "org". Holding R-5 because of it cost one story of parallelism and changed no gold invariant. h3.B.r2 read the same text and correctly ignored it.

**Jev.** It made the same 54 calls as the baseline (10/10/7 per case per rep), cost about $0.0013 in total, and changed 0 waves. 18 candidates got "call budget exhausted". About half of the calls on h1 and h2 went to pairs with an already-held story (P-8, Q-11, Q-1). The disagreements it made in this run were weak or wrong:
- Q-5/Q-6 shared_module 0.92: both only consume the endpoint.
- Q-5/Q-7 0.80.
- Q-1/Q-4 and Q-1/Q-7, 0.48-0.60.
- R-2/R-5 0.77-0.79.

Its one useful baseline signal (Q-4 to Q-5/Q-6) is now deterministic.

**Cases are too easy.** A passes 6/6 at a flat ~109k with 2 tool calls (read batch, hand back), so these 10-12-story batches cannot show any value from the tool.

**Open findings.**
- The two Minor items in agent-review.json are still open (incomplete plus cycle/external reporting).
- The "[blocked]" reason does not name its prerequisite ("depends on a story that is in a cycle, outside the batch or incomplete").
- Baseline suggestion #3 (shrink the summary) and #4 (drop Jev) were not applied. The summary is still 3.6-5k chars, including 10-11 identical "no repository metadata" lines.

## Suggestions (ranked by expected effect)

### 1. Pack waves greedily under the cap instead of chunking each level
- **Change:** in `scripts/planner.mjs` `layer()`, replace the per-level `slice(i, i + maxC)` with capped list scheduling. Each wave takes up to `maxC` stories whose prerequisites are all in earlier waves, ordered by (longest remaining path desc, input order). Also print the cap in the summary header ("max 4 per wave"), so that a split caused by the cap is not read as an arbitrary one.
- **Why:** this is the only remaining wrong-looking output. h1 gets 4 waves where 3 are enough, and that triggered both h1 overrides, including the 671k source-reading run (561k of the 990k excess). h1.B.r1 called the split "not forced by any edge", because nothing in the output says it comes from the cap.
- **Expected effect:** h1 gives 3 waves that match B.r2. h1.B runs no longer have a reason to re-pack, which should save roughly 120-560k per run. Pass rate unchanged.
- **How to verify:** offline.
  - Unit test: h1 gives 3 waves, every wave has at most `maxConcurrency` stories, and every depends_on and soft edge goes forward.
  - Property test on random DAGs: the greedy wave count is never higher than the level-chunk wave count.
  - Re-grade h1/h2/h3 PLAN_JSON with grade.mjs.

### 2. Stop reporting pairs and soft edges that involve stories already held
- **Change:** in `plan()` and `summary()`, drop the `[pair]` needs_decision items and the oriented unknown/soft edges where either side is in cycle, external, blocked or incomplete. Also skip those pairs as Jev candidates.
- **Why:** "[pair] R-1, R-5" is what made h3.B.r1 hold R-5 and dump the 15k-char plan.json (237k). The same kind of noise accounts for 5 of the 9 pair items on h2 (Q-11) and for the P-8 pairs on h1. An order such as "R-1 then R-5" means nothing while R-1 is not scheduled.
- **Expected effect:** h3 and h2 summaries carry no actionable-looking noise, h3.B.r1-style overrides go away (about -120k), and Jev's budget is no longer spent on dead pairs.
- **How to verify:** offline. Snapshot test: no needs_decision `pair` item and no summary edge line contains a held id. Grep h1/h2/h3 summaries for P-8/Q-11/R-1 outside the "Not scheduled" and "Needs a decision" story lines.

### 3. Cut the process overhead: a short summary and a "trust" contract
- **Change:**
  - In `summary()`, collapse the per-story "no repository metadata" lines into one line and drop `likely_independent` edges.
  - Make `blocked` name its prerequisite.
  - Under PLAN_JSON, add one line: "Waves already respect every edge listed and maxConcurrency N; override only if an edge contradicts the story text."
  - In SKILL.md, say that the agent does not need to read batch.json or the planner source to use the output.
- **Why:** h3.B.r2 trusted the planner and still took 4 turns (226k). About 430k of the excess is wrapper reads, separate batch reads and plan.json dumps, not wrong output. h2.B.r1, which ran the planner in its first call, cost 112k.
- **Expected effect:** summary under 2k chars. When the output is right, B should drop toward 2-3 turns (112-170k per case), meaning -50 to -110k per run. This brings B close to A, but not below it.
- **How to verify:**
  - Offline: summary length under 2k on h1/h2/h3, with PLAN_JSON identical before and after.
  - Next run: the median B modelTurns is 2-3 and B tokens are at most 1.3x A per case.

### 4. Drop Jev (shadow) from this tool
- **Change:** in `config.json`, keep `jev.enabled: false` as the default, remove `--jev` from the arm-B wrapper, and delete the Jev lines from the summary.
- **Why:** over two rounds, 108 calls changed 0 waves, and 32 candidates hit the budget cap. The disagreements in this run were weak or wrong (Q-5/Q-6 0.92 are two consumers of the same endpoint). The one useful signal from round 1 is now covered by the deterministic endpoint fix.
- **Expected effect:** about 5-6 s of latency saved per plan, a shorter summary, and no change in pass rate.
- **How to verify:** offline. PLAN_JSON is identical with and without `--jev` on h1/h2/h3.

### 5. Be honest about cost: drop the tool for small batches, or test it where it can win
- **Change:**
  - Either document in SKILL.md that it is not worth calling for batches of about 12 stories or fewer with no repository metadata (Claude reads them in one pass),
  - or run one more experiment with 20-30 stories, hidden contract/fixture/migration edges that are easy to miss by reading, `maxConcurrency` stated in the prompt, and grade.mjs checking the cap.
- **Why:** A's floor is 2 turns at about 109k and B's floor is also 2 turns (h2.B.r1, 112k), so the tool can tie plain Claude on cost here but cannot beat it. A passes 6/6, so B cannot pass more. The only possible value is correctness on batches too large or too subtle for one read.
- **Expected effect:** a decision instead of another round of the same result. If B does not pass more than A on the harder set after #1-#3, recommend DROP.
- **How to verify:** the next experiment id. Success means B passes more cases than A on the hard set, with B tokens within 1.3x of A. Otherwise the recommendation is DROP.
