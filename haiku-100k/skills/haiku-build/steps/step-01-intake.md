# Step 01: Intake

Goal: confirm the run can start, and create its folder and manifest.

1. **Check the main model.** It must be Haiku 5.5 (`claude-haiku-5-5`). If it is not, stop and tell the user to switch the model. Do not continue on another model.
2. **Check the Haiku limit setup.** `haiku-100k` must be installed and `/haiku-100k:setup` run once on this machine. If it is missing, tell the user the exact steps and stop. Do not continue without it, because the 100k rule depends on it.
3. **Read the description.** It is the user's task. If it is ambiguous, state the reading you take in one line and continue. Ask only if no reading is possible.
4. **Create the run folder** `reports/haiku-build/<runId>/` in the project root (`runId` = `YYYYMMDD-<short-slug>-01`), unless the user names another place. Say the run id in your message to the user before the next step, so the transcript contains it. Then write `manifest.json`:
   - `schemaVersion: 1`, `tool: "haiku-build"`, `status: "INTAKE"`, `task` (the description), `opusCalls: []`.
   - `transcript`: do not type it. Run `node "<skill-dir>/scripts/find_transcript.mjs" <runId> --write <runDir>`. It picks the `.jsonl` under `~/.claude/projects/` that mentions the run id most often and stores it with forward slashes. If it prints `null`, the field stays `null`; `build_report.mjs` tries the lookup again at the end, and the report says `not_measured` if it still finds nothing.
   - `phases`: `[]`. Then open the first window with `node "<skill-dir>/scripts/phase.mjs" <runDir> start 01-intake`. Never type or estimate a timestamp: every window is opened and closed by `phase.mjs`.
   - `haiku`: `{ "haiku_request_count": null, "haiku_requests_over_100k": null, "max_haiku_input_tokens": null, "input_limit_verification": "not_measured" }`. `build_report.mjs` fills these.
5. **End the phase.** Run `node "<skill-dir>/scripts/phase.mjs" <runDir> start 02-plan`: it closes `01-intake` and opens `02-plan` at the same instant. Set `status` to `PLANNED` only after step 02 succeeds. Go to step 02.

No gate here. The flow does not stop for the user's approval of the description.
