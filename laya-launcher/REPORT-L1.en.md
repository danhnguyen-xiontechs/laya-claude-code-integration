# laya-launcher (L1): how it works and what it changes in Claude Code

2026-10-06. Code: `laya-launcher/` (`laya_launch.py`, `profiles.json`). Data: `research/ab-1697/`.

## 1. What it is

`laya-launcher` is a small script that runs **before** a `claude -p` session and decides what the model is allowed to see in that session: which built-in tools, which MCP servers, and whether the skill index is included. It is not a Claude Code tool and not a skill; once it has started Claude Code, it is out of the picture.

The decision is made from the task text by Laya, a local BERT classifier (one HTTP call to `laya-serve`, about 1 s on CPU, nothing leaves the machine). Laya answers one question: *what kind of request is this?* The answer picks a row in `profiles.json`; the row becomes CLI flags.

## 2. How plain Claude Code works

A `claude -p "<task>"` session has two parts.

**Startup (before any API call).** Claude Code scans its configuration and builds a *fixed context*:

| Piece | Where it comes from | What goes to the API |
|---|---|---|
| System prompt, CLAUDE.md, memory | Claude Code, repo, `~/.claude` | full text |
| Built-in tools (Read, Edit, Bash, WebSearch, Agent, ...) | Claude Code | one JSON schema per tool: name, description, parameters |
| MCP servers | `.mcp.json`, user/project settings, plugins | the server is started and **each of its tools** adds a schema |
| Skills and slash commands | `.claude/skills/*/SKILL.md`, `~/.claude/skills`, `.claude/commands/*.md`, installed plugins | an index: name + one-line description per entry (the SKILL.md body is loaded only when invoked) |

**The agent loop.** Every turn sends one request containing the fixed context plus the whole conversation so far:

```
turn 1: [fixed context] + [task]                                   -> model: call Grep
turn 2: [fixed context] + [task] + [Grep call + result]            -> model: call Read
turn 3: [fixed context] + [task] + [...] + [Read call + result]    -> model: call Edit
...
turn N: [fixed context] + [everything so far]                      -> final answer
```

Two consequences:

- The fixed context is **resent on every turn**. From turn 2 on it is served from the prompt cache at 0.1x price, but it is paid every time. On the pxp-ai repo the fixed context is **42 tool schemas, 5 MCP servers, 179 skill entries, ~23.8k tokens**; over a 25-turn session that is roughly 600k cache-read tokens for content the model mostly never uses.
- The conversation part grows every turn (tool results are the bulk). This is where most of a long session's cost goes, and nothing in this report changes it.

## 3. How the launcher changes this

The launcher touches **only the startup step**, and only through flags Claude Code already supports.

```
task.txt
  │
  ▼
laya_launch.py
  1. POST task text to laya-serve  ──►  intent = bugfix (p 0.60)
  2. profiles.json["bugfix"]       ──►  tools: Read,Edit,Write,Grep,Glob,Bash
                                        mcp:   {}          (none)
                                        no_skills: true
  3. exec:
     claude -p --tools Read,Edit,Write,Grep,Glob,Bash
               --strict-mcp-config --mcp-config <file with {"mcpServers":{}}>
               --disable-slash-commands
  │
  ▼
Claude Code startup: scans 6 tools, starts 0 MCP servers, builds no skill index
fixed context: ~11.0k tokens (was ~23.8k)
  │
  ▼
agent loop: identical to plain, every request ~12.8k tokens lighter
```

What each flag does:

| Profile key | Flag | Effect on the session |
|---|---|---|
| `tools` | `--tools A,B,C` | Only these built-in tool schemas are sent. The others do not exist for the model; it cannot call them. |
| `mcp` | `--strict-mcp-config --mcp-config <file>` | Ignore every registered MCP server; start only those in the file. `{}` means none. To keep one server (e.g. ADO), put its full config in the profile. |
| `no_skills` | `--disable-slash-commands` | No skill index in the system prompt, no `/command` available. All or nothing: the CLI has no per-skill selection. |

Properties that follow from "startup only":

- **One decision per session, fixed for the session.** The fixed context never changes mid-session, so the prompt cache is never invalidated. (This is the opposite of model routing, where switching models drops the cache.)
- **The model is unchanged.** Pruning and model choice are independent.
- **Fail-open.** If `laya-serve` is down, errors, or the top probability is below `min_prob` (0.5), the `default` profile is used; remove `default` to fall back to plain Claude Code.
- **Laya only reads the head of the task** (`max_len` 1024 tokens; the launcher also caps at 4000 characters). Longer text is truncated silently. Intent is usually stated in the first lines, so this is acceptable for classification, but it is a known limit.
- **Risk is in the profile, not in Laya.** A wrong profile (e.g. read-only `question` for a task that needs edits) makes the session unable to do the job. In the current table, bugfix / feature / refactor / infra share one profile; only `docs` (no Bash) and `question` (read-only) differ.

