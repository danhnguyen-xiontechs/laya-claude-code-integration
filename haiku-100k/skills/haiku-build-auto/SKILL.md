---
name: haiku-build-auto
description: Unattended haiku-build v2. One invocation takes a change (spec folder + story id, free intent, or a run folder to resume) through the seven haiku-build stages to one terminal status (done, done_with_findings, blocked) with no human interaction; every stage decision comes from scripts/auto.mjs. Use when invoked by name or by a factory run.
---

# haiku-build-auto

The haiku-build v2 flow (Opus plan, Haiku implement and test, three parallel Sonnet reviewers, Haiku fix), run without a human. The stage mechanics are haiku-build's own step files; every point where haiku-build would ask the user is decided by `scripts/auto.mjs` instead.

**v3 helpers (shared with manual haiku-build, same contract).** `auto.mjs` imports haiku-build's `ac_map.mjs` (through `savePlanSpec`: `manifest.acMap`, warning `ac-unmapped`), `failure.mjs` (a record in `manifest.failures` for every failed plan, review, re-review and test run; the recovery advice `state` is `recoveryState`, and the `sonnet-retry` / `fix-tests` requests carry the last record as `failure`), `context_bundle.mjs` (built before the plan call, each review attempt and each re-review, passed to the subagent as `context`) and `run_metrics.mjs` (`manifest.metrics` and `result.json.metrics` at every end, blocked runs included). No new JEV call, no new question; the ladder, gates and statuses are unchanged.

`<skill-dir>` is this skill's folder and `<hb-dir>` is the sibling `haiku-build` skill folder (`<skill-dir>/../haiku-build`). Scripts are called by full path: `node "<skill-dir>/scripts/auto.mjs" ...`, `node "<hb-dir>/scripts/<name>.mjs" ...`.

## Unattended rules

- **Always run the full flow, however small the story.** Every story goes through `auto.mjs start`, the Opus plan, Haiku implement and test, the Sonnet review and `auto.mjs finish`, even a one-line change. Never edit the code yourself from the main session as a shortcut: without `spec.md`, `result.json` and the commit from `finish`, the factory blocks the story (`no story spec written`). Story size, a prompt saying "build the story" or a plan that already looks obvious never justifies skipping a stage.
- **Test names follow `tests.json`.** Under folder+id dispatch, read the cases of this story in `<specFolder>/tests.json` when it exists. Each test-name filter in a case's `command` (for example `--filter "FullyQualifiedName~Story2295_AC2_Order"`, `-t`, `-k`, `--grep`) is a name the tests must carry: pass the list to the plan model (the spec's test plan names them) and to the Haiku implement and fix calls, and every filter must match at least one new test. Before review, check each filter against the test names in the diff; a filter with no match is a test failure for the ladder (Haiku renames or adds the test), not something to leave to the factory.
- **Never ask the user anything.** No switch question, no blocking questions, no `[R] retry` / `[S] skip`, no approval, no "should I continue?". Never end a turn waiting for input. Where a haiku-build step says "ask the user", do what this file says instead.
- **Three terminal statuses only:** `done`, `done_with_findings`, `blocked`. Every run ends in exactly one, written by `auto.mjs` (`finish` or `halt`), never typed by hand.
- **`blocked` names its condition and exits 1.** On any blocking condition run `node "<skill-dir>/scripts/auto.mjs" halt <runDir> "<condition>"` and stop.
- **Subagents are mandatory.** If the Agent tool is unavailable or a subagent call fails, halt with `no subagents`. Run every subagent in the foreground (`run_in_background: false`), all calls of one stage in one message.
- **Commit at the end, never push, no PR** (as bmad-build-auto). A run that ends `done` or `done_with_findings` commits every change of the working tree on the current branch, by `auto.mjs finish` itself. Nothing is committed before the end, and a `blocked` run leaves the tree as it is. A commit error ends the run `blocked` (`commit failed`). One story per invocation; the only halt after planning is plan-only mode (below).
- **Quiet output.** One line per script; point to files, never paste logs or diffs.

