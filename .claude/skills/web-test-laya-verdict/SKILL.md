---
name: web-test-laya-verdict
description:
  Laya plan 2 variant of web-test: per-step verdict with confidence — after each step the agent writes what
  the page showed and an optional local Laya decision model judges pass / fail / blocked against the planned
  expected result (`verdict.mjs`); confident verdicts are recorded as Laya's, unsure ones go back to the agent
  and are flagged for review in the report. Otherwise the same flow as web-test (ADO ticket → test plan →
  browser execution → screenshots → report.html + execution-log.html). Use to test plan 2 on its own (plan 1
  page wait = `web-test-laya-wait`, plan 3 write gate = `web-test-laya-gate`). Trigger only on
  `/web-test-laya-verdict <ticket> <env>` or an explicit request to test plan 2 / Laya step verdicts; plain
  ticket-testing requests go to the `web-test` skill.
---

# Web Test (ESS) — Laya plan 2: step verdict

This skill lives in the project (`.claude/skills/web-test-laya-verdict/`); script paths below are relative to the project root — run them from there.

Turn one ADO ticket into an executed, evidenced test run:

```
ticket ──► test plan ──► browser execution (chrome-devtools MCP / playwright-cli) ──► screenshots ──► report.html + execution-log.html
```

For the Claude-in-Chrome variant (user's real Chrome, more tokens) see the `web-test-chrome` skill. This skill never writes to ADO. The report stays local; offer to publish it as an Artifact if the user wants a shareable link.

## Invocation

```text
/web-test-laya-verdict <ticketId> <env> [--role <role>] [--browser devtools|cli] [--review-plan]
```

| Arg | Meaning | Default |
| --- | --- | --- |
| `ticketId` | ADO work item id in `gemseducation/GEMS-HR-SCM` | required |
| `env` | key in [environments.json](environments.json) (`dev`, `local`) or a raw `https://` URL. `dev` = verify what is merged and deployed; `local` = self-test an unmerged branch before the PR | `dev` |
| `--role` | a key in [roles.json](roles.json) — each role is one sign-in account with its own browser profile | `roles.json` `default` (`xiontechs` = danh.nguyen@xiontechs.com) |
| `--browser` | force `devtools` (chrome-devtools MCP) or `cli` (playwright-cli) | auto: devtools, else cli |
| `--review-plan` | stop after the plan and wait for the user's OK | off |

A ticket can need several roles (employee submits leave, manager approves). Plan each case with the **role from [roles.json](roles.json)** whose account can play it; see "Switching roles" below. The default `xiontechs` account (the user's own company account, full-rights admin on dev) covers most happy paths. If a case needs a role that has no account in `roles.json` (e.g. a manager with direct reports), mark it `blocked` and say which account is needed — when the user provides one, add it to `roles.json`.

## Run folder

One folder per run, outside every repo so nothing gets committed by accident:

```
~/ess-test-runs/<ticketId>-<env>-<YYYYMMDD-HHmm>/
├── ticket.json        # raw az response (+ comments.json)
├── results.json       # plan + outcomes (schema below) — the single source of truth
├── shots/             # TC01-S01.png, TC01-S02.png, …
├── api/               # API response bodies saved to file (fails, or data-contract ACs only)
├── report.html        # generated, self-contained (images inlined)
├── run-notes.json     # human summary for the execution log (Step 6)
└── execution-log.html # metrics + step-by-step agent log + real token usage (Step 6)
```

## Step 1 — Fetch the ticket

ESS work items live in the **client's** org, not the code org: `gemseducation` / project `GEMS-HR-SCM` (iterations `ESS - R*`). The repos are in `XionTechs/XTP0009_ESS_App`, which has no ESS work items.

```bash
ORG=https://dev.azure.com/gemseducation; PROJECT=GEMS-HR-SCM
az boards work-item show --id <id> --org "$ORG" --expand all -o json > "<runDir>/ticket.json"
# Comments: use az rest — `az devops invoke` rejects the preview api-version.
az rest --method get --resource 499b84ac-1321-427f-aa17-267ca6975798 \
  --url "$ORG/$PROJECT/_apis/wit/workItems/<id>/comments?api-version=7.1-preview.4" \
  -o json > "<runDir>/comments.json"
```

- Always pass `--org` explicitly — the machine's az default org is a different organization.
- Many ESS bugs are filed from Test Plans: `ReproSteps` holds a generic test-step template and the real problem is in the **comments**. Read both; also check the `Tested By` link and the fix commit/PR in the repos (`git log --grep <id>`) — the PR description often states the exact expected behaviour and the API shape.
- If az says not logged in, ask the user to run `az login` themselves; don't attempt it.
- Read: `System.Title`, `System.WorkItemType`, `System.State`, `System.Description`, `Microsoft.VSTS.Common.AcceptanceCriteria`, `Microsoft.VSTS.TCM.ReproSteps` (bugs), and the comments (BA/QA clarifications override the description — later wins). Fields are HTML; strip tags when reading.
- If ACs are thin and `relations` has a `System.LinkTypes.Hierarchy-Reverse` parent, fetch the parent too — ACs often live on the parent story.
- If there is nothing testable, say so and ask the user what to verify rather than inventing requirements.

## Step 2 — Plan the test cases

Derive cases from the ticket, not from what the UI happens to show:

1. **One case per acceptance criterion** (happy path), tagged `AC1`, `AC2`… — the traceability the report hangs on.
2. **Negative / validation cases** where an AC implies a rule (required fields, invalid date ranges, overlapping leave, file type/size on uploads, a role that must *not* see the feature — e.g. employee opening a manager-only page).
3. **Edge cases** the ticket hints at: empty state, paging (ESS lists over-fetch by one — check the last page and "next" button), long text, boundary/timezone dates, users in another legal entity (company-scoped data).
4. **Bugs:** exact repro steps first (expect fixed), then one or two regression neighbours.

**Admin account caveat:** the user's own account on `dev` is a full-rights admin. Cases that prove a role must *not* see or do something cannot pass honestly with that account — mark them `blocked` ("needs a non-admin account") unless the user provides one, never `pass`.

Keep it proportionate — a copy change needs 1–2 cases, a new workflow 8–12. Every expected result must be concrete and observable ("toast reads 'Leave request submitted'", "table shows 3 rows").

Write the plan into `results.json` with every step `status: "not-run"`, then show a compact table (`TC | AC | Role | Title | Priority`).

**Write-action gate:** any case that submits, approves, rejects, cancels, uploads or edits data goes to **D365 F&O, which is shared** — even from `local`, because the local BE talks to a shared D365. List those steps and ask once for OK before executing them, regardless of `--review-plan`. Prefer read-only verification when the AC allows it.

With `--review-plan`, stop here and wait.

## Step 3 — Prepare the browser

**Laya pre-check (once per run).** Start it **in the background at the beginning of Step 1** — when Laya is installed but not running it starts `laya-serve` itself and waits for `/health` (~40 s on CPU), so it is ready by the time the browser is: `node .claude/skills/web-test-laya-verdict/scripts/laya-check.mjs` (Bash `run_in_background`). Read its one line before the first step verdict in Step 4, act on it, and never mention Laya otherwise:
- `laya=on url=…` → already running (someone else started it): use it, leave it running.
- `laya=on url=… started=<pid>` → this run started it: use it, and **stop it at the end of the run** (Step 5).
- `reason=disabled` → say nothing.
- `reason=ask` → ask the user **once**: Laya is an optional small local model (~2.2 GB download, a few minutes, runs on CPU) that judges each step's pass / fail / blocked with a confidence score, without extra model turns; the skill works fully without it. Options: install now / never ask again / later. Record the answer with `laya-check.mjs --set true|false` (later = leave as is). "Install now" → run `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/web-test-laya-verdict/scripts/laya/install-laya.ps1 -SkipMcp` **in the background** and continue this run in rule mode; it is used from the next run.
- `reason=start-failed` → one line: "Laya is installed but did not start (log: `~/.ess-web-test/laya-serve.log`); continuing without it." Then continue.
- `reason=not-installed` → offer the installer as above, continue.

Auto-pick, in this order (`--browser devtools|cli` forces one). Both keep screenshots **out of the model context** — they are written straight to `shots/` — which is why this skill is cheaper than `web-test-chrome`.

**A. chrome-devtools MCP (preferred).** Attaches to a per-role browser on port 9222 (the MCP is registered with `--browserUrl=http://127.0.0.1:9222`).

1. Launch the role (one role owns port 9222 at a time; launching another role stops the current one):
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File ".claude/skills/web-test-laya-verdict/scripts/launch-role.ps1" [role] <envUrl>   # either order works (the URL is detected); no role → roles.json default
   powershell -NoProfile -ExecutionPolicy Bypass -File ".claude/skills/web-test-laya-verdict/scripts/launch-role.ps1" status
   ```
   It uses **Edge** (else Chrome, else Playwright's Chromium) with a dedicated persistent profile at `~/.ess-web-test/profiles/<role>`, and prints the role's account. It **cannot** use the user's everyday Edge profile: Edge 136+ ignores the debugging port on its default profile, and the running Edge would capture the launch. Act on its output:
   - `FIRST RUN` → the profile has never signed in: ask the user to sign in as the printed account in the opened window, wait, then continue.
   - `WARNING … signed in as X, expected Y` → stop and ask the user.
   - `Port 9222 is used by a browser this script did not start` → ask the user to close that browser.
2. Load the tools in one call: `ToolSearch select:mcp__chrome-devtools__list_pages,mcp__chrome-devtools__select_page,mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_snapshot,mcp__chrome-devtools__take_screenshot,mcp__chrome-devtools__click,mcp__chrome-devtools__fill,mcp__chrome-devtools__fill_form,mcp__chrome-devtools__hover,mcp__chrome-devtools__press_key,mcp__chrome-devtools__wait_for,mcp__chrome-devtools__list_console_messages,mcp__chrome-devtools__list_network_requests,mcp__chrome-devtools__get_network_request,mcp__chrome-devtools__evaluate_script`
3. `list_pages` → use that page's id on page-scoped tools (the server runs with page-id routing), then `navigate_page` to the env URL if needed.
4. If the tools are missing (the MCP is only loaded in sessions started after it was registered) or cannot attach to port 9222, fall through to B.

**B. playwright-cli (fallback).** Persistent, named session per role + env, so a sign-in survives between runs. **Always run it from the run folder** — it writes snapshot files into `./.playwright-cli/` of the current directory, which must never land in a repo:

```bash
cd "<runDir>"
playwright-cli -s=<role>-<env> open <envUrl> --browser=msedge --headed --persistent --profile "$HOME/.ess-web-test/profiles/<role>"
```

It shares the same per-role profile as path A, so one sign-in serves both — stop path A first (`launch-role.ps1 stop`), a profile can be open in only one browser. Pass `--browser=msedge` (the default `chrome` channel fails). Core commands: `snapshot`, `find <text>`, `click <ref>`, `fill <ref> <text>`, `select <ref> <val>`, `press <key>`, `screenshot --filename=shots/TC01-S01.png`, `console error`, `requests`, `response-body <n>`, `close`.

**Sign-in (either path).** ESS uses MSAL. The first run per role shows the Microsoft sign-in in the opened window: pick **exactly the role's account from `roles.json`** if an account picker appears (default: danh.nguyen@xiontechs.com — never a personal account such as a gmail address); on a password/MFA prompt, never type credentials — tell the user which role/profile needs signing in, wait for them to finish, then continue. The profile keeps the session for next time.

**Switching roles.** Each role has its own profile, so switching = launching the other role (A) or using the other `-s=<role>-<env>` session (B). At the start of each role's first case, check who is signed in to ESS (avatar / profile page) and compare with the role's account in `roles.json`; if it differs, stop and ask the user. Group cases by role to minimise switches.

**Local env pre-check.** For `local`, confirm both sides are up before testing — a dead backend makes every case fail for reasons unrelated to the ticket:
- FE `http://localhost:3000` (`D:\Source\Ess\ess-fe`, `npm run dev`)
- BE `http://localhost:5201/api/health` (`D:\Source\Ess\ess-be`, `dotnet run --project src/Ess-App.API/Ess-App.API.csproj`)

If either is down, ask the user before starting it (run long-lived servers in the background).

## Step 4 — Execute

For each case, for each step:

1. Act — prefer snapshot uids/refs over coordinates. **Snapshot only when you need uids to click/fill.** `navigate_page` (A) already returns the page content, so don't follow it with `take_snapshot` just to look. To *check* a value, use `wait_for` on the expected text, or `evaluate_script` returning only the few strings you need (e.g. the text of one cell or a list of chip labels) — never the whole DOM. One snapshot per page state; reuse its uids until the page changes. (Measured on 22063: `navigate_page` +7.4K tokens, each `take_snapshot` of an ESS table +2–3K, all re-read on every later turn.)
2. Wait for the UI to settle: `wait_for` the expected text (A) or `find` it (B), and make sure loading skeletons/spinners are gone. ESS pages fan out several `/api/...` calls that each hit D365 — a screenshot of a skeleton is not evidence.
3. **Screenshot straight to file**, never into the conversation: `take_screenshot` with `filePath: "<runDir>/shots/TC<nn>-S<nn>.png"` (A) or `playwright-cli -s=… screenshot --filename=shots/TC<nn>-S<nn>.png` (B). Every step with an expected result gets one; pure navigation steps may share the next step's shot. Don't view the image to judge the result — judge from the snapshot/text; open an image only when the check is purely visual (colour, layout).
   **File paths (A):** the MCP only writes inside its workspace roots, and `~/ess-test-runs` is outside them. If `filePath` / `responseFilePath` is refused, write to the session scratchpad instead and copy into `<runDir>/shots/` or `<runDir>/api/` before building the report — same file names.
4. **Verdict (plan 2).** Do not choose the status yourself first. Write `actual` from the page — **quote the page text** you read (from `wait_for` / `evaluate_script` / the snapshot), never a paraphrase of `expected` — and let the step be judged, one call per step:
   ```bash
   node .claude/skills/web-test-laya-verdict/scripts/verdict.mjs "<runDir>" TC<nn> <n> --actual "<quoted page text>" [--shot shots/TC<nn>-S<nn>.png]
   ```
   It writes `actual`, `status` and `verdict` into `results.json` immediately (so a crashed run still leaves evidence) and prints one line, `verdict=<status> by=<laya|model> p=<conf> review=<bool> …`:
   - `p ≥ 0.85` → Laya's verdict stands; move on.
   - `0.60 ≤ p < 0.85` → Laya's verdict stands, flagged `review` in the report. Glance at it; if you disagree, override (below).
   - `verdict=review` (Laya unsure, `p < 0.60`, or Laya off) → judge it yourself: `node .claude/skills/web-test-laya-verdict/scripts/verdict.mjs "<runDir>" TC<nn> <n> --status <pass|fail|blocked|skipped>`.
   - **Override** when Laya is clearly wrong (e.g. it calls an environment error a `fail`, or misses a wrong value): `--status <s> --reason "<one line why>"`. The reason is required and shows in the report; overrides are the measure of whether Laya is worth keeping, so don't override to save a step and don't skip one you believe in.
   The ESS/D365 classification table below still decides `blocked` vs `fail` — use it when you judge or override. `skipped` is always yours (`--status skipped`).
5. **Network — only on a fail (as in the original skill).** A passing step needs no network evidence; the screenshot and the page text are the evidence.
   - List only: `list_network_requests` filtered to `fetch`/`xhr` (A) / `requests` (B), and `list_console_messages` (A) / `console error` (B).
   - Record into the step's `diagnostics` for each failed (4xx/5xx) `/api/...` call: method, path (strip query strings), status, and `code` + `traceId` from the ESS error body. The `traceId` lets a developer find the request in the BE Serilog logs — always include it when present.
   - To read that error body, **write it to a file, never inline**: `get_network_request` with `reqid` + `responseFilePath: "<runDir>/api/TC<nn>-S<nn>.json"` (A) — then read just `code`/`traceId`/`message` from the file (e.g. with `node -e`), not the whole file. B: `response-body <n>` prints inline, so pipe it to a file: `playwright-cli -s=… response-body <n> > api/TC<nn>-S<nn>.json`.
6. **API body as evidence on a pass** — only when the AC itself is about the API/data contract (e.g. "response contains `holidays[]` for every member"). Same rule: `responseFilePath` into `<runDir>/api/`, then extract only the fields the AC names. Never call `get_network_request` without `responseFilePath`, and never copy request headers anywhere: they carry the user's bearer token. The MCP is registered with `--redactNetworkHeaders` as a second guard; if a token still shows up in a tool result, do not repeat it and note it in `run-notes.json` insights.

### Classifying ESS/D365 errors

| Response | Verdict |
| --- | --- |
| 429 with `code: CONCURRENCY_LIMIT_EXCEEDED` (`Retry-After: 3`), or D365 429 throttling | `blocked` (environment), retry once after a few seconds and note it |
| 401 with `WWW-Authenticate` claims challenge / MSAL interaction required | `blocked` — ask the user to re-sign-in |
| 502/503/504 from the API host, BE not reachable | `blocked` |
| 400 validation on input the AC says is valid, 403 for a role that should have access, 404 on an existing record, 500 | `fail` |
| Generic "Something went wrong" message where the AC expects a specific business message | `fail` — note the API status/code |

Rules of honest reporting:

- `blocked` = couldn't reach the thing under test (env down, test data missing, sign-in needed, a previous step failed). Say why. It is not a fail of the ticket.
- Don't retry a failing step into a pass. One retry for a clear flake is fine; note it in `notes`.
- Missing test data (e.g. the manager has no direct reports, no leave balance, no open probation review) → `blocked` with what data is needed, not testing something adjacent.
- Data you create may carry a neutral prefix like `[TEST]`, but never put the skill name, "Claude", "AI" or any tool name in it — other users of the env and D365 see it.
- Defects noticed outside the planned cases go under `observations`; they mustn't change a case's verdict.

## Step 5 — Build the report

If the Laya pre-check printed `started=<pid>`, stop the server this run started (it never touches a server it did not start): `node .claude/skills/web-test-laya-verdict/scripts/laya-check.mjs --stop`.

```bash
node .claude/skills/web-test-laya-verdict/scripts/build_report.mjs "<runDir>"
```

Reads `results.json` + `shots/`, recomputes statuses, writes `report.html` with images inlined. Do not send it yet — first build the execution log (Step 6), then send **both** `report.html` and `execution-log.html` in one `SendUserFile` call (`display: "render"`). The report adds a "judged by" chip per step (Laya + confidence, or model), highlights `review` / `override` steps, and shows the plan-2 tiles (judged by Laya / flagged review / judged by model / Laya overridden). In chat: overall verdict, pass/fail/blocked counts, the four plan-2 numbers in one line, one line per failed case with the likely cause (and `traceId` if any). Offer once to publish it as an Artifact for sharing.

## Step 6 — Execution log (always)

Every run ends with a self-contained `execution-log.html` next to `report.html`: how the agent handled the task step by step, with real token usage. It is for cost tracking and debugging the skill.

1. Record `startedAt` in `results.json` when Step 1 begins (not when the plan is written) and `finishedAt` after the report is built — they bound the log window.
2. Write `<runDir>/run-notes.json` — the human summary that heads the log:

```json
{
  "objective": "What was asked and what this run set out to prove (1–3 sentences).",
  "steps": [
    { "title": "Fetch ticket", "assumption": "what you assumed, if anything", "result": "what happened", "status": "ok | warn | error | blocked | pass | fail" }
  ],
  "insights": ["Cost/debug lessons: wasted turns and why, what would make the next run cheaper or faster."]
}
```

Keep `steps` to the 8–15 meaningful milestones (not every tool call), and be honest about wrong assumptions — they are the most useful part for debugging the skill.

3. Build the log (run from the same working directory as the session, so the default transcript lookup finds it):

```bash
node .claude/skills/web-test-laya-verdict/scripts/build_execution_log.mjs "<runDir>"
```

The script reads this session's Claude Code transcript (`~/.claude/projects/<cwd-slug>/*.jsonl`, newest file; pass `--transcript` / `--from` / `--to` to override) and writes one self-contained `<runDir>/execution-log.html`:

- metric tiles (model turns, input/output tokens, cache-read share, tool calls, active time);
- the run-notes summary;
- token usage by phase (each user message starts a phase), from the API `usage` fields — **real values, not estimates**;
- charts of input and output tokens per model turn (hover for details, click to jump to that step) and tool calls by type;
- the full step-by-step log: every model turn with its visible narration, each tool call and a one-line result, filterable to steps with errors.

Internal reasoning is not logged, and token/password-looking values are redacted. Send it alongside `report.html` and mention the token totals in the final chat summary in one line.

## results.json schema

```json
{
  "ticket": { "id": 20927, "type": "Bug", "title": "…", "state": "Resolved", "url": "https://dev.azure.com/XionTechs/XTP0009_ESS_App/_workitems/edit/20927" },
  "environment": { "key": "dev", "url": "https://…", "build": "optional FE/BE version if visible" },
  "browser": "chrome-devtools | playwright-cli",
  "tester": "<git user.name>",
  "startedAt": "2026-10-08T10:02:00+07:00",
  "finishedAt": "2026-10-08T10:31:00+07:00",
  "scope": "One-paragraph summary of what the ticket changes and what this run covers / excludes.",
  "cases": [
    {
      "id": "TC01",
      "title": "Employee submits annual leave with phone and handover details",
      "ac": ["AC1"],
      "role": "employee",
      "priority": "High",
      "type": "happy | negative | edge | regression",
      "preconditions": "Employee has ≥ 2 days annual leave balance",
      "status": "pass | fail | blocked | skipped | not-run",
      "notes": "",
      "steps": [
        {
          "n": 1,
          "action": "Open Leave → New request, fill dates, phone, handover; submit",
          "expected": "Toast 'Leave request submitted'; request listed as Pending",
          "actual": "…",
          "status": "pass",
          "screenshot": "shots/TC01-S01.png",
          "verdict": { "by": "laya | model", "laya": { "label": "pass", "p": 0.91 }, "review": false, "override": false, "confirmed": false, "reason": "only for model verdicts / overrides" },
          "diagnostics": {
            "console": [],
            "network": [{ "method": "POST", "status": 500, "url": "/api/leave-requests", "excerpt": "code: … traceId: 00-…" }]
          }
        }
      ]
    }
  ],
  "observations": ["Out-of-scope issues noticed during the run"]
}
```

A step's `status` may be `review` while Laya was unsure and you have not judged it yet — resolve every `review` before building the report (the script warns). A case's `status` is the worst of its steps (fail > review > blocked > skipped > not-run > pass); the report script recomputes it. Overall verdict: any fail → FAIL; else any blocked → BLOCKED; else PASS (INCOMPLETE / NOT RUN when cases were never executed).

## Environments

[environments.json](environments.json) maps env keys to FE `url`, BE `api` and notes. Entries marked UNCONFIRMED or with an empty `url` must be confirmed with the user before use; once confirmed, update the file (and drop the note) so the next run doesn't have to ask.

## Optional: Laya

[Laya](https://github.com/convaiinnovations/laya) is a small self-hosted decision model (fixed-choice answers with confidence, ~0.5 s per question on CPU, no quota). It is **optional**: without it every step comes back `verdict=review` and you judge it, exactly as in `web-test`. Shared defaults in [laya.json](laya.json); the per-machine answer (`enabled`, url override) is written to `laya.local.json` (gitignored). `LAYA_URL` env overrides the url. `laya-check.mjs` starts `laya-serve` in the background when it is installed but down (only the `model` from `laya.json`, port from its `url`; log `~/.ess-web-test/laya-serve.log`, pid `~/.ess-web-test/laya-serve.pid`) and `--stop` stops only that server; `--no-start` checks without starting. Installer and manual launcher ship in `scripts/laya/` (`install-laya.ps1 -SkipMcp`, `start-laya.bat`).

What it is used for here (plan 2): `verdict.mjs` — one `choice` question per step, state `{expected, actual}`, labels `pass` / `fail` / `blocked`, thresholds 0.85 / 0.60. Every Laya call is appended to `~/.ess-web-test/verdict-log.jsonl` (expected, actual, Laya's probabilities) so its verdicts can be scored offline against the final (human-reviewed) statuses before trusting it with more. Not yet validated offline — the plan's offline check (does confidence separate right from wrong verdicts?) is still to do; until then treat the review / override counts as the experiment's result, not as proof. Plan 1 (page wait) is `web-test-laya-wait`, plan 3 (write gate) is `web-test-laya-gate`.
