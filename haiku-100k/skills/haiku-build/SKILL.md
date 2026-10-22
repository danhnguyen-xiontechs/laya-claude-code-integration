---
name: haiku-build
description: Build one change with the bmad-build flow, the main session on Haiku (haiku-100k base). Opus plans the spec (its only call), Haiku implements and runs unit tests on a fixed retry ladder, parallel Sonnet reviewers review the diff and the main session triages the findings, Haiku fixes with at most one Sonnet re-review, and a script sets the final status (done, done_with_findings, blocked). Use when the user wants bmad-build on Haiku.
---

# haiku-build (v2)

The bmad-build flow in seven stages, each routed to a model by a script. Opus is used only for the plan. Implement, test and fix run on Haiku; the review runs on parallel Sonnet reviewers. Every run is measured from the session transcript, including a per-request check that no Haiku request went over 100k input tokens.

## Requirements

- Claude Code with access to Haiku 5.5, Sonnet and Opus (subagent calls through the Agent tool).
- The `haiku-100k` plugin, which this skill ships in, set up once per machine (`/haiku-100k:setup`). See `README.md`.
- Node.js 22 or newer for the scripts and tests. No npm packages.

`<skill-dir>` in the steps is this skill's folder: the base directory Claude Code shows when the skill loads. Scripts are always called by that full path, so a run works from any project folder.

## Flow

| Stage | File | Model (`scripts/routing.mjs`) | Output |
|---|---|---|---|
| 01 Intake | `steps/step-01-intake.md` | main session: the start model, default Sonnet | preflight, routing, run folder, `manifest.json` |
| 02 Plan | `steps/step-02-plan.md` | Opus (Sonnet only if the JEV intake advice picks it, logged), one closed call | `spec.md` |
| 03 Implement | `steps/step-03-implement.md` | Haiku, one Sonnet fallback | code change, `evidence/diff.patch` |
| 04 Test | `steps/step-04-test.md` | Haiku, retry ladder (its Sonnet rung is the 03 fallback) | `evidence/unit-tests.log`, `attempts` |
| 05 Review | `steps/step-05-review.md` | three parallel Sonnet reviewers, one per lens; triage in the main session | `evidence/review.json`, triaged findings |
| 06 Fix | `steps/step-06-fix.md` | Haiku, at most one Sonnet re-review | fixes, tests re-run, new diff |
| 07 Present | `steps/step-07-present.md` | main session | `finalStatus`, `report.html` |

**Main session model.** Haiku or Sonnet start: kept. Unknown or no start model: Sonnet. Opus or Fable start: the user is asked once, `switch main session to Sonnet?`; yes routes the main stages to Sonnet, no keeps the start model. No other start model yields a question.

## Rules

- **Preflight first.** `scripts/preflight.mjs` runs before anything else. Node older than 22 or no haiku-100k setup stops the run with its message; no subagent is started.
- **Every stage has a model**, from `scripts/routing.mjs`, stored as `manifest.routing` with each stage's `fallback` (03: one Sonnet fallback; 06: at most one Sonnet re-review). Never pick a stage model by hand.
- **Retry ladder.** Test runs follow `T1` (Haiku), `T2` (Haiku), one `sonnet-retry` (the 03 Sonnet fallback), `T3` (Haiku, final verification). Each run is recorded with `scripts/status.mjs record`; after a failed `T3`, `status.mjs next` refuses any further retry and the run is `blocked`, with the ladder named in the reason.
- **Final status** comes only from `scripts/status.mjs final`: `blocked` if a required artifact is missing (named in the reason) or tests still fail, else `done_with_findings` if a finding is open, else `done`. Required artifacts: `manifest.json`, `spec.md`, `evidence/diff.patch`, `evidence/unit-tests.log`, `evidence/review.json`. A missing one is a failure.
- **JEV is advisory and optional.** `HAIKU_BUILD_JEV=apply|off`, default `apply`. Only at intake (plan model, stage 01), recovery (retry approach, stage 04) and triage (severity, stage 05), through `scripts/jev_advice.mjs`; at most 3 calls per run. Its pick is used only at confidence 0.8 or more within 3000 ms; off, an error, a timeout, low confidence, an unknown answer or the call limit all keep the baseline, logged with the reason in `manifest.jev.calls`. With `off` no call is made. JEV never sets a status, passes an acceptance criterion or lowers a severity.
- **Opus only for the plan:** one call per run. A retry needs the user's OK and is logged in `manifest.json` `opusCalls` with `retryApprovedBy` and `retryAt`. A second call is never made silently. The review also saves a record in `opusCalls` (`step: "04-review"`, a historical name from v1); that record is not an Opus call.
- **Closed packs.** The plan model and the reviewers never read files or explore the repo. The main session pastes everything they need into the prompt (`prompts/plan-opus.md`, `prompts/review.md`).
- **Output limit: 800 words**, checked by `scripts/build_report.mjs` (`checkOpusOutput`) for the plan and for the three review arrays together (250 words per reviewer). Over the limit is a failed call. Nothing is cut to fit. The spec must also have the four required headings (`checkSpecSections`): Goal & Intent, Tasks & Acceptance Criteria, Red Checks, Verification.
- **Questions.** At most: the switch question (Opus/Fable start, once), the spec's blocking questions (once, in step 02), and `[R] retry` / `[S] skip` after a plan or review hand-back fails its check. Triage, the fix decision and the final status ask nothing.
- **Blocking questions.** The spec's section 3 may list questions that stop correct work. Step 02 asks them once; the answers go to `manifest.json` `planAnswers` and are authoritative for Implement, Review and the report's Decisions section.
- **Hand-backs go to disk at once.** Plan and review calls run in the foreground. The plan is saved with `save_opus.mjs plan` and the merged review with `save_opus.mjs review` in the turn the text arrives (the script name is historical; it saves any hand-back). `tasks/*.output` is never evidence. After a compaction, check the saved file, `opusCalls`, then the transcript before recording a call as lost.
- **Failed hand-back policy.** Ask the user once: `[R] retry` or `[S] skip`.
  - Plan fails and user picks `[S]`: stop the build, status `PLAN_FAILED`, final status `blocked`, `INCOMPLETE` report. Never assume a spec.
  - Review fails and user picks `[S]`: status `REVIEW_SKIPPED`; `evidence/review.json` is missing, so the final status is `blocked`, and the report says the code was **not independently reviewed**.
