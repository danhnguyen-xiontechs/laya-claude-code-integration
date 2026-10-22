# Step 01: Intake

Goal: confirm the run can start, route every stage to a model, and create the run folder and manifest.

1. **Preflight.** Run `node "<skill-dir>/scripts/preflight.mjs"`. It checks Node 22 or newer and the haiku-100k setup marker (`modelSettings['claude-haiku-5-5'].autoCompactWindow` in `~/.claude/settings.json`, written by `/haiku-100k:setup`). If it prints `preflight failed: ...` (exit 1), show that line to the user and stop. Start no subagent and create no run folder.
2. **Route the stages.** Take the main session's model (the start model). Run `node "<skill-dir>/scripts/routing.mjs" <startModel>`. It prints every stage with its model and fallback: `02-plan` Opus (the only Opus stage), `03-implement` Haiku with one Sonnet fallback, `04-test` Haiku, `05-review` Sonnet, `06-fix` Haiku with at most one Sonnet re-review, `01-intake` and `07-present` on the main session.
   - Haiku or Sonnet start: the main session keeps its model. No question.
   - Unknown or missing start model: the main session stages are routed to Sonnet. No question.
   - Opus or Fable start: the line has `switchQuestion`. Ask the user exactly once: `switch main session to Sonnet?`. Keep the answer for item 5. Never ask it again in this run; `routing.mjs --write` keeps the first stored answer.
3. **Read the description.** It is the user's task. If it is ambiguous, state the reading you take in one line and continue. Ask only if no reading is possible.
4. **JEV advice (optional, point `intake`).** Only when `HAIKU_BUILD_JEV` is not `off`. After item 5 creates the manifest, run:

   ```bash
   node "<skill-dir>/scripts/jev_advice.mjs" <runDir> intake opus opus,sonnet --state "<the task in one paragraph>"
   ```

   The baseline is `opus`. The script uses JEV's pick only at confidence 0.8 or more, within 3000 ms; otherwise it keeps the baseline and logs why in `manifest.jev.calls`. Pass its `choice` as `--plan-advice` in item 5. JEV is advice only: it never changes status.
5. **Create the run folder** `reports/haiku-build/<runId>/` in the project root (`runId` = `YYYYMMDD-<short-slug>-01`), unless the user names another place. Say the run id in your message to the user before the next step, so the transcript contains it. Then write `manifest.json`:
   - `schemaVersion: 1`, `tool: "haiku-build"`, `status: "INTAKE"`, `task` (the description), `opusCalls: []`, `attempts: []`.
   - `routing`: run `node "<skill-dir>/scripts/routing.mjs" <startModel> --write <runDir> [--switch yes|no] [--plan-advice <choice>]`. Never type it.
   - `transcript`: do not type it. Run `node "<skill-dir>/scripts/find_transcript.mjs" <runId> --write <runDir>`. If it prints `null`, the field stays `null`; `build_report.mjs` tries again at the end.
   - `phases`: `[]`. Then open the first window with `node "<skill-dir>/scripts/phase.mjs" <runDir> start 01-intake`. Never type or estimate a timestamp.
   - `haiku`: `{ "haiku_request_count": null, "haiku_requests_over_100k": null, "max_haiku_input_tokens": null, "input_limit_verification": "not_measured" }`. `build_report.mjs` fills these.
6. **End the phase.** Run `node "<skill-dir>/scripts/phase.mjs" <runDir> start 02-plan`. Go to step 02.

No approval gate here. The only question this step may ask is the switch question, once.
