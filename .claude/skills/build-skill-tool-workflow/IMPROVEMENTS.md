# Token-saving improvements and how each one is built

What each improvement is, and **which mechanism carries it**. The mechanism decides how reliable it is:

| Mechanism | What it is | Who enforces it |
|---|---|---|
| **Skill rule** | Text in `SKILL.md` / `phases/*.md` | The model, when it follows the text. It can drift. |
| **Script** | A `.mjs` file in `scripts/` | Runs only when a phase calls it. Deterministic once called. |
| **Subagent definition** | An agent file (model, tool list, compaction window) | The engine, every time that agent type is spawned. |
| **Mod / plugin hook** | A plugin with function hooks (`register.ts`), e.g. `haiku-100k/`, `context-governor/` | The engine, on every event (tool call, model request, session start). Needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and the plugin installed. |
| **Settings** | `~/.claude/settings.json` (`modelSettings`) | The engine. A plugin cannot write it; `/haiku-100k:setup` does it once with the user's OK. |

## Improvements in use

Effects are from the 2026-10-18/19 measurements (`reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/evidence/workflow-v1-v2-comparison.md`, `haiku-100k/README.md`).

| Improvement | Mechanism | Where | Effect |
|---|---|---|---|
| Case agents start small: tool whitelist (Read, Grep, Glob, Bash, Write, Edit, Skill) | **Subagent definition** | `haiku-100k/agents/haiku-case.md` (type `haiku-100k:haiku-case`) | Start context 57k → 14-18k; cache read per case agent 288k → 75k. The largest saving of v2. |
| Haiku subagents compact under 100k | **Subagent definition** (`autoCompactWindow: 100000`) | same file | 20-chunk test (~240k tokens read): max request 64k, 0 over 100k. 98000 was silently ignored (below the minimum). |
| Main Haiku sessions compact at ~92k | **Settings** (`modelSettings.autoCompactWindow: 125000`), written by a plugin command | `/haiku-100k:setup` → `haiku-100k/scripts/setup.mjs` | The engine keeps a 33k buffer: 100000 would compact at ~67k, below an app session's ~73k start, i.e. every request. |
| Slim start for Haiku sessions: rarely used tools deferred behind ToolSearch | **Mod hook** (`tool.describe`) | `haiku-100k/hooks/register.ts` | First request of a headless Haiku session 42.5k → 22.1k. App session not measured yet. |
| Tool results cut before a request crosses ~92k | **Mod hook** (`tool.call`) | `haiku-100k/hooks/register.ts` | Kept the 130k-window test at max 97.7k. |
| Every Haiku request over 100k is flagged | **Mod hook** (`turn.step`, toast) | `haiku-100k/hooks/register.ts` | Visibility only; saves nothing by itself. |
| One fresh session per phase, fed by a ~1k-token capsule | **Script** + **skill rule** | `scripts/make_capsule.mjs`, `phases/*.md`, `SKILL.md` "Starting a phase" | Largest session peak 248k → 174k. Each fresh app session pays its fixed start again, so the phases together cost +18% vs one v1 session. |
| Thin, fresh control session (reads ≤ 50 lines, 5-line hand-backs, `node -e` for single fields) | **Skill rule** | `SKILL.md` "Control-session rules" | Control 4.25M (peak 126k) vs ~7.4M per round shared in v1. |
| Opus at most 2 calls per round, closed input pack | **Skill rule** | `SKILL.md` "Token budget", `phases/phase-4-review-fix-report.md` | The P4 review was one call (58k cache write, no reads). |
| Fewer case runs (4 cases × 2 reps, ≤ 4 in flight), flat case agents | **Skill rule** | `SKILL.md` "Token budget" | Part of the case-agent drop (9.8M → 1.8M), together with shorter cases. |
| Offline gate before any agent spend | **Skill rule** + per-experiment **script** | `SKILL.md`, `design.md`, e.g. `offline-gate.json` | Saves only when it fails. |
| Quiet commands, batched turns, no polling | **Skill rule** | `SKILL.md` "Quiet commands" | Not measured alone. |
| Round cost measured per phase | **Script** | `scripts/phase_usage.mjs`, `scripts/transcript_usage.mjs`, card in `scripts/build_tool_report.mjs` | Measures; saves nothing. In round 4 it covered 2 of 4 phases (cwd rows written wrong). |
| Jev grades free-text case answers in shadow | **Script** (calls Jev) + **skill rule** | `scripts/grade_with_engine.mjs`, `phases/phase-3-measure.md` | PILOT: 98.3% agreement, 0 false passes, $0.005 for 240 rows. Replaces a grading script per round, not Claude tokens. |

## Tried, and not carrying anything now

| Improvement | Mechanism | Why not |
|---|---|---|
| smart-context-trimming (trims tool output) | **Plugin hook** (PostToolUse) | Loads only with `--plugin-dir`, so not in app phase sessions; no trim seen in round 4. |
| context-governor (soft note 120k, strong 200k) | **Mod hook** (`turn.complete`) | Its context was the sum of a whole turn's calls (0.9-5.5M logged), and it checks once per prompt. Fix proposed, not done. |
| fast-compact (verbatim `/compact`) | **Plugin**: skill + compact hook | Manual, one-shot. Never armed in a measured round. |
| Laya as the answer grader | **Script** (local Laya) | REJECT: 58.8% agreement, 7/8 false passes. |
| Jev as a hint inside the agent loop or as a model-tier picker | **Skill** / **hook** (earlier tools) | +7% to +72% tokens with no better answers; never lowered a tier. |

## Rule of thumb for the next improvement

- If it must hold on **every request or tool call**, build it as a **mod hook** or an **agent / settings** value. A skill rule can be ignored.
- If it runs **at a known step**, a **script** the phase calls is enough.
- If it is a **judgement the model makes anyway** (how much to read, when to stop), a **skill rule** is the right weight. Measure it before trusting it.
