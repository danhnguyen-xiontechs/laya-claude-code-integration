# Stub test, Phase 0B runner

Run: 2026-10-19. No model call and no spend: `stub-cli-0B.mjs` stands in for claude.exe (`node.exe` + stub). Scratch copies: `C:\Users\ADMIN\AppData\Local\Temp\claude\D--XionTechs-Laya\2530e343-4a7e-42ba-8f20-545234f2d355\scratchpad\stub-0B`.
Locked runner `run-0B.mjs` and `run-0B-lock.json` were not modified. Each copy has its own regenerated lock for its inputs.
Synthetic held-out id `HELD-TEST-001` is used in the held-out scenarios. No real held-out id is read or printed.

## Result: all scenarios pass

| Scenario | Expected | Actual status | Reason | Stub calls | Spent (USD) | Result |
|---|---|---|---|---|---|---|
| ok | complete, 93 calls | complete | - | 93 | 1.007556 | pass |
| error | incomplete / call-error, 1 calls | incomplete | call-error | 1 | 0.077556 | pass |
| empty | incomplete / empty, 1 calls | incomplete | empty | 1 | 0.087556 | pass |
| overcap | incomplete / over-cap, 1 calls | incomplete | over-cap | 1 | 0.577556 | pass |
| reserve | incomplete / reserve, 1 calls | incomplete | reserve | 1 | 0.127556 | pass |
| baseline-applied | incomplete / reserve, 1 calls | incomplete | reserve | 1 | 0.127556 | pass |
| baseline-ignored | incomplete / reserve, 2 calls | incomplete | reserve | 2 | 0.1 | pass |
| baseline-missing | incomplete / baseline-missing, 0 calls | incomplete | baseline-missing | 0 | 0 | pass |
| baseline-mismatch-sha | incomplete / baseline-mismatch, 0 calls | incomplete | baseline-mismatch | 0 | 0 | pass |
| baseline-mismatch-total | incomplete / baseline-mismatch, 0 calls | incomplete | baseline-mismatch | 0 | 0 | pass |
| missing-cost | complete, 93 calls | complete | - | 93 | 1.097556 | pass |
| heldout-story | incomplete / held-out-id, 0 calls | incomplete | held-out-id | 0 | 0.077556 | pass |
| heldout-brief | incomplete / held-out-id, 0 calls | incomplete | held-out-id | 0 | 0.077556 | pass |
| not-evaluable-skip | complete, 93 calls | complete | - | 93 | 1.007556 | pass |
| badgrade | incomplete / grader-malformed, 43 calls | incomplete | grader-malformed | 43 | 0.507556 | pass |

## Changes from the locked runner, per scenario
Every copy changes the CLI binary (to node.exe with the stub) and the PREFIX_ARGS line. Nothing else changes unless listed.
- **ok**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **error**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **empty**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **overcap**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **reserve**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`; `const STOP = 12;` → `const STOP = 0.2;`
- **baseline-applied**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`; `const STOP = 12;` → `const STOP = 0.5;`
- **baseline-ignored**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`; `const STOP = 12;` → `const STOP = 0.5;`; `state.spent = state.baseline;` → `state.spent = 0;`
- **baseline-missing**: removed from copy and lock: `baseline-ledger-0B.json`; `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **baseline-mismatch-sha**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **baseline-mismatch-total**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **missing-cost**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **heldout-story**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **heldout-brief**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **not-evaluable-skip**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
- **badgrade**: `const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';` → `const CLAUDE_BIN = "C:\\Program Files\\nodejs\\node.exe";`; `const PREFIX_ARGS = [];` → `const PREFIX_ARGS = ["D:\\XionTechs\\Laya\\reports\\skill-tool-lifecycle\\subagent-model-router\\20261019-model-router-phase0b-plan-01\\stub-cli-0B.mjs"];`
Input edits: heldout-story adds `HELD-TEST-001` to split-0B.json and to the first calibration story's task; heldout-brief adds it to split-0B.json and to pilot/brief.txt; baseline-mismatch-sha sets the ledger's source_sha256 to 64 zeros; baseline-mismatch-total sets total_usd to 0.5. Stub modes: ok (cost 0.01; one E3-style phrase; first R quote not in answer), nocost (as ok, first generation has no cost), error, empty, overcap, badgrade.

## Checks in the ok scenario
- Repeat agreement 9 of 9, gradings 42 and repeat 9, notEvaluable 1 and runnable 14, E3 flag hits, quote-mismatch count, blind-sample count (9), no quoted tier name and an answer label in each blind sample, `--tools ''`, budget and no-session flags present on every stub call, spent = 0.0775562 + 93 × 0.01 = 1.0075562.

## Notes
- The `overcap` scenario is a copy whose stub charges 0.5 on the first generation; the runner halts after recording the call.
- The `reserve` scenario refuses call 2 (sonnet, cap 0.40) before any spawn; the stub log shows 1 call.
- `baseline-applied` and its control `baseline-ignored` differ only in whether the baseline is counted: 1 call vs 2 calls. That is the evidence the baseline changes the reserve outcome.
- `baseline-missing` and both `baseline-mismatch` scenarios halt before the first call, so they show 0 calls.
- `not-evaluable-skip` checks the labels and raw file names for W-19358: none may appear.
- Scratch output stays in the scratchpad folder, not in this project.
