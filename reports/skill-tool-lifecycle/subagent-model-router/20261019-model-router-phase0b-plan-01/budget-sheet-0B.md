# Phase 0B budget sheet (v4: proposed, awaiting user OK; held-out NOT approved)

Status: **not approved yet.** v4 replaces v3, which was never approved and is kept as `superseded/budget-sheet-0B-v3-unapproved.md`. v4 goes to the user together with the run lock (`run-0B-lock.md`). The user's explicit OK on both is what allows the first 0B call. No model has been called for 0B. The held-out budget (section 5) is not approved.

## Changes from v3
- **Stories:** 15 calibration stories. 13 evaluable, W-19279 pilot-exposed (provenance only), and **W-19358 `not_evaluable`** (no call is made for it). Recorded in `story-status-0B.json` before any call. v3 counted it as evaluable.
- **Calls:** 93 (was 99). Generation and grading cover 14 runnable stories. The repeat sample is 9 of the **39** evaluable outputs (13 × 3), not 42.
- **Accounting gap closed.** The runner starts its spend counter at the rubric-helper spend (USD 0.0775562) read from `baseline-ledger-0B.json`. If the ledger is missing or does not match its source, the run halts with no call. v3 disclosed the gap and left it open.
- **Cost estimate recomputed** on 14 stories and 93 calls (section 4). v3's "about 2.8" came from 99 calls.
- **Repeatability and human agreement** remain separate measures (section 7).
- **Held-out ids** are not printed.

## 1. Task counts
- Source: 21 real stories in `real/stories-text.json`. No outcomes exist for them.
- Calibration: 15 stories, copied out by id into `calibration-stories-0B.json`.
  - 13 evaluable.
  - W-19279: pilot-exposed. Runs for provenance; excluded from every 0B conclusion.
  - W-19358: not evaluable. Full text is not recoverable locally (every copy is cut off at 984 characters). No call is made.
- Runnable: 14 (13 evaluable + W-19279).
- Held-out: 6 stories. **Not used.** Their text is not in the calibration file, any prompt, any rubric or any result, and is not printed or stored. The run lock counts held-out id matches in prompt-bearing inputs: 0 matches across 18 inputs.
- Task type: unknown. `truth-effort.json` is post-hoc PR data and is not used for labels or split.

## 2. Calls in the 0B run (runner order)

| Step | Model | Calls | Cap per call (USD) |
|---|---|---|---|
| Generation | Haiku | 14 | 0.10 |
| Generation | Sonnet | 14 | 0.40 |
| Generation | Opus | 14 | 0.60 |
| Blind grading (Sonnet; Opus does not grade) | Sonnet | 42 | 0.40 |
| Repeatability re-grade (Sonnet, 9 of 39 evaluable outputs, by seed) | Sonnet | 9 | 0.40 |
| **Total** | | **93** | |

Sequential only. No parallel calls. No retry. No JEV. A failed generation is recorded as a fail and is not replaced. The repeat grades run last, after the 42 gradings.

Opus generation is the largest single line. v4 asks for explicit confirmation in the same OK.

## 3. Stop rules (as in the locked `run-0B.mjs`)
1. **Reserve check** before every call: if `spent + the next call's cap > 12`, no call is made and the run is marked incomplete (`reserve`).
2. **Runner stop at 15.** The run halts when spent passes 15. **$15 is a runner stop, not a billing ceiling.** The runner enforces it on its own accounting. The provider and the CLI do not guarantee it. One call can exceed its `--max-budget-usd` (the v1 Haiku call was charged 0.162 against a 0.10 cap), so spend can pass 15 by one overrun. With the reserve check, a normal run stops at 12 long before 15.
3. **Starting spend** is the rubric-helper spend, 0.0775562, counted before the first call (section 6).
4. **Other halts:** call error; empty answer; cost above the call's own cap; malformed grader output; a held-out id in any input or prompt. A missing cost is charged at the cap.
5. **Repeatability threshold:** the two Sonnet gradings must agree on overall pass/fail for at least 7 of 9 outputs. Below 7 of 9, 0B reports the grader as unreliable and draws no routing conclusion from it. The re-grades run last, so this is a report result, not a mid-run halt.

## 4. Cost estimate (real per-call costs)
Basis: per-call `total_cost_usd` from the clean pilot v2 (`pilot-v2/results/`), which ran W-19279 only. Each per-call figure is a single data point. The 3x figure is the safety margin.

