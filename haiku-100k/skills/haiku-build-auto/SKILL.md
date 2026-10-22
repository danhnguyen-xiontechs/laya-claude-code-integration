---
name: haiku-build-auto
description: Unattended haiku-build v3. One invocation takes a change (spec folder + story id, free intent, or a run folder to resume) through the seven haiku-build stages to one terminal status (done, done_with_findings, blocked) with no human interaction; every stage decision comes from scripts/auto.mjs. Use when invoked by name or by a factory run.
---

# haiku-build-auto

The haiku-build v3 flow (Opus plan, Haiku implement and test, three parallel Sonnet reviewers, Haiku fix), run without a human. The stage mechanics are haiku-build's own step files; every point where haiku-build would ask the user is decided by `scripts/auto.mjs` instead.

`<skill-dir>` is this skill's folder and `<hb-dir>` is the sibling `haiku-build` skill folder (`<skill-dir>/../haiku-build`). Scripts are called by full path: `node "<skill-dir>/scripts/auto.mjs" ...`, `node "<hb-dir>/scripts/<name>.mjs" ...`.

## Unattended rules

- **Never ask the user anything.** No switch question, no blocking questions, no `[R] retry` / `[S] skip`, no approval, no "should I continue?". Never end a turn waiting for input. Where a haiku-build step says "ask the user", do what this file says instead.
- **Three terminal statuses only:** `done`, `done_with_findings`, `blocked`. Every run ends in exactly one, written by `auto.mjs` (`finish` or `halt`), never typed by hand.
- **`blocked` names its condition and exits 1.** On any blocking condition run `node "<skill-dir>/scripts/auto.mjs" halt <runDir> "<condition>"` and stop.
- **Subagents are mandatory.** If the Agent tool is unavailable or a subagent call fails, halt with `no subagents`. Run every subagent in the foreground (`run_in_background: false`), all calls of one stage in one message.
- **No commit, no push, no PR.** No halt after planning; one story per invocation.
- **Quiet output.** One line per script; point to files, never paste logs or diffs.

## Dispatch

| Mode | Input | Intent |
|---|---|---|
| Folder+id | spec folder + story id | Read `<specFolder>/stories.yaml` yourself, take the entry's `title`, pass it as `--title` (the script parses no YAML). |
| Free intent | task text | `--task "<text>"`. |
| Resume | an existing run folder | `start` finds `manifest.json` and continues from the first stage without its output (`spec.md`, a passing ladder rung, `review`, `auto.fixRounds`). |

Nothing to work from (no task, no folder+id title, no resumable run) halts `intent gap`.

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
6. **Present (07).** `node "<skill-dir>/scripts/auto.mjs" finish <runDir>`, then `node "<hb-dir>/scripts/build_report.mjs" <runDir>`. `finish` takes the final status from haiku-build's `status.mjs` (`finalStatus`): `blocked` when a required artifact is missing or tests fail, `done_with_findings` when only findings remain open (Minor), else `done`. Report the status, its condition and the report path in three lines.

## Blocking conditions

`preflight failed`, `dirty working tree`, `intent gap`, `ambiguous story file match`, `no subagents`, `plan failed twice`, `review failed twice`, `retry ladder used up`, `tests still fail`, `review repair loop exceeded 3 iterations`. Each one ends the run `blocked`, exit 1.

## Result

Every end (`finish` or `halt`) writes:

- `<runDir>/result.json`: `status`, `condition` (null unless blocked), `reason`, `exitCode`, `runId`, `specFile`, `at`;
- `manifest.json` `finalStatus` / `finalReason` and `auto.status` / `auto.condition`;
- under folder+id dispatch, the story spec `<specFolder>/stories/<id>-<slug>.md`: frontmatter `status` set to the terminal status and the result appended under `## Auto Run Result` (the file is created when missing). More than one file matching `<id>-*.md` halts `ambiguous story file match` and writes to `<id>-ambiguous.md`.

## Scripts

- `scripts/auto.mjs start | gate plan|review | round | halt <condition> | finish`: the stage gates above; one JSON line each. Its exports (`runAuto`, `autoRouting`, `handBackGate`, `reviewRound`, `autoFinal`, `specFileFor`, `writeResult`, `writeBackSpec`, `halt`) drive a whole run with the Agent tool, the test runner and JEV injected.
- Reused from haiku-build: `status.mjs` (ladder, final status), `routing.mjs`, `preflight.mjs`, `jev_advice.mjs`, `save_opus.mjs`, `phase.mjs`, `build_report.mjs`.

## Tests

```bash
node --test "<skill-dir>/tests/*.test.mjs"
```

No test makes a network call: the Agent tool, the test runner and JEV `ask` are injected.
