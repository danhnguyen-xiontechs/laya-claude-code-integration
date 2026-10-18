# Design: acceptance-criteria-coverage retro measurement (20261018-acc-agent-01)

Frozen before step 6 (`evaluation.criteriaFrozenAt` in manifest.json). Findings about the measurement design from the independent review are fixed here before the runs; findings about the tool are accepted for this run and not fixed.

## Arms
| Arm | What runs |
|---|---|
| A | plain Claude (Haiku 5.5, effort xhigh); prompt says no tool is available and not to look for or use any skill, script or helper; `node tool.mjs` exists in the folder and prints "tool disabled" |
| B | same prompt + one sentence about the tool; `node tool.mjs` runs the skill's real core with Jev live (typesafe/jev-1.13 via OpenRouter Decisions API, key from the environment; repo is public so sending is allowed) |

Same case ids, folders (fresh copy per case, arm and repetition), prompt text, model and effort. Case agents are forced to Haiku 5.5 with effort xhigh by the user's decision, whatever the model router says. Repetitions: 2 (rep 2 launches B first); A and B of a case are launched in the same message; at most 6 case agents in flight (shared limit of all sessions of this batch). Directional only.

## Task prompt
Shared text, then one sentence: A = no tool, do not look for one; B = the tool and how to run it (Tool sentence in B: what the tool does, that labels are suggestions, never mark Covered from a label, continue if it fails (condensed from SKILL.md steps 5-6 and Rules).). Answers come through the hand-back message (SubagentHandback) and are saved verbatim in `evidence/answers/`.

## Wrapper (neutral, same command in both arms)
`node tool.mjs` (no arguments). Arm B runs the skill's real steps 4 and 5 (`candidates`, then `classify` with Jev live) from a copy of the JEV working tree and prints a digest of pack.json + results.json: per criterion the five candidate tests with file:line, Jev label, p and `skippable`. Arm A prints "tool disabled". Each B run appends one line to `evidence/_logs/<case>.B.r<n>.jsonl` (status, requests, latency, cost, every pair label).
The JEV code is read from a copy of the working tree (read-only, never edited). Arm A cannot hide the skill from subagents (they see the session's skill list), so A is checked mechanically after the run: `subagent_usage.mjs --forbid "<skill|script names>"`; a case with forbiddenCalls > 0 is discarded and re-run in a new folder (`<case>.A2`), the discarded run kept in `evidence/contaminated-run<n>/`.

## Cases and what pass means
| Case | Material | Gold |
|---|---|---|
| acc-01-registration | the JEV demo (DEMO-42 user registration, 7 criteria, 10 tests); in-sample: its authors tuned the labels on it | gold = the demo's own hand-written `coverage` block (Covered x4, Partial x1, Missing x2, one of them a name-only test) |
| acc-02-cart | own: cart and coupons, 6 criteria, 15 tests | Covered x2, Partial x3, Missing x1 (name-only trap) |
| acc-03-uploads | own: image upload, 6 criteria, 11 tests | Covered x3, Partial x2, Missing x1 (no test at all) |
| acc-04-booking | own: meeting-room booking, 6 criteria, 8 tests | Covered x3, Partial x2, Missing x1 (name-only trap) |

**Pass rule:** every criterion's verdict is in the accepted set of the key (Missing-by-name-only also accepts Unclear). Also recorded: criteria right, and "false Covered" (Covered where the key says less).

The answer key (gold lists, hidden tests, accepted verdicts) stays outside the work folders and outside the repo until the runs are done; fixtures given to the agents have no gold block, no `gold.json`, no saved run outputs. Steps 1-3 and 7-8 of the skill (writing criteria.json, JUnit, verdicts.json, report.md) are not part of the measured task: criteria.json is given, no JUnit file is made, and the agent returns the verdicts directly.

## Tokens and evidence
Real tokens per case agent from its subagent transcript (`subagent_usage.mjs`, input + output + cache read + cache write), plus model turns and tool calls. `evidence/texts/<case>.<A|B>.txt`: the first output each agent saw (B: the wrapper output; A: the first file/test output). Engine decisions per call in `evidence/_logs/`. Scoring is by script (`grade` in the harness), never by the agent's own claim.

## Out of scope
Fixing the tool; the model router's choice of model; large real repositories; the hook / prune / backtest parts of the skill.
