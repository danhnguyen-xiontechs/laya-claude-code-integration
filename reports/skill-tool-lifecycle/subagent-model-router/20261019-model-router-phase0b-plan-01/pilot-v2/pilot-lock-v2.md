# Pilot lock v2: W-19279 (re-run after the incomplete v1)

**Locked: 2026-10-19T16:12:06Z (UTC). Amended: 2026-10-19T16:13:02Z (UTC, amendment 1), before any v2 model or JEV call.** Ceiling 1.50 and re-run of all three answers, as chosen by the user.

**Amendment 1.** The first v2 attempt (locked 16:12:06Z) stopped at the first call with `spawnSync claude ENOENT`. No model call was made and nothing was spent. Its output is kept in `results-attempt1-enoent/`. The cause is the npm `claude` shim (`claude.cmd`), which `spawnSync` cannot run without a shell. The fix changes only the spawn target in `run-pilot-v2.mjs` (direct call to `claude.exe`, same arguments). Ceiling, caps, scope and reuse choice are unchanged. The new runner hash is in the table below.

## Why a v2
v1 (`../pilot/pilot-lock.md`) ran once and is incomplete. The Haiku generation returned `is_error` with no result and zero tokens, yet was charged 0.162 (cap 0.10). Its grade is missing. The v1 runner did not save the raw CLI output, so the cause is not known. v1 stays as the record and is not edited.

## Scope (same as v1)
- Story: W-19279 (`split-0B.json`). Held-out stories are not touched.
- Generation: Haiku, Sonnet, Opus, same brief, tools off, one attempt each.
- JEV: 3 orderings (`orderings(3)`), `consistency` over them.
- Grading: 3 Sonnet calls, one per answer, blind (labels A/B/C only).
- Purpose: check the pipeline and measure cost. Not an agreement measure. One story does not decide JEV quality or the calibration.

## Changes from v1 (in `run-pilot-v2.mjs`)
1. **Paths** come from the script location, not hardcoded. v1 pointed at `D:/Laya` and `C:/Users/LENOVO2`, which do not exist on this machine.
2. **Raw output saved** for every claude call: `results/raw-<call>.txt` (stdout, stderr, error, exit code).
3. **Empty answer = error.** A result with no text, or `is_error`, is recorded as an error. No answer is used for grading.
4. **Halt rule.** The first call error, empty answer, or cost above its cap stops all later model calls. The summary records `halt`.
5. **Haiku first.** Haiku generation runs first as the diagnostic, before JEV and the other tiers.
6. **Input check.** The runner refuses to run if any input differs from the hashes below.
7. **Lock values in the file.** `CEILING` and `REUSE_V1` are `null` in the runner and it refuses to run until they are set. They are set before the lock hash is taken.
8. **Prompt text is LF.** Inputs are read with CRLF converted to LF, and the hashes below use that form. v1 sent the CRLF text to the models. This is the only difference in model input.

## Locked files (sha256 of LF-normalized text)
| File | sha256 | Source |
|---|---|---|
| rubric-W-19279.md | cf1769430d168cb702abc8a25898d8e414b46ed565da40e6078f6442681879c2 | `../pilot/` (same as v1 lock) |
| brief.txt | aed0f90e3241dff0ec5501b18258120b71b874a5fe80c7fba8eae4492b318a64 | `../pilot/` (same as v1 lock) |
| grader-prompt.txt | 793ecdca495aad0ebd7ed02396497db455b2a3402012853899f691f09d5cabef | `../pilot/` (same as v1 lock) |
| real/stories-text.json | a7202787dc570df8b1f2fcfa832e8b9c3e6fd72f4fe5cad5a4f247de56da6203 | `.claude/skills/subagent-model-router/real/` |
| run-pilot-v2.mjs | e5c3e84ee9bd9d9e259028c3fdc02a6fb8eadc061e48f9c20fcec41874e38642 | `pilot-v2/` (CEILING = 1.5, REUSE_V1 = false, claude.exe spawn; amendment 1) |

Note on v1: the three text-file hashes in v1's lock match the LF-normalized files. The files on disk have CRLF line endings, so a raw `sha256sum` does not match. The content is the same as v1 locked.

Any change to a locked file after this lock voids the pilot, as in v1.

## Budget (USD)
- **Pilot ceiling: 1.50** (user's choice). Same as v1. Clean v1 spend was about 0.2 without the Haiku anomaly.
- Per-call caps (`--max-budget-usd`): Haiku 0.10, Sonnet 0.40, Opus 0.60, grader (Sonnet) 0.40. Same as v1.
- JEV: if no cost comes back, 0.05 per call is charged.
- If the CLI returns no `total_cost_usd`, the full cap is charged.
- Retries: **0**. Extra gradings: **0**. Escalations: none.
- Calls if nothing halts: 1 Haiku + 3 JEV + Sonnet and Opus + 3 gradings = 9 (fewer if A and C are reused).

## Reuse of v1 answers for A and C: re-run all three (user's choice)
- Chosen: every call is new under v2. Simplest provenance. Extra cost about the v1 A and C generation plus grading.
- Option "reuse A and C": answers and gradings from v1 are copied in with `reusedFrom: pilot v1` and charged 0 to v2. Only B is generated and graded under v2. Provenance caveat: v1 ran under a runner with different paths, so it may have run on another machine. Reuse is valid only if the user confirms the v1 setup was the same.

## Labels
- Blind label map: A = opus, B = haiku, C = sonnet. The grader sees only the letter. The map is written to `results/summary.json` after grading.

## Stop rule
- The runner runs once. If `results/` exists, it refuses to run again.
- Halt on the first error or over-cap call. After a halt, no further model call runs.

## Known limits (same as v1)
- Story attachments (screenshots) are not given to the models or the grader.
- The grader does not see model names. Answer style may reveal the tier; accepted and recorded.
- Grader is the same family (Sonnet). Agreement is not measured here.
