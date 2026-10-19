# Pilot lock: W-19279 (1 story x 3 tiers + JEV + 3 gradings)

Locked: 2026-10-19T10:43:09Z (UTC), before any pilot model or JEV call.

## Scope
- Story: W-19279 (lowest id in the calibration split, `split-0B.json`). Held-out stories are not touched.
- Generation: Haiku, Sonnet, Opus, same brief, tools off, one attempt each.
- JEV: 3 orderings (`orderings(3)`), `consistency` over them.
- Grading: 3 Sonnet calls, one per answer, blind to tier (answers labelled A/B/C).
- Purpose: check the pipeline and measure cost. **Not** an agreement measure. One story says nothing about whether JEV picks the right tier.

## Locked files (sha256)
| File | sha256 |
|---|---|
| rubric-W-19279.md | cf1769430d168cb702abc8a25898d8e414b46ed565da40e6078f6442681879c2 |
| brief.txt | aed0f90e3241dff0ec5501b18258120b71b874a5fe80c7fba8eae4492b318a64 |
| grader-prompt.txt | 793ecdca495aad0ebd7ed02396497db455b2a3402012853899f691f09d5cabef |
| run-pilot.mjs | 51d6887d4052f7f3c398b026b7e11a583bde980f413ba47c8b6338669108295f |

Any change to these files after this lock makes the pilot void; a new lock is needed before a re-run.

## Budget (USD)
- **Pilot ceiling: 1.50** for the whole run (JEV + generation + grading). The runner checks the ceiling before each call and skips the call if the call's cap would go over it.
- Per-call caps (`--max-budget-usd`): Haiku 0.10, Sonnet 0.40, Opus 0.60, grader (Sonnet) 0.40.
- JEV: if the call returns no cost, 0.05 is charged per call (3 calls = 0.15 at most).
- If the CLI returns no `total_cost_usd` for a claude call, the full cap is charged.
- Retries: **0**. Extra gradings: **0**. Escalations: none.
- Pilot calls: 3 JEV + 3 generation + 3 grading = 9 calls.

## Labels
- Blind label map: A = opus, B = haiku, C = sonnet. The grader sees only the letter. The map is written to `results/summary.json` after grading.

## Independent re-grade (for the later calibration, not run in this pilot)
- Agreement is measured by a second grading in a **separate** blind session, on the same answer, with the same rubric, and compared with the first grading. Repeated grading in the same session does not count.
- The grader is the same model family (Sonnet) in the pilot, so the re-grade measures consistency only. Whether a stronger or human grader is needed is the user's call later.
- Agreement threshold: not set in this pilot. It is set in the 0B budget sheet before any calibration grading.

## Known limits
- Story attachments (screenshots) are not given to the models or the grader.
- The grader does not see model names. The answer text itself may reveal style; this is accepted and recorded.
- Pilot results do not decide JEV quality or the calibration. They only show whether the process works and what it costs.

## Stop rule
- The runner runs once. If `results/` exists, it refuses to run again.
