# Improvements (round 2, bad-result review, step 7b)

**Diagnosis.** The extra cost is extra turns. Both arms cost about 61k tokens per turn, and B ran 4 more turns (51 vs 47), about +245k against a measured +205k. h02 alone adds +218k. A never had the full log in context: Claude Code cut it to 2.2-10 KB, so the 1.7 KB list saves little. The list was barely used. In all 8 B runs the next call was `Read log offset 1 limit 60-140`, followed by A-style greps. Only h04 B2 opened ranges the list named.

Jev's score was useful once (h04 #5, the gold WARNING, p=0.32), but that line was already in the head the agent read. In h02, noise (0.36) outranked gold (0.30). In h06 and h07 gold is not in the top 12, and slots 7-12 are pinned noise. The cases were easy: 16/16 passed in 5-8 turns. The pair differences give SD 74k and SE 26k (t≈1.0), and B was cheaper in 4/8 pairs. The +7% is noise.

1. **A list the agent can act on without reading the log head.**
   - **change:** `curator.py::pointers`/`rank`. Use the parser's error line as the anchor preview. Extend each anchor through its `Captured ...` section (h04 gold sits 2 lines past `offset 11 limit 20`). Print the lines of the top 2-3 pointers, about 1.5 KB at most.
   - **why:** 8/8 B runs spent a turn on the log head.
   - **expected effect:** about -1 turn (about -60k, -15%) per B run. Pass rate equal.
   - **how to verify:** rerun the 4 cases. No B run reads the log head, and B ≤ A in at least 6/8 pairs.
2. **A rules-only arm.** A `curator.engine: false` flag in `curate`. Why: Jev's top scores were noise in 3/4 cases. Effect: if rules-only matches Jev, drop the engine call (80 questions and about 1.2 s per run). Verify: the same cases, gold in the top 5.
3. **Cap the noise.** `rank`: at most 2 pinned chunks, merge repeated messages (h07 lists "cache read failed" 3 times). Why: 6-10 of the 12 slots are noise. Effect: supports suggestion 1. Verify: `tests/test_curator.py`.
4. **Harder cases.** `make_tasks.mjs`: gold lines that `FAILED|Error` does not match, logs over 1 MB, and at least 3 repetitions in alternating order. Why: an order effect (r1 cache writes 67-75k vs 23-35k for r2) and a ceiling in the current cases. Effect: detects ±10%. Verify: report the pair SE.

TOP: Make the pointer list self-sufficient (error-line previews, anchors extended through Captured sections, lines of the top 2-3 pointers) so that B agents skip the extra log-head Read turn that all 8 B runs spent.
