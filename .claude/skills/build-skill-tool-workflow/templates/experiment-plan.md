# Experiment Plan — <tool-name>

- **Experiment ID:** `<experiment-id>`
- **Idea approval reference:** <path/link + date>
- **Plan version:** `v1`
- **Status:** `DRAFT | READY | BLOCKED | COMPLETE`
- **Commit/worktree:** <commit SHA / branch>

## Design summary
Problem, intended behavior, inputs/outputs, architecture, and what this experiment is meant to prove.

## Implementation contract
- Input schema:
- Output schema:
- State transitions:
- Provider adapter / feature flag:
- Timeout/retry policy:
- Malformed response policy:
- Provider unavailable policy:
- Shadow/advisory/enforcing mode:
- Redaction/logging rules:
- Rollback procedure:

## Evaluation arms
| Arm | Configuration | Tool loaded? | Jev/Laya enabled? |
|---|---|---:|---:|
| A — plain Claude | current workflow | No | No |
| B — Claude + tool | tool with Jev/Laya live, rules as fallback (or rules only if the tool has no engine) | Yes | Yes |
| C — single-session (optional, controlled) | same as B, but all phases in one Haiku session instead of fresh sessions + capsules | Yes | Yes |

Arms must be fair: same cases, model, effort, repetitions and gold key (kept out of every agent prompt). Arm C is tested only to compare architecture; it is not the default unless its numbers beat B.

How tokens are measured: agent run (transcript_usage.mjs) or content run (count_tokens.mjs):

Auto-compact setting (haiku-100k `autoCompactWindow`) and smart-context-trimming mode, per phase (record separately):

## Fixed controls
- Task set version and task IDs:
- Prompt / acceptance criteria:
- Model and effort/settings:
- Claude Code + skill/hook/plugin versions:
- JEV/Laya version, endpoint mode, config, threshold:
- Commit/workspace/environment/fixtures:
- Permissions and safety limits:
- Repetitions and run-order plan:
- Known limitations or deviations:

## Metrics and success criteria
| Metric | Definition / numerator / denominator | Source | Target | Guardrail |
|---|---|---|---|---|
| Primary quality | | | | |
| Secondary quality | | | | |
| p50 / p95 latency | | | | |
| Input/output/cache tokens | Use actual usage metadata when available | Transcript/API usage | | |
| Tool/provider calls and failures | | | | |
| Safety / false allow / false block | | | | |

## Test plan
- Unit tests:
- Contract tests:
- Integration tests:
- Regression tests:
- Evaluation cases and gold labels/adjudication:
- Failure/fallback tests:

## Stop conditions
- Blocking test failure:
- Critical/Major review finding:
- Safety threshold breach:
- Data quality / environment issue:

## Expected artifacts
- Idea brief:
- Design:
- Unit test report:
- Agent review:
- Raw case results:
- Run notes and execution logs:
- Per-tool report:
- Main report update:

## Deviations log
| Date | Deviation | Reason | Impact on comparability | Follow-up |
|---|---|---|---|---|
