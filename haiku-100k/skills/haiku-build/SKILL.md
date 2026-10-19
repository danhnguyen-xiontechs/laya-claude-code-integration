---
name: haiku-build
description: Build one change with the bmad-build flow, the main session on Haiku (haiku-100k base). Opus plans the spec, Haiku implements and runs unit tests, Opus reviews with three lenses, the user chooses fix-and-report or not-approved-report. Use when the user wants bmad-build on Haiku.
---

# haiku-build

The bmad-build flow with the main session on Haiku. Opus does two closed calls (plan, review). Haiku does everything else. Every run is measured from the session transcript, including a per-request check that no Haiku request went over 100k input tokens.

## Requirements

- Claude Code with access to Haiku 5.5 (main session) and Opus (subagent calls through the Agent tool).
- The `haiku-100k` plugin, which this skill ships in, set up once per machine (`/haiku-100k:setup`). See `README.md`.
- Node.js 22 or newer for the scripts and tests. No npm packages.

`<skill-dir>` in the steps is this skill's folder: the base directory Claude Code shows when the skill loads. Scripts are always called by that full path, so a run works from any project folder.

## Flow

| Step | File | Who | Output |
|---|---|---|---|
| 01 Intake | `steps/step-01-intake.md` | main session (Haiku) | run folder, `manifest.json` |
| 02 Plan | `steps/step-02-plan.md` | Opus medium, one closed call | `spec.md` |
| 03 Build & Test | `steps/step-03-build-test.md` | main session (Haiku) | code change, `evidence/unit-tests.log`, `evidence/diff.patch` |
| 04 Review | `steps/step-04-review.md` | Opus medium, one closed call, three lenses | `evidence/review.json` |
| 05 Decide & Report | `steps/step-05-decide-report.md` | main session (Haiku) | `report.html`, final `manifest.json` |

## Rules

- **Models.** The main session must be Haiku 5.5 (`claude-haiku-5-5`). If it is not, stop at step 01 and tell the user to switch. Opus is used only through the Agent tool, `model: "opus"`, `effort: "medium"`, and only in steps 02 and 04.
- **Opus is at most 2 calls per run** (plan, review). A retry needs the user's OK and is logged in `manifest.json` `opusCalls` with `retryApprovedBy` and `retryAt`. A third call is never made silently.
- **Closed packs.** Opus never reads files or explores the repo. The main session pastes everything it needs into the prompt (`prompts/plan-opus.md`, `prompts/review-opus.md`).
- **Opus output limit: 800 words**, checked by `scripts/build_report.mjs` (`checkOpusOutput`). Over the limit is a failed call. Nothing is cut to fit. The spec must also have the four required headings (`checkSpecSections`): Goal & Intent, Tasks & Acceptance Criteria, Red Checks, Verification.
- **Blocking questions.** The spec's section 3 may list questions that stop correct work. Step 02 asks them once; the answers go to `manifest.json` `planAnswers` and are authoritative for Build, Review and the report's Decisions section. No extra Opus call.
- **Opus hand-backs go to disk at once.** Opus calls run in the foreground. The plan is saved with `savePlanSpec` and the review to `evidence/review-raw.json` in the turn the text arrives. `tasks/*.output` is never evidence (it is empty for hand-back agents). After a compaction, check the saved file, `opusCalls`, then the transcript before recording a call as lost.
- **Failed Opus call policy.** Ask the user once: `[R] retry` or `[S] skip`.
  - Plan fails and user picks `[S]`: stop the build, status `PLAN_FAILED`, write an `INCOMPLETE` report. Never assume a spec.
  - Review fails and user picks `[S]`: skip the review, status `REVIEW_SKIPPED`, and the report says the code was **not independently reviewed**.
- **100k input rule.** Every Haiku request stays under 100k input tokens. Use the `haiku-100k` plugin (`/haiku-100k:setup` run once per machine). For broad searches, use `haiku-100k:haiku-case`. The limit is checked per request from the transcript (`scripts/usage_by_phase.mjs`). Without transcript data the report says `not_measured`; never claim the limit held without it.
- **No commit, no push, no PR** unless the user asks.
- **Quiet output.** One summary line per script. Never paste long logs or diffs into chat; point to the file.
- **Tests run offline.** The unit test command comes from `spec.md`.

## Run folder

`reports/haiku-build/<runId>/` in the project root (or a folder the user names), with `runId` = `YYYYMMDD-<short-slug>-01`.

```text
manifest.json            # schemas/haiku-build-manifest.schema.json
spec.md                  # step 02
evidence/diff.patch      # step 03
evidence/unit-tests.log  # step 03
evidence/review.json     # step 04
evidence/phase-usage.json  # built by build_report.mjs
report.html              # built by build_report.mjs, never hand-written
```

## Scripts

All scripts print one summary line and are run as `node "<skill-dir>/scripts/<name>.mjs" ...`.

- `scripts/find_transcript.mjs <runId> --write <runDir>`: finds the session transcript and stores it as `manifest.transcript` (step 01).
- `scripts/phase.mjs <runDir> start <phase> | end`: opens and closes phase windows with the real clock (every step). Never type a timestamp.
- `scripts/save_opus.mjs plan|review <runDir> <textFile> [--attempt N --approved-by "<words>"]`: saves an Opus hand-back, checks it, and records the `opusCalls` entry, with the user's approval on a retry (steps 02 and 04).
- `scripts/build_report.mjs <runDir>`: measures the run, writes `phase-usage.json`, rewrites `manifest.json` measured fields, writes `report.html`.
- `scripts/usage_by_phase.mjs <session.jsonl> <manifest.json>`: per-phase usage and the per-request Haiku check.
- `scripts/report_style.mjs`: the report's CSS.
- `templates/spec.md`: spec layout: nine sections (Goal & Intent, Boundaries, Assumptions / Blocking Questions, Code Map, Behavior & Edge Cases, Tasks & Acceptance Criteria, Red Checks, Verification, Implementation Notes). Target 500–700 words.

## Tests

```bash
node --test "<skill-dir>/tests/*.test.mjs"
```
