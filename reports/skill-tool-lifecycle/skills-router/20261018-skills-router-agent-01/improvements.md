# Improvements — skills-router (20261018-skills-router-agent-01)

**Diagnosis.** Plain Claude with the full skill list got 12 of 12 right and Claude + the router hint also 12 of 12, so the hint changed no answer, while B cost 72% more tokens (1,491,616 -> 2,558,886; both repetitions agree: 779k -> 1,334k and 712k -> 1,225k) and 44 instead of 25 turns. The router itself was right on all 6 requests (4 skills and 2 "none"), with 0 Jev errors and about 0.8 s per call, so the tool worked and the extra cost is its delivery: the router JSON (shortlist of 8, alternatives, overlaps, agreement) comes after a 30 KB listing, the Bash output is cut and saved to a file, and every B agent made 3-5 tool calls against 2-3 for A, the extra 1-3 being greps, reads or re-runs of the helper to find the hint (the three c4 B calls of the helper in r1 and r2 included) to find the hint. The cases were also too easy for any tool to show value: Haiku already picks `web-test-jev-wait`, `review-pr-laya-classify` and `code-review` correctly when it sees the full descriptions.

## Suggestions (ranked by expected effect)

1. **Give the hint as one short line.**
   - **Change:** add `--format line` to `scripts/route.mjs` (and make it the default in `SKILL.md` step 2) that prints `suggest: <id> | why | alt: <id>, <id> | overlaps: <id> | abstain: <reason>` in under 80 tokens; keep the JSON behind `--json`.
   - **Why:** the full JSON is ~2k tokens and is re-read from cache on every later turn; in this run it was the largest part of B's +1.07M tokens.
   - **Expected effect:** B's turns fall back to A's (2-3 per case) and B's tokens to within about 10% of A.
   - **How to verify:** rerun the same 6 cases x 2 repetitions with the line output printed before the listing, then compare paired tokens with `summary.json` (the target is B <= 1.1 x A with equal passes).
2. **Call the router only when the pick is uncertain.**
   - **Change:** `SKILL.md` step 2: skip the route call when the request names a skill (`/name`) or the agent's own pick is the only plausible one; run it when two or more listed skills share a name prefix or a base (a `-jev-` / `-laya-` family) or the request is vague.
   - **Why:** on easy requests the hint cost 2x the tokens and added nothing; the tool's own eval says its gain is in overlap and implicit prompts.
   - **Expected effect:** no extra cost on easy requests; the router only runs where it can help.
   - **How to verify:** count router calls per 100 mined prompts in `shadow.jsonl`, and rerun this experiment with the gate on.
3. **Measure on cases where plain Claude is wrong.**
   - **Change:** pick cases from `eval/scenarios.jsonl` where the BM25-only or the listing-only baseline fails (the 19 vague/typo cases and the overlap cases where A picked the plain skill), plus held-out prompts that no test quotes; add the newest skills (`codebase-task-explorer`, `story-batch-planner`, `integration-verifier`) which the eval does not cover.
   - **Why:** 12 of 12 for A leaves no room for B to be better; the two overlap cases c2 and c3 are in-sample for the tool.
   - **Expected effect:** the next run can show a pass gain or show that there is none.
   - **How to verify:** A below 100% on the new set before B is run.
4. **Fix the accepted Major findings before any adoption.**
   - **Change:** `route.mjs:350` abstain when `gate` or `fit_*` is missing in a 200 body; `SKILL.md:31` pass the query on stdin or from a file (`--query-file`); `catalog.mjs:289` dedupe by the full invocation, not the last `:` segment.
   - **Why:** this run only used the happy path (18 calls, 0 errors); each finding is a silent wrong suggestion or a shell injection.
   - **Expected effect:** no wrong "high confidence" hints on partial answers; safe handling of requests with `$(...)`.
   - **How to verify:** add the three inputs of the review to `tests/route.test.mjs` and `tests/catalog.test.mjs`.
5. **Consider dropping the tool for a catalog this size.** With 48 entries and full descriptions in the prompt, a Haiku agent already picks correctly; the router earns its cost only on a catalog like ess-be's (172 entries) where the listing no longer fits in the prompt. Verify by running this same experiment against that catalog; if A still passes 100% there, drop the tool.
