# haiku-build

A bmad-build style workflow for Claude Code that keeps the main session on **Haiku 5.5** and calls **Opus** only twice: once to write the spec and once to review the diff. Every Haiku request is checked against the 100k input-token price step.

```text
01 Intake -> 02 Plan (Opus) -> 03 Build & Test (Haiku) -> 04 Review (Opus, 3 lenses) -> 05 You decide:
   [1] Fix and report   or   [2] Not approved, report
```

Each run writes a folder with `spec.md`, the diff, test logs, the review, `manifest.json` and a `report.html` built from measured data only.

## Requirements

- Claude Code with Haiku 5.5 and Opus available.
- Node.js 22 or newer. The scripts use only Node built-ins (no `npm install`).

## Install

The skill ships inside the **haiku-100k** plugin, which also provides the parts that keep every Haiku request under 100k input tokens. Install the plugin once:

```bash
claude plugin marketplace add <path-to>/haiku-100k
claude plugin install haiku-100k@haiku-100k
```

Then run `/haiku-100k:setup` once in Claude Code. The plugin's hooks need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. The skill is then available as `haiku-100k:haiku-build`.

Check the install:

```bash
node --test "<path-to>/haiku-100k/skills/haiku-build/tests/*.test.mjs"
```

All tests should pass.

## Use it

1. Open Claude Code in the project you want to change and switch the model to Haiku 5.5. The skill stops at step 01 if the main model is not Haiku.
2. Ask for the change, for example: "Use haiku-100k:haiku-build: the overtime tab should list only employees with overtime records in the selected range."
3. Answer the questions it asks:
   - **Blocking questions** from the spec (only if Opus finds some), asked once before the build.
   - **[R] retry / [S] skip** if an Opus call returns an invalid result.
   - **[1] / [2]** after the review.
4. Open `reports/haiku-build/<runId>/report.html`.

Nothing is committed, pushed or opened as a PR unless you ask.

## What a run costs and guarantees

- **Opus:** at most 2 calls per run (plan and review). A retry needs your OK and is logged.
- **Opus input:** closed packs only. Opus never reads files; the main session pastes what it needs.
- **Opus output:** at most 800 words, checked by a script. Over the limit is a failed call, never cut to fit.
- **Haiku:** every request is measured from the transcript. The report says `pass`, `fail` or `not_measured`; it never claims the limit held without data.

## Tested

| Check | Result |
|---|---|
| Unit tests (`tests/*.test.mjs`) | all pass |
| Toy repo, 4 runs | `[1]` and `[2]` both exercised; per-request Haiku check measured on run 4: 283 requests, max 92,209 tokens, 0 over 100k |
| Real .NET repo, ADO bug (run in a fresh Haiku session) | the fix matched the merged human PR line for line; review: 5 Minor findings, 3 fixed with new tests, 2 rejected with code refs; 100/100 tests pass; 66 Haiku requests, max 91,503 tokens, 0 over 100k |

Confirmed in live runs on a toy repo:

- **Blocking question** answered by the user: the plan returned 4 questions, and the answers appear in the report's Decisions section. Haiku check: pass, 44 requests, max 91,246 tokens.
- **`[R]` retry** after a failed review: a prose hand-back was rejected by `save_opus.mjs`, and the retry was saved as attempt 2.
- **`[S]` skip** after a failed review: status `REVIEW_SKIPPED`, and the report says the code was not independently reviewed.

Two of those runs used a hand-made manifest without phase windows, so their Haiku check is `not_measured`.

Not confirmed live: **a review with no findings** (option `[1]` = re-verify only). Even on a trivial change, Opus returned 2 Minor findings, and both were rejected after reading the full file. The review pack then left out the body of the changed function. Step 04 now includes it, which should make empty reviews more likely, but this path is still covered only by unit tests.

## Files

| Path | Role |
|---|---|
| `SKILL.md` | entry point and rules |
| `steps/step-01..05-*.md` | one file per step |
| `prompts/plan-opus.md`, `prompts/review-opus.md` | the two Opus prompts |
| `templates/spec.md` | the 9-section spec Opus fills in |
| `schemas/haiku-build-manifest.schema.json` | `manifest.json` layout |
| `scripts/*.mjs` | transcript lookup, phase windows, hand-back saving, measurement, report |
| `tests/*.test.mjs` | unit tests for every script |