| Item | Calls | Real per call (v2, USD) | Estimate (USD) |
|---|---|---|---|
| Haiku generation | 14 | 0.0022 | 0.03 |
| Sonnet generation | 14 | 0.0286 | 0.40 |
| Opus generation | 14 | 0.0671 | 0.94 |
| Sonnet grading | 42 | 0.0242 | 1.02 |
| Repeatability re-grade | 9 | 0.0242 | 0.22 |
| **Total (93 calls)** | | | **about 2.6** |
| Same total at 3x | | | **about 7.8** |

- The table is for the 93 calls only. The runner's counted total also starts at the rubric-helper spend (USD 0.0775562, section 6), so the expected counted total is about 2.7 (about 8.0 at 3x).
- Cross-check: 14 stories × 0.1705 (measured end to end on W-19279: 3 generations + 3 gradings) = 2.39, plus 9 × 0.0242 = 0.22. Total 2.60.
- Story text is 432 to 1,037 characters. W-19279 is 860, and the calibration mean is about 750. So W-19279 is not an outlier, but that does not show the cost is typical.
- Hard upper bound if every call hits its cap: 14 × 0.10 + 14 × 0.40 + 14 × 0.60 + 42 × 0.40 + 9 × 0.40 = **35.8**. That is far above the stop, so the reserve check, not this figure, limits spend. The 12 stop and the 15 runner stop are the controls.

## 5. Held-out (separate budget, **NOT approved**)
- 6 stories × 3 tiers of generation + 18 gradings. Estimate at the v2 real costs: 6 × 0.098 + 18 × 0.024 = about USD 1.0 (about 3.1 at 3x).
- Runs once, at final evaluation, with the split version and hash recorded. It needs its own budget approval and its own rubric, both fixed before any run.
- Nothing in 0B touches it.

## 6. Actual spend so far

| Item | Calls | Spend (USD) | Cap (USD) | In runner count? |
|---|---|---|---|---|
| Rubric second read (Sonnet, 14 rubrics, one call) | 1 | 0.0775562 | 0.50 (rubric helper total) | **Yes, via `baseline-ledger-0B.json`** (starting spend) |
| Pilot v2 (W-19279, 3 generations + 3 gradings) | 6 | 0.170540 | 1.50 (user ceiling) | No: separate run, provenance only |
| Pilot v1 Haiku call (anomaly; raw output not saved) | 1 | 0.162 charged | 0.10 | No: separate run |

Rubric-helper total: USD 0.0775562 of 0.50. Drafting used no model call. The helper saw only the story text and the rubrics; no candidate, JEV or grading call was made before the lock.

## 7. Agreement and checks
- **Repeatability:** two Sonnet gradings of the same 9 outputs, chosen by seed `0B-regrade-v1` from the 39 evaluable outputs (13 stories × 3 tiers), compared on overall pass/fail. Threshold 7 of 9. It measures grader consistency, not correctness.
- **Randomised mapping:** seed `0B-map-v1` gives one A/B/C permutation per story (`mapping-0B.json`, sha256 `82b0a210f09dceed4d9d19c7d90c29629a21a398e9b74a781354ed1569f471ba`). The mapping never appears in a grading prompt. The runner reads it only after grading, to label results.
- **Human agreement:** a blind user grade of the same 9 outputs, from `blind-sample/`, which holds only letters A/B/C, the rubric and the task. It is reported as "grader and user agreed on overall pass/fail in k of 9". It is not called accuracy and no rate is extrapolated from it. It costs nothing.
- **Deterministic quote check** on all 51 gradings (42 + 9 repeat). Every quote the grader cites must appear verbatim in the answer (LF-normalised). Cost: 0.
- **E3 pattern check** is a flag, not a verdict. Hits go to `e3-flags.md` with context. A person reads each flag before the E3 result is final.

## 8. Decisions requested
1. OK to run the 0B calibration under `run-0B-lock.md`: 15 calibration stories (13 evaluable, W-19279 for provenance, W-19358 `not_evaluable` with no call), 93 calls, reserve stop 12, runner stop 15, expected spend about 2.6 for the calls, about 2.7 counted with the starting spend.
2. Confirm Opus generation for the 14 runnable stories within that run (section 2).
3. Confirm W-19358 as `not_evaluable` (no call for it), or give a reason to change that.
4. Held-out budget (section 5) stays not approved.

Not to do without a separate approval: a held-out run, any routing change after calibration, a push, or a PR.