## Dispatch

| Mode | Input | Intent |
|---|---|---|
| Folder+id | spec folder + story id | Read `<specFolder>/stories.yaml` yourself, take the entry's `title`, pass it as `--title` (the script parses no YAML). |
| Free intent | task text | `--task "<text>"`. |
| Resume | an existing run folder | `start` finds `manifest.json` and continues from the first stage without its output (`spec.md`, a passing ladder rung, `review`, `auto.fixRounds`). |

Nothing to work from (no task, no folder+id title, no resumable run) halts `intent gap`.

**Plan at intake (xt-factory `planAtIntake`).** Under folder+id dispatch:

- **Plan-only mode**: the prompt says `Halt after planning.` Run Start and Plan (stages 1-2; put the prompt's planning instructions, such as the Code Map paths and the `## Contracts` section, into `TASK:` of the plan prompt), then `node "<skill-dir>/scripts/auto.mjs" plan-only <runDir>`: it writes the plan as the story spec with status `ready-for-dev` and you stop. No implement, no review, no `finish`, no commit. A planner with blocking questions it cannot settle from the spec halts `intent gap` with them instead (`auto.mjs halt <runDir> "intent gap" --reason "<the questions>"`): at intake a person answers them.
- **Reuse**: `start` prints `plan: reused` when the story spec was planned and accepted at intake (status `ready-for-dev`): the plan is already `spec.md`, so skip stage 2 and go to Implement.
- **Refresh**: `start` prints `plan: refreshed` and `previousPlan` when the story spec is `draft` with a `## Replan note` (the files it planned changed since): run stage 2 on the routed model (Sonnet) with the text of `previousPlan` added to the plan prompt as `PREVIOUS PLAN:`; keep its intent and change only what the note names.

## Stage order

1. **Start (01 Intake).** `node "<skill-dir>/scripts/auto.mjs" start <runDir> --model <startModel> [--task "<text>"] [--spec-folder <dir> --story-id <id> --title "<title>"]`. It runs haiku-build's preflight, requires a clean working tree for a new run, checks the story file match, takes the optional JEV intake advice, routes the stages with the switch question answered `yes` for an Opus or Fable start (main session on Sonnet; Haiku and Sonnet starts keep their model) and writes `manifest.json`. Exit 1 means it already halted: stop. `runDir` is `reports/haiku-build/<runId>/` as in haiku-build.
2. **Plan (02).** Follow `<hb-dir>/steps/step-02-plan.md` items 1-4, with the plan model from `manifest.routing`. Instead of `save_opus.mjs`, save the hand-back with `auto.mjs gate plan <runDir> <textFile>`:
   - `action: continue`: go on. Blocking questions in the spec are not asked: take the spec's assumptions (section 3) or boundaries (section 2); where they point nowhere, take the smallest safe behaviour, and record each pick in `planAnswers` as `no preference -> <pick>`.
   - `action: retry`: call the plan model once more and run `gate plan` again (the script records attempt 2, approved by `haiku-build-auto (automatic retry)`).
   - exit 1: the run halted `plan failed twice`. Stop.
3. **Implement (03) and Test (04).** Follow `<hb-dir>/steps/step-03-implement.md` and `step-04-test.md`, recording each test run with `node "<hb-dir>/scripts/status.mjs" <runDir> record pass|fail`. When `record` exits 1 (a failed `T3` used up the ladder) or `next` prints `refused`, run `auto.mjs halt <runDir> "retry ladder used up"` and stop.
4. **Review (05).** Follow `<hb-dir>/steps/step-05-review.md` items 1-3 and 5-6 (three parallel Sonnet reviewers, triage). Save the merged arrays with `auto.mjs gate review <runDir> <textFile>`: `continue`, `retry` (call the three reviewers once more) or exit 1 (`review failed twice`, stop). Never skip the review.
5. **Fix loop (06).** Run `auto.mjs round <runDir>`:
   - `action: fix`: Haiku fixes every open finding, Minor as well as Major (`<hb-dir>/steps/step-06-fix.md` item 2), then re-run the tests (one more Haiku fix and re-run if they fail; still failing: `halt "tests still fail"`), save the diff, and get one Sonnet re-review (`blind-hunter`, as in step 06 item 6). Write its JSON array to a file and run `auto.mjs round <runDir> --re-review <file>`: the re-review findings replace the open list, and the script decides the next round. A re-review that is not a valid array prints `action: retry` once; a second one halts `review failed twice`.
   - `action: finish`: no Major is open. Go to 07.
   - exit 1: a Major was still open after round 3: `review repair loop exceeded 3 iterations`. Stop.
6. **Present (07).** `node "<skill-dir>/scripts/auto.mjs" finish <runDir>` from the repository root (the directory whose working tree holds the change), then `node "<hb-dir>/scripts/build_report.mjs" <runDir>`. `finish` takes the final status from haiku-build's `status.mjs` (`finalStatus`): `blocked` when a required artifact is missing or tests fail, `done_with_findings` when only findings remain open (Minor), else `done`. A run that is not blocked then commits the working tree (`--no-commit` leaves it), leaving out the run folder itself when it lies inside the repository: `result.json` and `manifest.auto.commit` carry the sha. Never run `git commit` yourself. Report the status, its condition, the commit (or that none was made) and the report path in four lines.

## Blocking conditions

`preflight failed`, `dirty working tree`, `intent gap`, `ambiguous story file match`, `no subagents`, `plan failed twice`, `review failed twice`, `retry ladder used up`, `tests still fail`, `review repair loop exceeded 3 iterations`, `commit failed`. Each one ends the run `blocked`, exit 1.

## Result

Every end (`finish` or `halt`) writes:

- `<runDir>/result.json`: `status`, `condition` (null unless blocked), `reason`, `exitCode`, `runId`, `specFile`, `commit` (`{ committed, sha, reason }`, null when no commit was attempted), `metrics` (per-stage durations, attempt counts, test outcomes, repeated failures; unavailable ones listed in `metrics.missing`), `at`;
- `manifest.json` `finalStatus` / `finalReason`, `auto.status` / `auto.condition` and `auto.commit` (`committed`, `sha`, `files`, `message`, `at`);
- under folder+id dispatch, the story spec `<specFolder>/stories/<id>-<slug>.md`: frontmatter `status` set to the terminal status and the result appended under `## Auto Run Result` (the file is created when missing). More than one file matching `<id>-*.md` halts `ambiguous story file match` and writes to `<id>-ambiguous.md`.

## Scripts

- `scripts/auto.mjs start | gate plan|review | round | halt <condition> | finish`: the stage gates above; one JSON line each. Its exports (`runAuto`, `autoRouting`, `handBackGate`, `reviewRound`, `autoFinal`, `specFileFor`, `writeResult`, `writeBackSpec`, `halt`, `commitRun`, `gitCommitAll`) drive a whole run with the Agent tool, the test runner and JEV injected.
- Reused from haiku-build: `status.mjs` (ladder, final status), `routing.mjs`, `preflight.mjs`, `jev_advice.mjs`, `save_opus.mjs`, `phase.mjs`, `build_report.mjs`, and the v3 helpers `ac_map.mjs`, `failure.mjs`, `context_bundle.mjs`, `run_metrics.mjs`. In stage-by-stage mode, build the bundle with `node "<hb-dir>/scripts/context_bundle.mjs" <runDir> <stage>` before the plan and review calls (stages 2, 4, 5); `gate` and `round` record failed hand-backs and invalid re-reviews themselves.

## Tests

```bash
node --test "<skill-dir>/tests/*.test.mjs"
```

No test makes a network call: the Agent tool, the test runner and JEV `ask` are injected.
