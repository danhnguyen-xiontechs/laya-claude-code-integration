# Phase 0B budget sheet (v3: proposed, awaiting user OK; held-out NOT approved)

Status: **not approved yet.** v3 replaces v2, which recorded the calibration as approved in advance. v3 goes to the user together with the run lock (`run-0B-lock.md`). The user's OK on both is what allows the first 0B call. No model has been called for 0B. The held-out budget (section 5) is not approved.

## Changes from v2
- **JEV row removed.** The 0B runner has no JEV step, and no JEV call is made in 0B.
- **Repeatability sample** is the seeded 9 of 42 evaluable outputs (seed `0B-regrade-v1`), as in the locked runner. v2 named three stories instead. The runner is the record.
- **Stop rule** is the reserve check, and the $15 figure is named a runner stop, not a billing ceiling (section 3).
- **Repeatability and human agreement** are separate measures (section 7).
- **Randomised A/B/C mapping** (seed `0B-map-v1`) is kept out of every prompt.
- **W-19279** is marked pilot-exposed. It runs for provenance and is excluded from every 0B conclusion.
- **Actuals** now include the rubric-helper spend (USD 0.077556), which the runner does not count (section 3).
- **Held-out ids** are no longer printed. v2 listed them in section 1; v3 does not.

## 1. Task counts
- Source: 21 real stories in `real/stories-text.json`. No outcomes exist for them.
- Calibration: 15 stories, copied out by id into `calibration-stories-0B.json`. 14 are evaluable. W-19279 is pilot-exposed.
- Held-out: 6 stories. **Not used.** Their text is not in the calibration file, not in any prompt, rubric or result, and is not printed or stored. The 21-story source file contains held-out text, which is why only the 15 calibration stories were copied out. The run lock counts held-out id matches in prompt-bearing inputs: 0 matches across 18 inputs.
- Task type: unknown. `truth-effort.json` is post-hoc PR data and is not used for labels or split.

## 2. Calls in the 0B run (runner order)

| Step | Model | Calls | Cap per call (USD) |
|---|---|---|---|
| Generation | Haiku | 15 | 0.10 |
| Generation | Sonnet | 15 | 0.40 |
| Generation | Opus | 15 | 0.60 |
| Blind grading (Sonnet; Opus does not grade) | Sonnet | 45 | 0.40 |
| Repeatability re-grade (Sonnet, 9 of 42 outputs by seed) | Sonnet | 9 | 0.40 |
| **Total** | | **99** | |

Sequential only. No parallel calls. No retry. No JEV. A failed generation is recorded as a fail and is not replaced. The repeat grades run last, after the 45 gradings.

Opus generation is the largest single line. v2 recorded it as approved. v3 asks for explicit confirmation in the same OK.

## 3. Stop rules (as in the locked `run-0B.mjs`)
1. **Reserve check** before every call: if `spent + the next call's cap > 12`, no call is made and the run is marked incomplete (`reserve`).
2. **Runner stop at 15.** The run halts when spent passes 15. **$15 is a runner stop, not a billing ceiling.** The runner enforces it on its own accounting. The provider and the CLI do not guarantee it. One call can exceed its `--max-budget-usd` (the v1 Haiku call was charged 0.162 against a 0.10 cap), so spend can pass 15 by one overrun. With the reserve check, a normal run stops at 12 long before 15.
3. **Other halts:** call error; empty answer; cost above the call's own cap; malformed grader output; a held-out id in any input or prompt. A missing cost is charged at the cap.
4. **Repeatability threshold:** the two Sonnet gradings must agree on overall pass/fail for at least 7 of 9 outputs. Below 7 of 9, 0B reports the grader as unreliable and draws no routing conclusion from it. The re-grades run last, so this is a report result, not a mid-run halt.

**Accounting gap (disclosed, not fixed).** `run-0B.mjs` starts its spend counter at 0. The rubric-helper spend (USD 0.077556, section 6) is therefore outside the runner count, although the plan says it should count. The 12 stop applies to runner spend only, so total 0B spend can be about 0.08 above the stop. The impact is at most 0.08. Fixing it means changing the runner, which needs a new lock and a new stub test. It is left as is and disclosed.

