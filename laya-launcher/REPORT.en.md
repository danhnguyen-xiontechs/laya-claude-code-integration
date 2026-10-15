# laya-launcher: context-pruning launcher for Claude Code

2026-10-06. Code: `laya-launcher/` (`laya_launch.py`, `profiles.json`, `README.md`). Experiment data: `research/ab-1697/`.

## What it is

- A **launcher script** that wraps `claude -p`. It is not a Claude Code tool and not a skill: it runs once, before the session starts, and then hands over to Claude Code unchanged.
- It decides which **built-in tools**, **MCP servers** and whether the **skill list** are visible to the model in that session, and passes the decision as CLI flags: `--tools`, `--strict-mcp-config --mcp-config`, `--disable-slash-commands`.
- Laya (local BERT classifier, 2 GB RAM, CPU) is used for one thing: classify the task text into an intent (bugfix / feature / refactor / docs / question / infra). The intent selects a profile in `profiles.json`. Laya never sees the code, never changes the model, never runs during the session.
- Everything is local. Model weights are downloaded once (~2.2 GB); task text does not leave the machine.

## Why it matters: what Claude Code sends on every request

Plain Claude Code builds a fixed context at startup and resends it with **every** API request of the session:

| Fixed context | Source | pxp-ai example |
|---|---|---|
| System prompt, CLAUDE.md | Claude Code, repo | always |
| Tool schemas (name, description, parameters) | built-in + MCP tools | 42 tools |
| MCP servers | `.mcp.json`, user/project settings | 5 servers |
| Skill / slash-command index (name + description per entry) | `.claude/skills`, `~/.claude/skills`, `.claude/commands`, installed plugins | 179 entries |

On pxp-ai that is **~23.8k tokens per request** before the model reads one word of the task. From turn 2 on it is served from prompt cache (0.1x price), but it is still paid on every turn, and over a 25-turn session it adds up to ~600k cache-read tokens.

Note: the skill index is only names + descriptions. A skill's full `SKILL.md` is loaded only when the model invokes it.

## Flow

**Plain Claude Code**

```
claude -p "<task>"
  startup: scan tools (42) + MCP (5) + skills (179)  -> fixed context ~23.8k tokens
  turn 1: [fixed context] + [task]                          -> model: call Grep
  turn 2: [fixed context] + [task] + [Grep result]          -> model: call Read
  ...
  turn N: [fixed context] + [whole conversation so far]     -> final answer
```

**With laya-launcher**

```
task.txt
  -> laya_launch.py
       1. ask laya-serve: "What kind of request is this?"  (~1 s, one call)
          -> bugfix (p 0.60)
       2. profiles.json["bugfix"]
          -> tools = Read,Edit,Write,Grep,Glob,Bash ; mcp = {} ; no_skills = true
       3. exec: claude -p --tools Read,Edit,Write,Grep,Glob,Bash
                         --strict-mcp-config --mcp-config {"mcpServers":{}}
                         --disable-slash-commands
  startup: scan tools (6) + MCP (0) + skills (0)   -> fixed context ~11.0k tokens
  turn 1..N: identical loop to plain, each request ~12.8k tokens lighter
```

Key properties:
- Decision is made **once** and is fixed for the session, so the prompt cache is never invalidated.
- Pruned tools do not exist for the model in that session; it cannot call them.
- The launcher shrinks only the fixed part. The growing part (conversation, tool results) is untouched; that is where most of the cost of a long session still goes.
- Fail-open: if `laya-serve` is down, errors, or the top probability is below `min_prob` (0.5), the `default` profile is used; delete `default` to fall back to plain Claude Code.

## `profiles.json`

| Key | Effect | CLI flag |
|---|---|---|
| `tools` | Built-in tools whose schemas are sent. Omit = all. | `--tools` |
| `mcp` | `{}` = no MCP; `{"ado": {...}}` = only that server (full config inline). Omit = registered MCPs as usual. | `--strict-mcp-config --mcp-config` |
| `no_skills` | `true` = no skill index at all. There is no per-skill selection in the CLI; it is all or nothing. | `--disable-slash-commands` |
| `question`, `criteria` | The one `choice` question sent to Laya. Each description < 48 tokens (Laya truncates). | - |
| `min_prob` | Below this, use `default`. | - |

The profile table is where the value is. In the current table, bugfix / feature / refactor / infra share one profile; only `docs` (no Bash) and `question` (read-only) differ. For a known task type, `--profile bugfix` produces exactly the same command line without Laya.

## Evidence (A/B on pxp-ai bug #1697, PR4854)

Opus 5.5 in every configuration, 5 runs each, interleaved. Metric "behaviour" = `semantic_check.py` (fix has the exclusion rule the classifier scans for; original code fails it, real PR passes it). All runs: agent's own tests pass, regression 4/4, same 4 files as the PR.

| Config | Laya role | Fixed context (tools/MCP/skills) | Tokens turn 1 | Median $ (min-max) | Median wall | Behaviour PASS |
|---|---|---|---|---|---|---|
| plain | none | 42 / 5 / 179 | ~23.8k | 0.829 (0.557-1.106) | 127 s | 2/5 |
| **launcher (L1)** | intent -> profile, once | **6 / 0 / 0** | **~11.0k** | 0.762 (0.701-0.894) | 201 s | **5/5** |
| launcher + read gate (L2) | L1 + Laya denies "unrelated" `Read` | 6 / 0 / 0 | ~11.0k | 0.711 (0.596-0.822) | 164 s | 0/5 |
| mcp | agent calls `laya_decide` itself | 42 / 5 / 179 | ~23.8k | 0.730 (0.480-0.830) | 135 s | 0/5 |

Findings:
- L1 cuts fixed context by 54% without breaking cache.
- Cost drop is small (0.829 -> 0.762, ranges overlap): L1 sessions ran longer (26-28 turns) and ate most of the saving.
- L1 had the best behaviour (5/5 vs 2/5). Hypothesis, not proven: without 179 BMad commands and connectors the agent read the classifier prompt file more carefully. One task, n=5.
- L2 is harmful (0/5): Laya cannot separate relevant from irrelevant files (PR files p 0.21-0.26, unrelated `payment.py` p 0.21) and blocked the two files needed for diagnosis. Dropped.
- MCP-only does nothing (0/5): the agent calls Laya once and changes nothing.

## Limits and open points

- One task, one model, n=5, home-made behaviour metric. Not statistically significant.
- **The 5/5 is attributable to the flag set, not yet to Laya.** Laya returned "bugfix" all 5 times, so all 5 runs used the same command line a human could type. A control run (same flags, no Laya) has not been done; it is the cheapest next experiment.
- Laya sees the task head only (`max_len` 1024 tokens, launcher also caps at 4000 chars); longer text is silently truncated. Raising `max_len` costs latency (1024: 2.7 s, 2048: 6 s, 4096: 15 s on CPU). A length-based fallback to `default` is a possible option, not implemented.
- Pruning is all-or-nothing for skills. Keeping a subset would need `--setting-sources` or `--plugin-dir`; untested.
- Applies to `claude -p` only. Interactive sessions have no "before start" step; there, uninstall unused MCPs and plugins.

## Recommendation

- Use the **flag set** (`--tools ... --strict-mcp-config --disable-slash-commands`, or a profile) for any automated `claude -p` run where the task type is known. Zero infrastructure.
- Keep Laya in the loop only for unattended pipelines with mixed task types **and** profiles that actually differ by intent. Run the no-Laya control first.
- Do not pursue L2 (read gate) or MCP-only.
