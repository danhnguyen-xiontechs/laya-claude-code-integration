# Result: Jev / Laya as the P3 answer grader (offline)

Experiment `20261018-bstw-engine-grader-01`. Design and criteria frozen in `design.md` before any engine call. No Claude agent run, no Claude tokens.

## Numbers (240 rows: 120 real answers with their script grade, 120 mismatched negatives)

| | Jev (`typesafe/jev-1.13`, OpenRouter) | Laya (local, `english`) | criterion |
|---|---|---|---|
| Agreement, frozen labels | 97.5% | 57.1% | ≥ 95% |
| Agreement, corrected labels (see deviation) | **98.3%** | 58.8% | ≥ 95% |
| False pass on real `fail` rows | **0 / 8** | 7 / 8 | 0 |
| False pass on mismatched rows, corrected | **0 / 116** | 58 / 116 | ≤ 2% |
| False fail (a right answer graded fail) | 4 | 34 | not gated |
| p50 / p90 latency | 539 / 606 ms | 1,465 / 2,879 ms | p50 < 2 s |
| Cost of the 240 calls | $0.0054 | 0 (local CPU) | |

By dataset (corrected labels), rows graded like the script:

| dataset | kind of judgment | Jev | Laya |
|---|---|---|---|
| acceptance-criteria-coverage (32) | per-criterion verdicts vs key | 32 | 18 |
| integration-verifier (96) | batch + story verdicts vs key | 96 | 54 |
| skills-router (96) | picked skill vs gold id | 96 | 57 |
| story-batch-planner (16) | wave order vs invariants (reasoning) | 12 | 12 |

## Deviation
The mismatched negatives assumed that an answer graded against another case's gold always fails. That is false for story-batch-planner: its gold is a set of invariants, so 4 answers also satisfy another case's gold. Jev graded 3 of those 4 `pass`, and was right. `scripts/relabel_sbp.mjs` re-labels them with the design's own rule, checked mechanically. The same checker agrees with the original script on all 8 real story-batch-planner rows. Both engines' saved grades were re-scored without a new call. With the frozen labels Jev misses one criterion: 2.5% false pass on mismatched rows against ≤ 2%.

## Reading
- **Laya: REJECT for this use.** It passes 7 of 8 wrong answers and agrees with the script about as often as a coin.
- **Jev meets every criterion on corrected labels, with 0 false passes.** Its 4 errors are all false fails on story-batch-planner, the only dataset that needs multi-step reasoning: 12/16 there. A false fail only costs a human look, so it fails safe.
- **Where Jev adds little:** on the three exact-match datasets (224 rows) a plain string comparison would also score 100%. Jev's value is in answers whose wording varies, not in reasoning over constraints.
- **Limits:** only 8 real fails, one reasoning dataset, answers from 6 rounds of this repo. Confidence LOW.

## Recommendation
**PILOT**, in shadow for one round: `scripts/grade_with_engine.mjs --provider jev` as the P3 fallback grader for cases with no grading script. Its grade is logged next to Claude's or the script's and never replaces them. A Jev `fail` is sent to a human look. Do not use it for constraint or ordering checks; write a script for those. Not wired into `SKILL.md` until your Gate B.