## 4. Cost estimate (real per-call costs)
Basis: per-call `total_cost_usd` from the clean pilot v2 (`pilot-v2/results/`). That is one story, so each mean is a single data point. The 3x figure is the safety margin.

| Item | Calls | Real per call (v2, USD) | Estimate (USD) |
|---|---|---|---|
| Haiku generation | 15 | 0.0022 | 0.03 |
| Sonnet generation | 15 | 0.0286 | 0.43 |
| Opus generation | 15 | 0.0671 | 1.01 |
| Sonnet grading | 45 | 0.0242 | 1.09 |
| Repeatability re-grade | 9 | 0.0242 | 0.22 |
| **Total (99 calls)** | | | **about 2.8** |
| Same total at 3x | | | **about 8.3** |

- Per story, measured end to end on W-19279: 0.1705 USD, which is 2.56 for 15 stories.
- Story text is 432 to 1,037 characters. W-19279 is 860, and the calibration mean is about 750. So W-19279 is not an outlier, but that does not show the cost is typical.
- Hard upper bound if every call hits its cap: 15 x 0.10 + 15 x 0.40 + 15 x 0.60 + 54 x 0.40 = 38.1. That is far above the stop, so the reserve check, not this figure, limits spend.

## 5. Held-out (separate budget, **NOT approved**)
- 6 stories x 3 tiers of generation + 18 gradings. Estimate at the v2 real costs: 6 x 0.098 + 18 x 0.024 = about USD 1.0 (about 3.0 at 3x).
- Runs once, at final evaluation, with the split version and hash recorded. It needs its own budget approval and its own rubric, both fixed before any run.
- Nothing in 0B touches it.

## 6. Actual spend so far (outside the 0B runner count)

| Item | Calls | Spend (USD) | Cap (USD) | In runner count? |
|---|---|---|---|---|
| Pilot v2 (W-19279, 3 generations + 3 gradings) | 6 | 0.170540 | 1.50 (user ceiling) | No: separate run |
| Rubric second read (Sonnet, 14 rubrics, one call) | 1 | 0.077556 | 0.50 (rubric helper total) | No: see section 3 |
| Pilot v1 Haiku call (anomaly; raw output not saved) | 1 | 0.162 charged | 0.10 | No: separate run |

Rubric-helper total: USD 0.077556 of 0.50. Drafting used no model call. The helper saw only the story text and the rubrics; no candidate, JEV or grading call was made before the lock.

## 7. Agreement and checks
- **Repeatability:** two Sonnet gradings of the same 9 outputs, chosen by seed `0B-regrade-v1` from the 42 evaluable outputs (14 stories x 3 tiers), compared on overall pass/fail. Threshold 7 of 9. It measures grader consistency, not correctness.
- **Randomised mapping:** seed `0B-map-v1` gives one A/B/C permutation per story (`mapping-0B.json`, sha256 `82b0a210f09dceed4d9d19c7d90c29629a21a398e9b74a781354ed1569f471ba`). The mapping never appears in a grading prompt. The runner reads it only after grading, to label results.
- **Human agreement:** a blind user grade of the same 9 outputs, from `blind-sample/`, which holds only letters A/B/C, the rubric and the task. It is reported as "grader and user agreed on overall pass/fail in k of 9". It is not called accuracy and no rate is extrapolated from it. It costs nothing.
- **Deterministic quote check** on all 45 outputs. Every quote the grader cites must appear verbatim in the answer (LF-normalised). Cost: 0.
- **E3 pattern check** is a flag, not a verdict. Hits go to `e3-flags.md` with context. A person reads each flag before the E3 result is final.

## 8. Decisions requested
1. OK to run the 0B calibration under `run-0B-lock.md`: 15 stories (14 evaluable, plus W-19279 for provenance), 99 calls, reserve stop 12, runner stop 15, expected spend about 2.8.
2. Confirm Opus generation for the 15 stories within that run (section 2).
3. Held-out budget (section 5) stays not approved.

Not to do without a separate approval: a held-out run, any routing change after calibration, a push, or a PR.
