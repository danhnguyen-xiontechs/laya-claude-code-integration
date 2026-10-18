# Design: A vs B for subagent-model-router (frozen before running)

**Variable = the case agent's model.** Skipped steps 1-3 (tool exists). Exception to the retro brief: agents are not forced to Haiku.

| | model of the case agent | cascade |
|---|---|---|
| **A** | `sonnet` for every case (the default) | none (a failed case stays failed) |
| **B** | what `route.mjs --mode apply --provider jev --policy gate+sc --k 3 --type <task.type> --json` returns for that exact prompt (Jev live) | on a failed automatic check, one retry at `route.mjs --escalate-from <tier>`, in a fresh work folder (`<case>.B.r<n>.esc`) |

Effort xhigh for all agents (the brief). Subagents are `general-purpose` (like the tool's own pilot); the router is asked with the task's declared type (`Explore` for e1/e2), as `bench.mjs route` does, so rule results match the tool's bench.

**Cases (6, from `bench/tasks`):** e1-locate, e2-count (explore, router: haiku), r1-rename (refactor; rules haiku, Jev sonnet), f1-paginate (fix), d3-maplimit (4-bug debug), d5-deps (design; the one task Haiku failed in the tool's benchmark). 2 repetitions, A and B of a case in one message, repetition 2 launched B first, at most 6 agents in flight.

**Pass** = the task's own `check.mjs` (hidden tests / exact answer) run by us on the agent's work folder, never the agent's claim. Hidden tests, mutants and solutions stay in the repo's `bench/tasks`; agents receive only a copy of `files/`, and the prompt tells them to use files inside their folder only. Mechanical check afterwards: `subagent_usage.mjs --forbid "subagent-model-router|bench[\/]tasks|hidden|solution"` over both arms (a hit = the agent looked at the answer key; that run is discarded and re-run). A cannot hide the router (the "tool" is the tier choice, agents never see it), so there is no arm-A contamination check for the skill itself.

**Cost metric.** Tokens per case from the agent's transcript (input, output, cache read, cache write), weighted by the tool's own price table (`scripts/pricing.mjs` / README §4a, USD per MTok: Opus 4 in / 20 out / 0.20 cache read; Sonnet 2 / 10 / 0.20; Haiku 0.10 / 0.50 / 0.01; cache write 1.25x input, 1 h 2x). So 1 Haiku output token = 0.05 Sonnet output tokens. Cost of B includes failed and retried attempts. The report builder's token cards are raw unweighted tokens; the weighted cost is stored in `usage.cost` and shown in the headline/summary of this run. The cost of the routing call itself (Jev, ~$0.00005 per call) is not counted; the orchestrator's own tokens are not counted.

**Known property of the setup.** Routing is decided on the prompt text with the real work folder path (as an orchestrator would). Where the router returns sonnet, arm B and arm A are the same configuration, so those cases only measure run-to-run noise.

## Amendment after the independent review (before grading was final)
- Review found the `--forbid` check only reads tool inputs. Added `scan_results.mjs`, which also scans what each agent's tools returned; result in `evidence/leak-scan.json` (0 hits in 24 agents), on top of `forbiddenCalls` 0 for all 24.
- Review noted B gets a retry A does not. No escalation happened in any run (24/24 first-attempt passes), so the first-attempt pass rate equals the cascade pass rate; the asymmetry did not matter here.
