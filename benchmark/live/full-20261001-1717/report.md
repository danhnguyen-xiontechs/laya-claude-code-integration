# Live benchmark: 15 real Claude Code tasks x 4 strategies

Run `full-20261001-1717`. Pass/fail is re-scored from the kept working dirs (`results.rescored.jsonl`). Tokens are read from the proxy log (Anthropic's response), not from Claude Code.

| Strategy | Pass | Errors | Turns | Wall (s) | Output tok | Cache-read tok | Cache-new tok | Cost (summary.json, units unverified) |
|---|---|---|---|---|---|---|---|---|
| fixed_sonnet | 15/15 | 0 | 102 | 519 | 52276 | 3139825 | 486703 | 3552 |
| llm_router | 14/15 | 0 | 132 | 873 | 76567 | 5833164 | 522805 | 6078 |
| laya_router | 15/15 | 0 | 140 | 852 | 75004 | 5634129 | 495022 | 5064 |
| fixed_opus | 13/15 | 2 | 118 | 800 | 65924 | 4916779 | 555015 | 824 |

## Pass by task tier

| Strategy | haiku tasks | sonnet tasks | opus tasks |
|---|---|---|---|
| fixed_sonnet | 5/5 | 5/5 | 5/5 |
| llm_router | 4/5 | 5/5 | 5/5 |
| laya_router | 5/5 | 5/5 | 5/5 |
| fixed_opus | 5/5 | 5/5 | 3/5 |

## Models that actually answered (requests)

| Strategy | haiku | sonnet | opus |
|---|---|---|---|
| fixed_sonnet | 0 | 66 | 0 |
| llm_router | 29 | 17 | 52 |
| laya_router | 34 | 42 | 30 |
| fixed_opus | 0 | 0 | 86 |

## Routed tier vs task label (router strategies)

| Strategy | exact | lower than label | higher than label |
|---|---|---|---|
| llm_router | 13 | 2 | 0 |
| laya_router | 7 | 4 | 4 |

Errored runs: fixed_opus h4, fixed_opus h5 (failed within seconds, likely a rate limit; not re-run).
