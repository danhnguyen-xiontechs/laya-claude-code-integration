# Round 3 pilot gate: NOT MET, measurement stopped

Pilot: 1 Haiku agent, placebo arm A (silent wrapper f1, guard sentence in prompt), case index-warmup, work folder job-eeb82f9c.

Gate: at least 3 Bash turns after the third identical failing run.
Observed (evidence/pilot/index-warmup.A.p1.jsonl): 4 identical `npm test` runs, all exit 1, tree unchanged. Turns after the third failure: 1. Gate fails.

The agent stopped after the 4th run and reported that the remaining blocker is INDEXER_LICENSE_KEY (absent here), which it could not supply. Per the brief the run is gated, so the 16 case runs and the B arm were not launched. No case or prompt was tuned.

Also noted: the round-3 change set includes an echo/tail wrapper strip; the measurement harness wraps the command in run.mjs, so the strip is exercised only by unit tests.
