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