### When Laya is not needed

If the task type is known, `laya_launch.py --profile bugfix` builds exactly the same command line without calling Laya. Laya earns its place only in unattended pipelines where tasks of mixed types arrive and the profiles genuinely differ by type.

## 4. Real example: pxp-ai bug #1697 (PR4854)

Setup: clean clone at the pre-merge commit, Opus 5.5 in both configurations, 5 runs each, interleaved to reduce time-of-day noise. Each run ends with the agent's diff, the agent's own tests, the original tests as a regression check, and a behaviour check (`semantic_check.py`: the fix must add the exclusion rule the intent classifier scans for; the original code fails it, the real PR passes it).

| Config | Fixed context (tools / MCP / skills) | Tokens, turn 1 | Turns | Median $ (min-max) | Median wall | Behaviour PASS |
|---|---|---|---|---|---|---|
| plain | 42 / 5 / 179 | ~23.8k | 22-32 | 0.829 (0.557-1.106) | 127 s | 2/5 |
| **L1 launcher** | **6 / 0 / 0** | **~11.0k** | 26-28 | 0.762 (0.701-0.894) | 201 s | **5/5** |

Per-run detail (from `research/ab-1697/COMPARE.md`):

| run | intent (p) | turns | cache read | cache write | output | $ | wall s | behaviour |
|---|---|---|---|---|---|---|---|---|
| plain-1 | - | 22 | 829,539 | 29,666 | 7,697 | 0.557 | 103 | fail |
| plain-2 | - | 28 | 1,054,545 | 53,939 | 9,329 | 0.829 | 121 | PASS |
| plain-3 | - | 32 | 1,404,315 | 70,341 | 13,122 | 1.106 | 195 | PASS |
| plain-4 | - | 30 | 1,237,509 | 52,207 | 9,489 | 0.855 | 273 | fail |
| plain-5 | - | 22 | 705,228 | 49,727 | 8,146 | 0.702 | 127 | fail |
| launcher-1 | bugfix (0.60) | 26 | 583,727 | 44,194 | 11,548 | 0.701 | 183 | PASS |
| launcher-2 | bugfix (0.60) | 28 | 784,490 | 49,642 | 14,521 | 0.845 | 192 | PASS |
| launcher-3 | bugfix (0.60) | 27 | 698,597 | 45,026 | 13,104 | 0.762 | 208 | PASS |
| launcher-4 | bugfix (0.60) | 26 | 756,487 | 43,086 | 11,585 | 0.728 | 201 | PASS |
| launcher-5 | bugfix (0.60) | 27 | 762,923 | 53,593 | 15,637 | 0.894 | 261 | PASS |

All 10 runs: own tests pass, regression 4/4, same 4 files changed as the real PR.

What the numbers say:

- **Context cut is real: -54% on the fixed part.** Cache-read totals are lower for L1 at similar turn counts (median 757k vs 1,055k).
- **Cost drop is small: 0.829 -> 0.762 (-8%), ranges overlap.** L1 sessions were longer (26-28 turns, more output tokens), which ate most of the saving. Pruning the fixed context does not shorten the session.
- **Behaviour: 5/5 vs 2/5.** Hypothesis, not proven: without 179 BMad commands and 5 connectors in view, the agent read `prompts/intent_classifier.system.v1.md` (the file that defines which phrases the classifier scans) 5-10 times vs 2-6 in plain, and that file is what makes the fix correct.
- **Laya's contribution is not separated from the flag set.** Laya said "bugfix" all 5 times, so all 5 runs used one command line a human could have typed. A control (same flags, no Laya) has not been run and is the cheapest next step.

## 5. Limits

- One task, one model, n=5, home-made behaviour metric. Differences are suggestive, not significant.
- `claude -p` only. Interactive sessions have no "before start" step; there, the equivalent is uninstalling unused MCPs and plugins.
- Skills are all-or-nothing. Keeping a subset would need `--setting-sources` or `--plugin-dir`; untested.
- Long task text: Laya sees the head only. A length-based fallback to `default` is an option, not implemented.

## 6. Recommendation

- For any automated `claude -p` run with a known task type: use the flag set (or a profile) directly. No infrastructure, no Laya.
- Keep Laya for unattended, mixed-type pipelines only, and run the no-Laya control before relying on it.
- Next experiments, in order: (1) plain + flags, no Laya, 5 runs on #1697; (2) a non-bugfix task (feature or docs) where profiles differ; (3) a task that needs one MCP, to test the "keep one server" path.
