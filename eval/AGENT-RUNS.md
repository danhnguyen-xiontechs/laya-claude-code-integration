# Agent-level runs: ticket #11840 on ESS dev, one fresh agent session per variant

Goal: real model turns, tokens and wall time per skill (the number the offline A/B in REPORT.md cannot give).

## Matrix (run sequentially: one role browser, one shared dev D365)

| id | skill file the agent follows |
|---|---|
| base | `C:\Users\LENOVO2\.claude\skills\web-test\SKILL.md` |
| laya-wait / laya-gate / laya-verdict / laya-oracle | `.claude/skills/web-test-laya-<x>/SKILL.md` |
| jev-wait / jev-gate / jev-verdict / jev-oracle | `.claude/skills/web-test-jev-<x>/SKILL.md` |

Start with 1 run of `base`, `laya-verdict`, `jev-verdict` (3 runs, ~5M tokens) to see variance and cost, then extend to 3 runs x 9 variants (~40M tokens). Randomise the order so the browser state and time of day do not favour one variant. Same model for every run.

## Prompt template (one run)

> Execute the ESS web-test skill end to end for ticket 11840 on env `dev`, exactly as the SKILL.md says (read it fully first): `<SKILL FILE>`. Browser tools: chrome-devtools MCP (deferred: load with ToolSearch).
> Overrides: (1) unattended, ask nothing, take the conservative default and note it; the ticket is read-only, perform no write step in ESS. (2) role `xiontechs`, launch with the skill's `launch-role.ps1` (owns CDP port 9222; abort if something already listens there); if the sign-in page shows, STOP and report `SIGN-IN NEEDED`, never type credentials. (3) skip Step 6 and do not send or publish files; build report.html. (4) run folder per the skill (`~/ess-test-runs/`); never touch the repo. (5) leave the role browser running.
> Reply with only: run folder, per-case status, case/step counts, deviations.

For `*-jev-*` variants add: the user approved sending compact text to Jev for this experiment, record it with `jev-check.mjs --set true`. For `*-laya-*` variants the skill's own pre-check starts laya-serve; stop it after the last run (`laya-check.mjs --stop`).

## Metrics to collect per run

Agent usage line (tokens, tool uses, duration) from the harness; number of `wait`/gate/verdict/oracle script calls and how many verdicts fell back to the agent (`review`) or were overridden (`results.json`); final case statuses versus the other runs.

## Why this was not run from the Claude session

The auto-mode classifier denied both launching the signed-in `xiontechs` browser profile and starting a subagent that drives ESS dev ([Production Reads] / [Interfere With Workloads]). Allow it with a Bash/Agent permission rule in settings, or start the runs yourself with the template above, and tell Claude to continue.

## Results: first batch (2026-10-15, order randomised: jev-verdict, base, laya-verdict)

| id | run folder | tokens | tool uses | wall | cases / steps | verdict calls | `review` fallbacks | overrides | result |
|---|---|---|---|---|---|---|---|---|---|
| jev-verdict | `~/ess-test-runs/11840-dev-20261015-0110` | 87,397 | 19 | 212 s | 2 / 4 | 4 Jev (p=0.86, 0.99, 1.0, 0.99) | 0 | 0 | BLOCKED (D365 "Currently Busy" throttling); Jev cost ~$0.00008, 0.7-1.4 s/call. Ran in default permission mode: auto mode denies the Jev call as [Data Exfiltration] |
| base | `~/ess-test-runs/11840-dev-20261015-0051` | 99,459 | 50 | 266 s | 2 / 3 | n/a | n/a | n/a | PASS (160/0/160 stable) |
| laya-verdict | `~/ess-test-runs/11840-dev-20261015-0056` | 94,326 | 34 | 470 s | 1 / 2 | 2 Laya + 2 `--status` | 2/2 (p=0.562, 0.406) | 0 | PASS (160/0/160 stable) |

Notes: laya-verdict reused the signed-in browser that base had launched (base paid for the ~45 s sign-in). Laya was unsure on both steps, so the model judged every step and Laya saved no turns. laya-verdict planned 1 case where base planned 2, so token counts are not a like-for-like comparison. The account has no actual hours (Total 0), so the reported 0-vs-55 mismatch was not reproduced in either run.

## Results: staging batch (2026-10-15; dev is throttled with 429, staging is the same app on another domain)

| id | run folder | tokens | tool uses | wall | cases / steps | verdict calls | `review` fallbacks | overrides | result |
|---|---|---|---|---|---|---|---|---|---|
| laya-verdict | `~/ess-test-runs/11840-staging-20261015-0128` | 95,743 | 32 | 559 s | 2 / 4 | 4 Laya + 4 `--status` | 4/4 (p=0.538, 0.46, 0.587, 0.371) | 0 | PASS (176/0/176 stable) |
| base | `~/ess-test-runs/11840-staging-20261015-0137` | 87,205 | 22 | 281 s | 2 / 3 | n/a | n/a | n/a | PASS (176/0/176 stable) |
| jev-verdict | `~/ess-test-runs/11840-staging-20261015-0143` | 96,760 | 29 | 572 s | 2 / 2 | 2 Jev (p=0.93, 1.0) | 0 | 0 | PASS (176/0/176 stable); Jev ~$0.00004, ~0.7 s/call; Default permission mode. Wall time includes a redone TC02 (wrong "Next page" control) and a screenshot retry |

Laya again fell back on every step (6 of 6 across the dev and staging runs), so in this skill it adds wall time (laya-serve start, ~2x base) without saving turns. Total hours is 0 on staging as well, so 0-vs-55 is still unverified.
