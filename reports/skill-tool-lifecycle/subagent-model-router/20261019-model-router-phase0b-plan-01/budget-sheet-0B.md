# Phase 0B budget sheet (DROPPED)

**Dropped by the user, 2026-10-20.** No calibration run. Labels now come from real use: the router hook runs in shadow with provider jev on every repo, and `scripts/label-outcomes.mjs` joins its log with the subagent transcripts. The pilot below stays as a record.

Status: planning only. No model has been called for 0B. This sheet needs the user's approval before any run. The split is in `split-0B.json` (version 0B-v1, assignments sha256 `b157d7be96f1c516065a0bbb06fbb34e462d6fb1f181c6ac2b3f551f1a917fa2`).

## 1. Task counts
- Source: the 21 real stories (`subagent-model-router/real/stories-text.json`). No outcomes exist for them.
- Calibration: 15 stories. Held-out: 6 stories (not run in 0B; see section 6).
- Task type: **unknown**. The only type source is `truth-effort.json`, which is post-hoc PR data, so it is not used for labels or split. Type counts stay null.

## 2. Generation calls (calibration only, one attempt per tier per story)

| Model | Calls | Basis |
|---|---|---|
| Haiku | 15 | 1 per story |
| Sonnet | 15 | 1 per story |
| Opus | 15 | 1 per story. **Needs the user's OK**: this is above the 2-per-round Opus cap in build-skill-tool-workflow v3. |
| JEV | 45 | 3 votes per story (k=3, as in `route-jev.json`). Cost unknown: null. |

Retries: none. Escalation rows are not created in 0B; a failed generation is recorded as a fail.

## 3. Grading calls
- The 21 real stories have no automatic check (`checkClass: none`), so every output needs grading.
- Grader: Sonnet, blind to tier, graded against the frozen rubric. **Opus does not grade.**
- 45 gradings (3 outputs x 15 stories).
- Agreement check: 9 outputs (3 stories x 3 tiers) graded a second time by a second Sonnet call. Used only to measure grader agreement. Stop rule in section 5.

## 4. Cost estimate

Basis: mean cost per recorded run from the 0A data (`raw-sources.json`). These come from small bench tasks, not from real stories, so **the real-story cost is not known**. Treat the figures as order-of-magnitude only.

| Item | Calls | Mean per call (0A) | Estimate (USD) |
|---|---|---|---|
| Haiku generation | 15 | 0.0069 (n=62) | 0.10 |
| Sonnet generation | 15 | 0.1133 (n=87) | 1.70 |
| Opus generation | 15 | 0.3069 (n=6, weak) | 4.60 |
| Sonnet grading | 45 | 0.1133 (assumed same as generation) | 5.10 |
| Agreement re-grade | 9 | 0.1133 | 1.02 |
| JEV | 45 | unknown | null |
| **Total (excluding JEV)** | | | **about 12.5** |

Proposed cap: **USD 15** for the calibration run, excluding JEV until its cost is measured.

## 5. Stop conditions (proposed)
1. **Pilot first.** Run one story through all three tiers and its three gradings before the full run. Measured real-story cost per story (generation plus grading) x 15 must stay under the cap; otherwise stop and send this sheet back for re-approval.
2. Stop if the cumulative cost reaches 80% of the cap before all 15 stories finish.
3. Stop if any call count exceeds the table in sections 2 and 3.
4. Stop if agreement between the two Sonnet gradings is below the agreed threshold on the 9-output sample. The threshold must be written into this sheet before any grading starts.
5. Stop if any held-out story id appears in a prompt, example or retrieval result.

## 6. Held-out (separate budget, not approved)
- 6 stories x 3 tiers generation + 18 gradings. Estimate: about USD 4.6 at the same means.
- Runs once, at final evaluation, with the split version and hash recorded.

## 7. Decisions needed from the user
1. Approve the pilot (1 story x 3 tiers + 3 gradings) on its own? Estimated cost about USD 0.8 (0.43 generation + 0.34 grading, same basis as section 4).
2. Approve Opus generation for the 15 calibration stories (15 calls, about USD 4.6)? This exceeds the 2-per-round Opus cap, so it needs a user OK on record.
3. Approve the cap of USD 15 and the agreement threshold (not yet set)?

## 8. Rubric (not frozen)
- Real stories have no written acceptance criteria. 20 of 21 texts contain words such as "should" or "expected", but that is a keyword match, not a rubric.
- Before the pilot: write a rubric for each of the 15 calibration stories. Each criterion needs a pass/fail rule the grader can apply blind.
- Before the held-out run: a separate rubric for the 6 held-out stories, fixed before any run.
- Criteria written from model output are not allowed. Criteria come from the story text only.
