# haiku-build

A bmad-build style workflow for Claude Code (v2, seven stages) that implements, tests and fixes on **Haiku 5.5**, calls **Opus** only once, to write the spec, and reviews the diff with three parallel **Sonnet** reviewers. Every stage is routed to a model by a script, test runs follow a fixed retry ladder, and a script sets the final status. Every Haiku request is checked against the 100k input-token price step.

```text
01 Intake (main session) -> 02 Plan (Opus) -> 03 Implement (Haiku, 1 Sonnet fallback) -> 04 Test (Haiku)
   -> 05 Review (3 parallel Sonnet reviewers + triage) -> 06 Fix (Haiku, max 1 Sonnet re-review)
   -> 07 Present: done | done_with_findings | blocked
```

- **Main session:** a Haiku or Sonnet start keeps its model; no start model means Sonnet; an Opus or Fable start asks once, `switch main session to Sonnet?`.
- **Models:** Opus only for the plan (the JEV intake advice may pick Sonnet, logged); Haiku for implement, test and fix; Sonnet for the review, the one implement fallback and the one re-review.
- **Retry ladder:** T1 (Haiku), T2 (Haiku), one Sonnet retry (the implement fallback), T3 (Haiku). A failure after T3 makes the run `blocked`; no further retry.
- **Final status:** `blocked` when a required artifact is missing (named) or tests still fail; `done_with_findings` when a finding is open; else `done`.
- **JEV (optional):** `HAIKU_BUILD_JEV=apply|off` (default `apply`) gives advice at intake, recovery and triage only, at most 3 calls, used only at confidence 0.8 or more within 3000 ms. It never sets a status, passes an acceptance criterion or lowers a severity.

Each run writes a folder with `spec.md`, the diff, test logs, the review, `manifest.json` and a `report.html` built from measured data only.

## Requirements

- Claude Code with Haiku 5.5, Sonnet and Opus available.
- Node.js 22 or newer. The scripts use only Node built-ins (no `npm install`).

## Install

The skill ships inside the **haiku-100k** plugin, which also provides the parts that keep every Haiku request under 100k input tokens. Install the plugin once, from GitHub:

```bash
claude plugin marketplace add danhnguyen-xiontechs/laya-claude-code-integration --sparse .claude-plugin haiku-100k
claude plugin install haiku-100k@danhnguyen-xiontechs
```

From a clone you already have, run `claude plugin marketplace add <path-to-clone>` instead of the first line. Updating is covered in the plugin's `README.md` (`haiku-100k/README.md`, section Install).

Then run `/haiku-100k:setup` once in Claude Code. The plugin's hooks need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. The skill is then available as `haiku-100k:haiku-build`.

Check the install:

```bash
node --test "<path-to>/haiku-100k/skills/haiku-build/tests/*.test.mjs"
```

All tests should pass.

## Use it

1. Open Claude Code in the project you want to change, ideally on Haiku 5.5 or Sonnet. On Opus or Fable the skill asks once whether to switch the main session to Sonnet. It stops at stage 01 if Node is older than 22 or `/haiku-100k:setup` was not run.
2. Ask for the change, for example: "Use haiku-100k:haiku-build: the overtime tab should list only employees with overtime records in the selected range."
3. Answer the questions it asks:
   - **Blocking questions** from the spec (only if the plan lists some), asked once before Implement.
   - **[R] retry / [S] skip** if the plan or the merged review fails its check.
   - **switch main session to Sonnet?** only when the session started on Opus or Fable.

   Triage, fixes and the final status need no answer.
4. Open `reports/haiku-build/<runId>/report.html`.

Nothing is committed, pushed or opened as a PR unless you ask.

## What a run costs and guarantees

- **Opus:** one call per run, the plan. A retry needs your OK and is logged.
- **Sonnet:** three parallel reviewers, at most one implement fallback and at most one re-review.
- **Closed packs:** the plan model and the reviewers never read files; the main session pastes what they need.
- **Output:** the three review arrays together are at most 800 words, checked by a script (over it is a failed call, never cut to fit). The plan is never rejected for length: over 1600 words it is saved with an `oversized` warning.
- **Haiku:** every request is measured from the transcript. The report says `pass`, `fail` or `not_measured`; it never claims the limit held without data.

## Tested

The live runs below used v1 (five steps), whose review and decision steps v2 replaces. The v2 routing, retry ladder, final status, JEV advice and preflight are covered by unit tests (`tests/story-2268-ac*.test.mjs`) and have not yet been run live.

| Check | Result |
|---|---|
| Unit tests (`tests/*.test.mjs`) | all pass |
| Toy repo, 4 runs | both v1 post-review paths exercised; per-request Haiku check measured on run 4: 283 requests, max 92,209 tokens, 0 over 100k |
| Real .NET repo, ADO bug (run in a fresh Haiku session) | the fix matched the merged human PR line for line; review: 5 Minor findings, 3 fixed with new tests, 2 rejected with code refs; 100/100 tests pass; 66 Haiku requests, max 91,503 tokens, 0 over 100k |

Confirmed in live runs on a toy repo:

- **Blocking question** answered by the user: the plan returned 4 questions, and the answers appear in the report's Decisions section. Haiku check: pass, 44 requests, max 91,246 tokens.
- **`[R]` retry** after a failed review: a prose hand-back was rejected by `save_opus.mjs`, and the retry was saved as attempt 2.
- **`[S]` skip** after a failed review: status `REVIEW_SKIPPED`, and the report says the code was not independently reviewed.

Two of those runs used a hand-made manifest without phase windows, so their Haiku check is `not_measured`.

Not confirmed live: **a review with no findings** (re-verify only). In v1, even a trivial change got 2 Minor findings, and both were rejected after reading the full file. The review pack then left out the body of the changed function. Step 05 now includes it, which should make empty reviews more likely, but this path is still covered only by unit tests.

## Files

| Path | Role |
|---|---|
| `SKILL.md` | entry point and rules |
| `steps/step-01..07-*.md` | one file per stage |
| `prompts/plan-opus.md` | the Opus plan prompt |
| `prompts/review.md` | the Sonnet reviewer prompt (one lens per reviewer, JSON array output) |
| `templates/spec.md` | the 9-section spec Opus fills in |
| `schemas/haiku-build-manifest.schema.json` | `manifest.json` layout |
| `scripts/*.mjs` | preflight, stage routing, retry ladder and final status, JEV advice, transcript lookup, phase windows, hand-back saving, measurement, report |
| `tests/*.test.mjs` | unit tests for every script |
