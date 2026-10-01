# Laya test: work item classification

- **Instructions:** `What type of work item is this?`
- **Type:** `choice`, with criteria `a` = Bug, `b` = Feature, `c` = Task
- **Endpoint:** `POST /v1/systemone` (local, CPU)
- **Checkpoint used:** `english` for all 10 cases

## Summary: 8/10 correct (80%)

| # | Input | Expected | Got | Result | P(a) | P(b) | P(c) | Confidence |
|--|--|--|--|--|--|--|--|--|
| 1 | `API returns HTTP 500 when submitting a leave request.` | a | a | ✅ | 0.955 | 0.022 | 0.022 | 0.805 |
| 2 | `The employee profile page shows an incorrect date of birth.` | a | a | ✅ | 0.951 | 0.024 | 0.025 | 0.790 |
| 3 | `Add an option to export leave history to Excel.` | b | b | ✅ | 0.073 | 0.819 | 0.108 | 0.458 |
| 4 | `Implement a new notification center for employees.` | b | c | ❌ | 0.043 | 0.415 | 0.542 | 0.243 |
| 5 | `Refactor the Redis cache repository to improve code maintainability.` | c | c | ✅ | 0.062 | 0.224 | 0.714 | 0.319 |
| 6 | `Update API documentation for the Performance Review endpoints.` | c | b | ❌ | 0.264 | 0.372 | 0.364 | 0.010 |
| 7 | `The Leave History API returns records in the wrong order.` | a | a | ✅ | 0.960 | 0.019 | 0.021 | 0.821 |
| 8 | `Add filtering by department to the employee list.` | b | b | ✅ | 0.057 | 0.840 | 0.104 | 0.505 |
| 9 | `Upgrade the project from .NET 8 to .NET 9.` | c | c | ✅ | 0.150 | 0.300 | 0.550 | 0.113 |
| 10 | `Push notifications are being sent twice for the same event.` | a | a | ✅ | 0.950 | 0.024 | 0.026 | 0.788 |

## Notes

- **Bug (a):** 4/4 correct, all with P ≈ 0.95 and confidence ≈ 0.8. This is the clearest class for the model.
- **Feature (b):** 2/3 correct. #4 `Implement a new notification center...` was classified as Task (c 0.54 vs b 0.41), likely because the word *Implement* also appears in the Task description ("planned implementation").
- **Task (c):** 2/3 correct. #6 `Update API documentation...` was classified as Feature, but it is almost a three-way tie (b 0.372, c 0.365, a 0.264) with confidence 0.01, meaning the model is essentially guessing.
- Correct Task/Feature answers also have lower confidence (0.11–0.51) than Bug answers.
- **Confidence** can serve as a filter: both wrong answers have confidence under 0.25. Sending low-confidence cases to a human for review catches both errors, at the cost of also flagging #9 (confidence 0.113, correct).

Average latency: 2.3 s per request on CPU.
