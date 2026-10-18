# Design: git-risk-scanner retro measurement (20261018-grs-agent-01)

Frozen before step 6 (`evaluation.criteriaFrozenAt` in manifest.json). Findings about the measurement design from the independent review are fixed here before the runs; findings about the tool are accepted for this run and not fixed.

## Arms
| Arm | What runs |
|---|---|
| A | plain Claude (Haiku 5.5, effort xhigh); prompt says no tool is available and not to look for or use any skill, script or helper; `node tool.mjs` exists in the folder and prints "tool disabled" |
| B | same prompt + one sentence about the tool; `node tool.mjs` runs the skill's real core with Jev live (typesafe/jev-1.13 via OpenRouter Decisions API, key from the environment; repo is public so sending is allowed) |

Same case ids, folders (fresh copy per case, arm and repetition), prompt text, model and effort. Case agents are forced to Haiku 5.5 with effort xhigh by the user's decision, whatever the model router says. Repetitions: 2 (rep 2 launches B first); A and B of a case are launched in the same message; at most 6 case agents in flight (shared limit of all sessions of this batch). Directional only.

## Task prompt
Shared text, then one sentence: A = no tool, do not look for one; B = the tool and how to run it (Tool sentence in B: run `node tool.mjs <file>` before editing; if flagged follow the Defensive-mode block; guidance only; continue if it fails.). Answers come through the hand-back message (SubagentHandback) and are saved verbatim in `evidence/answers/`.

## Wrapper (neutral, same command in both arms)
`node tool.mjs <file>`. Arm B runs the skill's real `score_files` (same four lines as `scan`, Jev live) and prints the table and Defensive-mode blocks exactly as the skill does. Arm A prints "tool disabled". Each B run appends one line to the run log (formula, Jev p and adjust, final risk, flagged).
The JEV code is read from a copy of the working tree (read-only, never edited). Arm A cannot hide the skill from subagents (they see the session's skill list), so A is checked mechanically after the run: `subagent_usage.mjs --forbid "<skill|script names>"`; a case with forbiddenCalls > 0 is discarded and re-run in a new folder (`<case>.A2`), the discarded run kept in `evidence/contaminated-run<n>/`.

## Cases and what pass means
| Case | Material | Gold |
|---|---|---|
| grs-01-billing | fix-heavy file (26 commits, 22 fixes, 4 authors, reverts): the formula alone flags it (5.5, threshold 4.5); traps: pct <= 0 and > 100 guards, Decimal half-up rounding, None lines | hidden tests check each guard |
| grs-02-sync | workaround/incident messages with no fix keywords: formula 3.2 (not flagged), Jev p ~0.97 lifts it to 4.6 (flagged): the only case where Jev changes the outcome; traps: sleep before commit, one retry on Locked, null-owner skip | hidden tests use a store that fails if commit comes too soon or on the first try |
| grs-03-format | control: 14 cosmetic "fix typo / lint / formatting" commits (formula 2.0, not flagged); the three guards (None currency, int(), str()) really are redundant for the callers, nothing history-based to preserve | hidden tests check ordinary behaviour only (zero, negative, collapsing, stripping), so any sensible simplification passes |
| grs-04-legacy | short history with one fix commit (formula 1.6, not flagged; "add tests" is the last change): the tool cannot help; trap: empty / None input guard | hidden tests check blank, empty and None input |

**Pass rule:** visible tests green AND hidden edge-case tests green AND the original tests unchanged AND the module has fewer code lines than before (doing nothing fails). Pass is decided by running the tests on a clean copy with the agent's version of the module, never by the agent's claim.

The answer key (gold lists, hidden tests, accepted verdicts) stays outside the work folders and outside the repo until the runs are done; fixtures given to the agents have no gold block, no `gold.json`, no saved run outputs. Filler commits in the case repos change only a REV constant (grs-02: six TUNING_ constants, which is what puts its formula at 3.2, just under the threshold); the fix commits add the real guards, so `git log -p` shows real diffs for the guards and the messages carry the reason. The skill's optional PreToolUse hook (step 3) and the backtest (step 4) are not measured: a subagent cannot switch a hook on for one arm only.

## Tokens and evidence
Real tokens per case agent from its subagent transcript (`subagent_usage.mjs`, input + output + cache read + cache write), plus model turns and tool calls. `evidence/texts/<case>.<A|B>.txt`: the first output each agent saw (B: the wrapper output; A: the first file/test output). Engine decisions per call in `evidence/_logs/`. Scoring is by script (`grade` in the harness), never by the agent's own claim.

## Out of scope
Fixing the tool; the model router's choice of model; large real repositories; the hook / prune / backtest parts of the skill.
