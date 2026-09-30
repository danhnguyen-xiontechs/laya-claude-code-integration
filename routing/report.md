# Laya routing, 3 tiers, 60 synthetic prompts

## request_only

- Accuracy: **47/60** (78%); within one tier: 58/60
- Predicted distribution: {'haiku': 16, 'sonnet': 19, 'opus': 25}
- Latency: median 469 ms

| expected \ predicted | haiku | sonnet | opus |
|---|---|---|---|
| haiku | 14 | 4 | 2 |
| sonnet | 2 | 14 | 4 |
| opus | 0 | 1 | 19 |

| top probability | n | accuracy |
|---|---|---|
| 0.0-0.5 | 28 | 64% |
| 0.5-0.7 | 25 | 88% |
| 0.7-0.9 | 7 | 100% |
| 0.9-1.0 | 0 | - |

Wrong: #3 haiku->sonnet (0.43), #7 haiku->sonnet (0.35), #15 haiku->opus (0.36), #18 haiku->sonnet (0.47), #19 haiku->sonnet (0.61), #20 haiku->opus (0.41), #23 sonnet->haiku (0.39), #27 sonnet->haiku (0.52), #30 sonnet->opus (0.47), #31 sonnet->opus (0.43), #33 sonnet->opus (0.45), #34 sonnet->opus (0.69), #49 opus->sonnet (0.47)

## request_plus_signals

- Accuracy: **50/60** (83%); within one tier: 60/60
- Predicted distribution: {'haiku': 19, 'sonnet': 18, 'opus': 23}
- Latency: median 552 ms

| expected \ predicted | haiku | sonnet | opus |
|---|---|---|---|
| haiku | 17 | 3 | 0 |
| sonnet | 2 | 14 | 4 |
| opus | 0 | 1 | 19 |

| top probability | n | accuracy |
|---|---|---|
| 0.0-0.5 | 32 | 75% |
| 0.5-0.7 | 23 | 96% |
| 0.7-0.9 | 5 | 80% |
| 0.9-1.0 | 0 | - |

Wrong: #7 haiku->sonnet (0.37), #18 haiku->sonnet (0.44), #19 haiku->sonnet (0.56), #23 sonnet->haiku (0.41), #27 sonnet->haiku (0.47), #30 sonnet->opus (0.49), #33 sonnet->opus (0.44), #34 sonnet->opus (0.72), #35 sonnet->opus (0.47), #49 opus->sonnet (0.44)
