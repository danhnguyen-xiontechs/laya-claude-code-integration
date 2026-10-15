# Laya vs Jev: agent-level runs (ticket 11840, ESS staging)

Date: 2026-10-15. Each run used a fresh agent session following one SKILL.md end to end: one run per variant, all read-only, with the signed-in `xiontechs` browser reused. Staging was used because dev was throttled (429 / "D365 Is Currently Busy"). The ground skills were tested earlier and are out of scope here. Offline A/B numbers for the same four skills are in [REPORT.md](REPORT.md).

## Bottom line

- **Jev decides; Laya defers.** On these real runs Jev answered every decision with high confidence (p 0.93-1.0). Laya came back `review` (p 0.37-0.59) on every verdict, oracle and expect-wait call, so the agent made those decisions itself. Laya adds the laya-serve start-up and saves no turns.
- **Neither engine cut tokens or turns compared with base** on this small ticket. All runs used 87k-101k subagent tokens. Differences in wall time come from the size of the plan and from navigation retries, not from the decision engine.
- **Jev cost is negligible:** $0.00002-0.0013 per run, with 0.5-1.7 s per call.
- **Two script bugs make the wait and oracle results unreliable** (see Issues). Fix them before re-running those skills.
- **Gate was not really exercised:** 11840 has no write step. Jev classified both steps as read (p=0.00). Laya flagged a week-arrow click as a possible write (p=0.52), which the agent overruled.
- **Coverage gap:** the account has 0 actual hours on staging and dev, so the bug's 0-vs-55 case was never reproduced. All runs only show that the month totals are stable (176/0/176).

## Results (staging)

| skill | variant | run folder (`~/ess-test-runs/`) | tokens | tools | wall | cases/steps | decision calls | engine decided | fell back to agent | overridden | result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base | web-test | 11840-staging-20261015-0137 | 87,205 | 22 | 281 s | 2/3 | - | - | - | - | PASS |
| verdict | laya | 11840-staging-20261015-0128 | 95,743 | 32 | 559 s | 2/4 | 4 | 0 | 4 (p .54 .46 .59 .37) | 0 | PASS |
| verdict | jev | 11840-staging-20261015-0143 | 96,760 | 29 | 572 s | 2/2 | 2 | 2 (p .93, 1.0) | 0 | 0 | PASS |
| wait | laya | 11840-staging-20261015-0202 | 100,310 | 33 | 222 s | 2/3 | 5 | 4 ready (rules only, Laya idle) | 1 expect-timeout (p .46) | 0 | PASS* |
| wait | jev | 11840-staging-20261015-0158 | 92,472 | 29 | 219 s | 1/2 | 4 | 4 (p .91-1.0) | 0 | 2 expect-timeouts | PASS* |
| oracle | laya | 11840-staging-20261015-0206 | 97,403 | 35 | 195 s | 3/3 | 3 (+1 record) | 2 by rule check, 0 by Laya | 1 (p .43) | 0 | PASS* |
| oracle | jev | 11840-staging-20261015-0209 | 94,103 | 25 | 217 s | 2/2 | 2 (+1 override) | 1 by rule check | 0 | 1 (Jev fail p .95, reading empty observe) | PASS* |
| gate | laya | 11840-staging-20261015-0216 | 100,777 | 46 | 233 s | 2/5 | 3 (plan, re-run, audit) | 4 read | 1 disputed (p .52), overruled | 1 | PASS |
| gate | jev | 11840-staging-20261015-0213 | 95,659 | 33 | 168 s | 2/2 | 2 (plan, audit) | 2 read (p .00) | 0 | 0 | PASS |

\* The decision script read the wrong page (Issue 1), so the engine's input or answer did not reflect the page under test. The agent's own page reads decided the result.

Jev cost per run: verdict ~$0.00004, wait ~$0.0013 (30 polls), oracle ~$0.00002, gate ~$0.00003.

## Issues found

1. **`wait.mjs` (and `--observe` in oracle) attaches to the wrong tab.** The CDP browser has a hidden ESS page at `/` that the MCP's `list_pages` does not show. The scripts pick the first non-devtools page, so they polled the home page while the test ran on `/attendance`. Every `--expect` timed out, `--shot` produced nothing, and oracle `--observe` returned no lines. Jev oracle then said "fail" with p=0.95 on that empty input. Fix: target the page by URL or by the MCP's selected page, or add a `--url` option. This affects both the laya and jev copies.
2. **Auto mode blocks Jev runs** with [Data Exfiltration], because they call openrouter.ai. The jev runs were done in Default mode. To run them under auto mode, add an `autoMode.environment` / `autoMode.allow` entry to `~/.claude/settings.json`.
3. **Small friction seen in most runs:** the browser MCP cannot write into `~/ess-test-runs`, so screenshots go through the scratchpad. PowerShell writes results.json with a BOM, which breaks `record.mjs`/`verdict.mjs`. The month/week arrows have no accessible name, and "Next page" only scrolls the tabs. `launch-role.ps1` needs the role before the URL.

## Dev runs (before the switch to staging)

base PASS (99k tokens, 266 s). laya-verdict PASS (94k, 470 s, Laya `review` 2/2). jev-verdict BLOCKED by D365 throttling (Jev decided 4/4, p .86-1.0). Details are in [AGENT-RUNS.md](AGENT-RUNS.md).

## Limits

There was one run per variant, and plans differ in size (1-3 cases, 2-5 steps), so token and time differences are within noise. The plan in AGENT-RUNS.md (3 runs per variant, random order) still applies. It needs Issue 1 fixed first, and a ticket with real hours data and a write step.
