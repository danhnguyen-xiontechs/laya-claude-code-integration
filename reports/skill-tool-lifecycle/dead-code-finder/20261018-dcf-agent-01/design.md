# Design: dead-code-finder retro measurement (20261018-dcf-agent-01)

Frozen before step 6 (`evaluation.criteriaFrozenAt` in manifest.json). Findings about the measurement design from the independent review are fixed here before the runs; findings about the tool are accepted for this run and not fixed.

## Arms
| Arm | What runs |
|---|---|
| A | plain Claude (Haiku 5.5, effort xhigh); prompt says no tool is available and not to look for or use any skill, script or helper; `node tool.mjs` exists in the folder and prints "tool disabled" |
| B | same prompt + one sentence about the tool; `node tool.mjs` runs the skill's real core with Jev live (typesafe/jev-1.13 via OpenRouter Decisions API, key from the environment; repo is public so sending is allowed) |

Same case ids, folders (fresh copy per case, arm and repetition), prompt text, model and effort. Case agents are forced to Haiku 5.5 with effort xhigh by the user's decision, whatever the model router says. Repetitions: 2 (rep 2 launches B first); A and B of a case are launched in the same message; at most 6 case agents in flight (shared limit of all sessions of this batch). Directional only.

## Task prompt
Shared text, then one sentence: A = no tool, do not look for one; B = the tool and how to run it (Tool sentence in B: what the scanner does (rules + Jev tiers A/B/C), that tiers are suggestions, verify before listing, continue if it fails.). Answers come through the hand-back message (SubagentHandback) and are saved verbatim in `evidence/answers/`.

## Wrapper (neutral, same command in both arms)
`node tool.mjs` (no arguments). Arm B runs the skill's real `scan .` (Jev live) from a copy of the JEV working tree and prints report.md, the one file the skill tells Claude to read. Arm A prints "tool disabled". Each B run appends one line to the run log (tier counts, Jev cost/latency, how many tiers Jev changed, per-candidate tier with and without Jev).
The JEV code is read from a copy of the working tree (read-only, never edited). Arm A cannot hide the skill from subagents (they see the session's skill list), so A is checked mechanically after the run: `subagent_usage.mjs --forbid "<skill|script names>"`; a case with forbiddenCalls > 0 is discarded and re-run in a new folder (`<case>.A2`), the discarded run kept in `evidence/contaminated-run<n>/`.

## Cases and what pass means
| Case | Material | Gold |
|---|---|---|
| dcf-01-demo | the JEV demo (`examples/dead_code_demo`, 13 files, 21 dead/junk items, 28 decoys); in-sample: tuned by the skill's authors | gold = the demo's `gold.json` (dead + junk-debug + junk-comment-code = dead; alive decoys, test-only, intentional output, examples, disabled-with-reason = decoy; dead branches = neutral) |
| dcf-02-ordersapi | own: decorator routes/tasks, getattr dispatch, entry points, test-only helper; 8 dead, 13 decoys | key kept in scratch |
| dcf-03-pluglib | own: `__init_subclass__` registry, `__all__`, yaml dotted path, pytest11 entry point; 4 dead, 11 decoys | key kept in scratch |
| dcf-04-shopapp | own: dotted paths in settings/urls, decorator receivers/admin, management command, junk; 8 dead, 10 decoys | key kept in scratch |

**Pass rule:** no wrong item listed (a decoy, or anything not in the key as dead or neutral) and recall of dead items >= 75% (rounded up); public API means names in __all__ or declared entry points (stated in the prompt). Neutral items (transitively dead or ambiguous in a toy app) count neither way.

The answer key (gold lists, hidden tests, accepted verdicts) stays outside the work folders and outside the repo until the runs are done; fixtures given to the agents have no gold block, no `gold.json`, no saved run outputs. The skill's prune steps (delete in batches, run tests, commit) are not part of the task: nothing is deleted. The demo copy has no `gold.json`, `run/` outputs or `.dead-code.json` (which only excluded those two).

## Tokens and evidence
Real tokens per case agent from its subagent transcript (`subagent_usage.mjs`, input + output + cache read + cache write), plus model turns and tool calls. `evidence/texts/<case>.<A|B>.txt`: the first output each agent saw (B: the wrapper output; A: the first file/test output). Engine decisions per call in `evidence/_logs/`. Scoring is by script (`grade` in the harness), never by the agent's own claim.

## Out of scope
Fixing the tool; the model router's choice of model; large real repositories; the hook / prune / backtest parts of the skill.
