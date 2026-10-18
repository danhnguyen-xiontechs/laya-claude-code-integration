# Retro round 2 — codebase-task-explorer

- **Baseline:** [`20261017-cte-agent-02`](../20261017-cte-agent-02/report.html) (rework 1; A 12/12 vs B 12/12, tokens +11%) — left untouched.
- **Question:** does gating the helper output on Jev's top-1 probability (top suggestion of the Opus review of the baseline, `input-improvements.md`) make arm B cost no more than arm A at equal pass rate, with no case worse?
- **Change (commit 162ff3f + 92aa80d):** `confidenceGate` — top-1 p < 0.5 or none_of_these → "LOW CONFIDENCE" line + 3 rows; otherwise rows up to cumulative p 0.9 (max 5); `--no-gate` restores the old output.
- **Success (fixed before running):** B tokens (paired) <= A tokens at pass B >= pass A, no case worse.
- Same 6 tasks / blind queries / scorer / scrubbed copy rules as the baseline; Haiku 5.5 xhigh, 2 reps, <= 6 agents at once.