- **100k input rule.** Every Haiku request stays under 100k input tokens (`/haiku-100k:setup` run once per machine). For broad searches, use `haiku-100k:haiku-case`. The limit is checked per request from the transcript (`scripts/usage_by_phase.mjs`). Without transcript data the report says `not_measured`; never claim the limit held without it.
- **No commit, no push, no PR** unless the user asks.
- **Quiet output.** One summary line per script. Never paste long logs or diffs into chat; point to the file.
- **Tests run offline.** The unit test command comes from `spec.md`.

## Run folder

`reports/haiku-build/<runId>/` in the project root (or a folder the user names), with `runId` = `YYYYMMDD-<short-slug>-01`.

```text
manifest.json              # schemas/haiku-build-manifest.schema.json
spec.md                    # stage 02
evidence/diff.patch        # stages 03, 04 and 06
evidence/unit-tests.log    # stages 04 and 06
evidence/review.json       # stage 05
evidence/re-review.json    # stage 06, only when the Sonnet re-review ran
evidence/phase-usage.json  # built by build_report.mjs
report.html                # built by build_report.mjs, never hand-written
```

## Scripts

All scripts print one summary line and are run as `node "<skill-dir>/scripts/<name>.mjs" ...`.

- `scripts/preflight.mjs [--settings <file>]`: Node 22+ and haiku-100k setup check; exit 1 with a message when the run cannot start (stage 01).
- `scripts/routing.mjs <startModel> [--switch yes|no] [--plan-advice opus|sonnet] [--write <runDir>]`: the model and fallback of every stage and the switch question, stored as `manifest.routing` (stage 01).
- `scripts/status.mjs <runDir> next | record pass|fail | final`: the retry ladder (stages 04, 06) and the final status (stage 07).
- `scripts/jev_advice.mjs <runDir> <intake|recovery|triage> <baseline> <choices> [--state "<text>"]`: optional JEV advice through `subagent-model-router/scripts/decision-provider.mjs`, logged in `manifest.jev` (stages 01, 04, 05).
- `scripts/find_transcript.mjs <runId> --write <runDir>`: finds the session transcript and stores it as `manifest.transcript` (stage 01).
- `scripts/phase.mjs <runDir> start <phase> | end`: opens and closes phase windows (`01-intake` .. `07-present`) with the real clock. Never type a timestamp.
- `scripts/save_opus.mjs plan|review <runDir> <textFile> [--attempt N --approved-by "<words>"]`: saves a plan or review hand-back, checks it, and records the `opusCalls` entry (stages 02 and 05). The name is historical: the review it saves comes from the Sonnet reviewers.
- `scripts/build_report.mjs <runDir>`: measures the run, writes `phase-usage.json`, rewrites `manifest.json` measured fields, writes `report.html`.
- `scripts/usage_by_phase.mjs <session.jsonl> <manifest.json>`: per-phase usage and the per-request Haiku check.
- `scripts/report_style.mjs`: the report's CSS.
- `templates/spec.md`: spec layout: nine sections (Goal & Intent, Boundaries, Assumptions / Blocking Questions, Code Map, Behavior & Edge Cases, Tasks & Acceptance Criteria, Red Checks, Verification, Implementation Notes). Target 500–700 words.

## Tests

```bash
node --test "<skill-dir>/tests/*.test.mjs"
```

No test makes a network call: JEV is always replaced by an injected `ask`.
