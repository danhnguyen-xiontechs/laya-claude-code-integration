# Step 02: Plan (Opus by default, one closed call)

Goal: get one spec from Opus and save it as `spec.md`.

1. **Gather repo facts (Haiku).** Use Read, Grep and Glob in the main session. For a broad search, use `haiku-100k:haiku-case` with `model: "haiku"`, `effort: "xhigh"`, and a brief that asks for a short list of facts. Keep REPO FACTS under about 3k tokens: file paths, existing function signatures, the unit test command.
2. **Build the pack.** Write the repo facts to a file (for example `evidence/repo-facts.txt`) and build the context bundle (v3):

   ```bash
   node "<skill-dir>/scripts/context_bundle.mjs" <runDir> 02-plan --facts <runDir>/evidence/repo-facts.txt
   ```

   It writes `evidence/context-bundle.json` and its prompt text `evidence/context-bundle.txt`, and logs the use in `manifest.contextBundle`. Paste into `prompts/plan-opus.md`:
   - `TASK:` the description from step 01.
   - `REPO FACTS:` the list from step 1.
   - `CONTEXT:` the text of `evidence/context-bundle.txt`.
   - `TEMPLATE:` the contents of `templates/spec.md`.
3. **Call the plan model.** Agent tool, `model:` the `02-plan` model in `manifest.routing` (`opus` unless the intake advice picked `sonnet`), `effort: "medium"`, `run_in_background: false`, the filled prompt as the whole prompt. Foreground only, so the result arrives in the same turn. Take the returned text as it is. Do not retype, trim or summarise it.
   - **Save the hand-back in the turn it arrives** (step 4, `savePlanSpec`), before any other work. A compaction can drop it from context at any time; once it is on disk, it is safe.
   - **Never use `tasks/*.output` as evidence.** That file is always empty for an agent that replies by hand-back. Whether the plan arrived is decided only by `spec.md` and the `opusCalls` entry in `manifest.json`.
   - If you resume (for example after a compaction) and cannot tell whether the plan arrived: check `spec.md` and `opusCalls` first, then search the session transcript for the agent id. Record a failed call only when none of these has the text.
   - Why: in a test run the hand-back arrived and was saved, but after a compaction the main session read the empty `.output` file and wrongly recorded a loss.
4. **Check the output.** It must:
   - any length: 800 to 1600 words is normal, over 1600 is saved with an `oversized` warning and the run continues (`PLAN_OVERSIZE_WORDS` in `scripts/build_report.mjs`);
   - contain the four required headings (`checkSpecSections`): Goal & Intent, Tasks & Acceptance Criteria, Red Checks, Verification;
   - give each behaviour change a `red:` line.

   Write the returned text unchanged to a file (for example `evidence/plan-opus-raw.md`), then save it with:

   ```bash
   node "<skill-dir>/scripts/save_opus.mjs" plan <runDir> <runDir>/evidence/plan-opus-raw.md --attempt <n>
   ```

   It calls `savePlanSpec` from `scripts/build_report.mjs`, which runs the same checks, writes `spec.md` only when they pass, sets `status` to `PLANNED` and appends the call to `opusCalls` with `words`, `ok`, `sha256` and `reason`. Never write `spec.md` by hand. An empty result is a failed call (`reason: "empty output"`), not a skipped one.
   - **AC map (v3).** On a pass it also records `manifest.acMap` (`scripts/ac_map.mjs`): each AC with its `target` and `verify`. An AC without either is named in `acMap.unmapped` with the warning `ac-unmapped`; the plan is still saved and the run goes on, but that AC is shown as `unmapped` in the report and never counts as passing. Mention any unmapped AC in the summary of item 7.
   - **Failure record (v3).** When the save fails, record it before asking: write the printed `reason` to a file and run `node "<skill-dir>/scripts/failure.mjs" record <runDir> plan <n> <reasonFile>`.
5. **If it fails**, ask the user once, in one line: `[R] retry` or `[S] skip`, and say why it failed (not parseable, a required heading missing).
   - `[R]`: call Opus again and save its text with `save_opus.mjs plan ... --attempt 2 --approved-by "<the user's words>"`. The script records `retryApprovedBy` and `retryAt` on that entry, and refuses a retry without `--approved-by`. Only one retry is offered; if it fails again, ask the same question once more.
   - `[S]`: set `planFailed: true`, `planFailure: "<reason>"`, `status: "PLAN_FAILED"`. Do not write `spec.md`. Go to step 07 to write the `INCOMPLETE` report (final status `blocked`). Do not build.
6. **Blocking questions.** Read section 3 of the spec. If it lists blocking questions, ask the user them once, in one batch, before Implement. Write each answer into `manifest.json` `planAnswers` as `{ "question", "answer", "section" }`, where `section` is the spec section the answer changes (for example `6`). Do not edit the spec body. If the list is empty or missing, write no `planAnswers` and continue.
   - Answers are authoritative. Step 03 implements the spec as supplemented by them, and the step 05 reviewers review the same way.
   - **No preference.** If the user answers "no preference", "any", "you choose" or similar, pick the option the spec's assumptions (section 3) or boundaries (section 2) point to; if they point nowhere, pick the smallest safe behaviour (reject or leave unchanged rather than guess). Tell the user the pick in one line, and record `answer: "no preference -> <your pick>"`. That pick is then authoritative like any answer, so the build implements it and no finding stays `open` because of it.
7. **Show the user a short summary**: the goal and the acceptance criteria, five lines at most, and any answers recorded. Do not wait for approval. Open the next window with `node "<skill-dir>/scripts/phase.mjs" <runDir> start 03-implement` and continue to step 03.

Do not edit the spec's content yourself. If it is wrong, the user chooses a retry or the report records it.
