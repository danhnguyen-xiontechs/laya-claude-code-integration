# Laya routing, 3 tiers, 60 synthetic prompts

## request_only

- Accuracy: **47/60** (78%); within one tier: 58/60
- Predicted distribution: {'haiku': 16, 'sonnet': 19, 'opus': 25}
- Latency: median 350 ms

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
- Latency: median 379 ms

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

## plan_criteria_request_only

- Accuracy: **40/60** (67%); within one tier: 59/60
- Predicted distribution: {'sonnet': 37, 'haiku': 6, 'opus': 17}
- Latency: median 278 ms

| expected \ predicted | haiku | sonnet | opus |
|---|---|---|---|
| haiku | 6 | 13 | 1 |
| sonnet | 0 | 19 | 1 |
| opus | 0 | 5 | 15 |

| top probability | n | accuracy |
|---|---|---|
| 0.0-0.5 | 19 | 47% |
| 0.5-0.7 | 41 | 76% |
| 0.7-0.9 | 0 | - |
| 0.9-1.0 | 0 | - |

Wrong: #1 haiku->sonnet (0.63), #3 haiku->sonnet (0.67), #6 haiku->sonnet (0.55), #7 haiku->sonnet (0.47), #8 haiku->sonnet (0.50), #9 haiku->sonnet (0.51), #10 haiku->sonnet (0.45), #12 haiku->sonnet (0.49), #15 haiku->opus (0.48), #16 haiku->sonnet (0.63), #17 haiku->sonnet (0.59), #18 haiku->sonnet (0.57), #19 haiku->sonnet (0.61), #20 haiku->sonnet (0.53), #34 sonnet->opus (0.50), #42 opus->sonnet (0.40), #43 opus->sonnet (0.44), #44 opus->sonnet (0.43), #45 opus->sonnet (0.42), #49 opus->sonnet (0.48)

## plan_criteria_plus_signals

- Accuracy: **41/60** (68%); within one tier: 59/60
- Predicted distribution: {'sonnet': 36, 'haiku': 5, 'opus': 19}
- Latency: median 326 ms

| expected \ predicted | haiku | sonnet | opus |
|---|---|---|---|
| haiku | 5 | 14 | 1 |
| sonnet | 0 | 19 | 1 |
| opus | 0 | 3 | 17 |

| top probability | n | accuracy |
|---|---|---|
| 0.0-0.5 | 20 | 60% |
| 0.5-0.7 | 39 | 74% |
| 0.7-0.9 | 1 | 0% |
| 0.9-1.0 | 0 | - |

Wrong: #1 haiku->sonnet (0.60), #3 haiku->sonnet (0.70), #5 haiku->sonnet (0.39), #6 haiku->sonnet (0.52), #7 haiku->sonnet (0.47), #9 haiku->sonnet (0.50), #10 haiku->sonnet (0.52), #12 haiku->sonnet (0.51), #13 haiku->sonnet (0.45), #15 haiku->opus (0.46), #16 haiku->sonnet (0.58), #17 haiku->sonnet (0.53), #18 haiku->sonnet (0.54), #19 haiku->sonnet (0.59), #20 haiku->sonnet (0.51), #34 sonnet->opus (0.42), #42 opus->sonnet (0.47), #47 opus->sonnet (0.44), #49 opus->sonnet (0.45)
