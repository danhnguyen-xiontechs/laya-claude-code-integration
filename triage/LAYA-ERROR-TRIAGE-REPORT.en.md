# Laya Error Triage – Feature and Evaluation Report

> Branch: `feat/laya-error-triage` · Date: 2026-10-07 · Status: **STOPPED** – step 2 showed Laya does not pass the bar; the real hook will not be written.
> Idea source: `idea/03-laya-error-triager-mcp.md` (adjusted: a hook instead of MCP, and an extensible category set).
> Vietnamese version: `LAYA-ERROR-TRIAGE-REPORT.md`.

---

## 1. Summary

| | |
|---|---|
| **What it is** | A Claude Code hook. When a Bash command fails, it uses Laya (a small local classifier) to (1) tag the **error category** and (2) point at the **log section with the root cause**. It then attaches a short note next to the failed result for Claude to read. |
| **Goal** | A small win: help Claude focus on the right place when an error log is long and noisy. It is not meant to save quota. |
| **Integration** | A `PostToolUseFailure` hook (matcher `Bash`) in `.claude/settings.json`. No MCP, and Claude does not have to call a tool itself. |
| **Verified** | A failed command fires `PostToolUseFailure`, and Claude reads the `additionalContext` the hook returns (tested for real with `claude -p`). |
| **Current results** | Laya does **worse** than a simple regex: 36% vs 87% on categorization, 38% vs 93% on picking the log section, at about 1.9 s per call. An ablation with 4 ways of asking peaked at 49%. A second ablation (fine-grained categories named after concrete errors) peaked at 73%, still below the 75% bar (section 8). |

---

## 2. Background: what Laya can and cannot do

- Laya is a **BERT-style encoder** (ModernBERT-large, 421M parameters). It **does not generate text**: each call is one forward pass that returns probabilities over predefined answers.
- Three question types:
  - `choice`: pick 1 of N answers, each described by a sentence (truncated at 48 tokens).
  - `noul`: yes/no.
  - `score`: a rating on an ordered scale.
- Context: about 1024 tokens per call at most. Longer text is **silently truncated, keeping the beginning**, so the caller must cut the tail of the log itself.
- Runs locally on CPU, offline, for free. On LENOVO2 it takes about 0.3–0.5 s for short input and 2–3 s near 1024 tokens.
- **Consequence:** Laya only fits small multiple-choice decisions where a wrong pick does no harm. It cannot read and understand long logs, and it cannot write advice.

---

## 3. Current flow: before the tool

```
Claude decides to run a command       e.g. npm test
        │
        ▼
Bash tool runs it → exit code 1, 180 lines of output
        │
        ▼
Claude Code puts the full output into context
        │   (as: "Exit code 1\n<stdout+stderr>")
        ▼
Claude reads all 180 lines itself:
  - progress logs, deprecation warnings, passing tests, library stack frames...
  - finds the real error line on its own
        │
        ▼
Claude decides the next step
```

**Weaknesses (small but real):**
- With long, noisy logs, Claude sometimes chases a warning, or reruns the command with `--verbose` or `| grep` to find the error, which costs an extra turn.
- With short, clear logs there is almost no problem. The tool adds nothing in that case.

---

## 4. Flow after adding the tool

```
Claude runs: npm test
        │
        ▼
Command fails (exit 1), 180 lines of output
        │
        ▼
Claude Code fires PostToolUseFailure
        │   the hook receives JSON on stdin:
        │   { "hook_event_name": "PostToolUseFailure",
        │     "tool_name": "Bash",
        │     "tool_input": { "command": "npm test", ... },
        │     "error": "Exit code 1\n...full output...",
        │     "is_interrupt": false }
        ▼
laya_triage.py
  ├─ Filter: interrupted, or log < 30 lines → exit, do nothing
  ├─ chunker.clean(): strip ANSI colors, the "Exit code" line, repeated lines
  ├─ chunker.chunk(): take the last 60 lines, split into ≤ 5 sections
  │     (split at "Traceback", "Error", "FAIL", blank lines...)
  ├─ categories.load(): base set + the project's .claude/laya-triage.json
  ├─ Laya: error category + section with the root cause
  ├─ Low confidence → exit silently (no hint beats a wrong hint)
  └─ Any error (Laya down, 3 s timeout...) → exit silently (fail-open)
        │
        ▼
Hook stdout:
  { "hookSpecificOutput": { "hookEventName": "PostToolUseFailure",
      "additionalContext": "[Laya triage] category: test_assertion (0.81)\n
                            Suspect section: lines 142–151\n
                            FAIL src/cart.test.ts › applies discount ..." } }
        │
        ▼
Claude sees: the full log + the note → goes straight to the failure
```

**Key points:**
- Claude **still sees the full log**. The note is an extra hint, not a replacement for the log.
- The hook only runs when a command fails, so successful commands are not slowed down.
- No extra model turn. With MCP, Claude would have to call the tool and read its result, which costs a round trip.

### Before vs after, same example

| | Before | After |
|---|---|---|
| Claude receives | 180 log lines | 180 log lines + a note of about 3 lines |
| Claude has to | Filter the noise and find the error line | Read the hint first, then confirm it in the log |
| When the hint is wrong | — | Claude ignores the note and works as "before" |
| Extra cost | 0 | about 0.5–2 s (only on failures) + 30–50 context tokens |

---

## 5. Applying it to Claude Code CLI / Desktop

### Configuration (the project's `.claude/settings.json`, or `~/.claude/settings.json` to use it everywhere)

```json
{
  "hooks": {
    "PostToolUseFailure": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "python D:/Laya/triage/laya_triage.py", "timeout": 5 } ] }
    ]
  }
}
```

**Requirement:** `laya-serve` running at `http://127.0.0.1:8000`, which can be changed with `LAYA_URL`. If the server is down, the hook stays silent and Claude Code works as if the hook were not installed.

This applies the same way to the CLI (`claude`, `claude -p`) and to the Code tab in Claude Desktop, because both read the same settings files.

### Error categories: base set + per-project extension

**Base** (in `triage/categories.py`):

| Category | Meaning |
|---|---|
| `dependency_missing` | A third-party library or tool is not installed |
| `import_or_path` | The project's own module, file, export or path is wrong |
| `syntax_or_type` | A bug in the code: syntax, types, undefined names |
| `test_assertion` | Tests ran but a result differs from the expected value |
| `env_or_config` | Environment variable, config file, script/project file, runtime version |
| `permission_or_network` | Access rights, connection, DNS, port |
| `timeout_or_resource` | Timeout, out of memory, recursion too deep |
| `other` | None of the above |

**Per-project extension:** a `.claude/laya-triage.json` file in the repo:
```json
{
  "add":      { "db_migration": "Database migration failed: schema mismatch, missing column, migration order." },
  "disable":  ["permission_or_network"],
  "override": { "env_or_config": "Missing or wrong .env value, appsettings.json, or Azure config." }
}
```
Laya is zero-shot, so adding a category only means adding a description; nothing is retrained. Keep about 8–12 active categories, and make their descriptions clearly distinct.

---

## 6. Code layout

```
triage/
  LAYA-ERROR-TRIAGE-REPORT.md     # Vietnamese report
  LAYA-ERROR-TRIAGE-REPORT.en.md  # this file
  categories.py                   # base categories + reads .claude/laya-triage.json
  chunker.py                      # cleans the log, splits it into sections (pure regex, < 1 ms)
  eval.py                         # measures Laya against baselines → eval_results.json
  eval_results.json               # results of eval run 1
  ablate.py / ablate_results.json    # ablation 1: input length, with/without `other`
  ablate2.py / ablate2_results.json  # ablation 2: how category descriptions are written
  dataset/
    build_dataset.py              # generates REAL error logs by actually running failing commands
    cases.jsonl                   # 45 cases: command, output, correct category, root-cause marker
  probe/
    event_probe.py                # step 1: logs the hook event JSON
    ctx_probe.py                  # step 1: checks that additionalContext reaches Claude
    settings*.json                # hook configs used by the probes
  (not yet) laya_triage.py        # the real hook – only written if step 2 passes
```

---

## 7. Step 1 – Verify the hook mechanism (DONE)

Ran `claude -p` (Claude Code 2.1.286) with a logging hook on both events:

| Command | Event fired | Data |
|---|---|---|
| `echo ok` (success) | `PostToolUse` | `tool_response.stdout`, `stderr` |
| `python -c "import nonexistent_mod_xyz"` (failure) | **`PostToolUseFailure`** | `error` = `"Exit code 1\n" + traceback`, `is_interrupt` |

A `PostToolUseFailure` hook returned `additionalContext` containing a marker string, and Claude repeated the exact marker. **Context injection works.**

---

## 8. Step 2 – Dataset and evaluation (DONE)

### Dataset
- 45 cases spread evenly over the 8 categories, all **real logs**: each case writes files into a temp folder and runs a real command (Python 3.14, Node 24, pytest via `uv`, dotnet 10, tsc via `npx`, git).
- About half the cases include real noise before the error line: INFO logs, DeprecationWarnings, many passing tests.
- Labels: the correct category, and a **marker string** that sits in the root-cause line. The log section containing that marker is the correct section.

### Run 1 results

| Task | Laya | Without a model |
|---|---|---|
| Categorization (45 cases) | **36%** | Keyword regex: **87%** |
| Root-cause section (42 cases with ≥ 2 sections) | Pick section A–E: 14% · Yes/no per section: 38% | Last section: 57% · Section with most error keywords: **93%** |
| Latency p50 / p90 | Categorization: 1.9 s / 3.3 s · Yes/no per section: 0.46 s / 1.3 s | under 1 ms |

**Filtering by Laya's confidence:**

| Top probability ≥ | Share of cases that get a hint | Accuracy |
|---|---|---|
| 0.0 | 100% | 36% |
| 0.5 | 49% | 64% |
| 0.6 | 33% | 80% |
| 0.7 | 29% | 85% |

**Main failure:** Laya pushes most answers into `other`. 22 of the 29 wrong answers are `other`.

### Ablation (DONE – `triage/ablate.py`, `ablate_results.json`)
Purpose: check whether the poor result comes from how we ask or from the model itself. Categorization on 45 cases:

| Variant | Laya correct | Latency p50 |
|---|---|---|
| Run 1: last 30 lines, with `other` | 36% | 1.9 s |
| Last 8 lines, with `other` | 44% | 0.99 s |
| Only the section with most error keywords, with `other` | 47% | 0.82 s |
| Last 30 lines, without `other` | **49%** | 2.0 s |
| Only the section with most error keywords, without `other` | 47% | 0.79 s |
| *Keyword regex (for comparison)* | ***87%*** | *< 1 ms* |

- Shorter input and removing `other` gain Laya about 10–13 points, but its best is still **below 50%**.
- Without `other`, Laya just guesses another category instead, usually `dependency_missing` or `timeout_or_resource`. The root problem is that Laya does not understand the log, not that `other` was available.
- Interim conclusion at the time: the failure is the model, not input length or the `other` option. Ablation 2 shows that **how the categories are written** still matters a lot.

### Ablation 2 (DONE – `triage/ablate2.py`, `ablate2_results.json`)
Purpose: check whether the category set (overly abstract descriptions) is the cause. Two rewrites, each on 2 input kinds, same 45 cases:
- **A:** keep the 8 categories, but list concrete error names in each description (`ModuleNotFoundError`, `ECONNREFUSED`...).
- **B:** split into 23 narrow sub-categories (e.g. "Node: Cannot find module 'pkg'", "DNS failure"); Laya picks a sub-category, which is mapped back to the 8.
- Every description is ≤ 41 tokens, so none is truncated at Laya's 48-token limit.

| Variant | Input | Laya correct | Latency p50 |
|---|---|---|---|
| A: 8 categories, concrete descriptions | Last 30 lines | 47% | 1.9 s |
| A | Section with most error keywords | 44% | 0.72 s |
| B: 23 sub-categories → 8 | Last 30 lines | 62% | 1.8 s |
| B | Section with most error keywords | **73%** | 0.66 s |
| *Keyword regex (for comparison)* | | ***87%*** | *< 1 ms* |

Confidence filtering (B + section with most keywords): probability ≥ 0.6 → a hint for 91% of cases, 76% correct.

- **A barely helps:** packing many error names into one long description still pushes Laya toward `dependency_missing`.
- **B clearly helps (+24 points over the previous best):** narrow, concrete options are much easier for Laya to match. Remaining errors are mostly `permission_or_network` and `import_or_path` vs `dependency_missing`.
- **Caveat:** the 23 sub-categories were written after seeing the dataset markers, so 73% is likely optimistic on new logs. (The regex was written the same way.)

---

## 9. Conclusion

> **Step 2 does NOT pass the 75% bar.** Laya's best variant reaches 73% on categorization (fine-grained categories, ablation 2) and 38% on picking the log section. Regex reaches 87% and 93%.
> Recommendation: **do not use Laya as the main classifier.** If a triage hook is built, use option (a); to keep Laya at all, only via option (b) with category set B.

1. **The integration mechanism is sound.** A `PostToolUseFailure` hook with `additionalContext` is the right approach: cheap and automatic.
2. **Laya is the weak link for this problem.** Error logs are full of clear keyword signals (`ModuleNotFoundError`, `AssertionError`, `ECONNREFUSED`...). A regex exploits them better, runs about 2000× faster, and needs no server.
3. **Category wording matters for Laya:** narrow, concrete sub-categories (B) do much better than broad, abstract ones. Even so, Laya stays below the bar and below regex. The two remaining options:
   - **(a)** Build the triage hook anyway, using regex plus keyword-based section picking. The tool is useful, but it no longer involves Laya. **(Recommended)**
   - **(b)** Hybrid: regex first, call Laya (category set B, input = section with most keywords) only when the regex falls into `other`, and use its answer only when its probability is ≥ 0.6. Laya's contribution would be small.
4. **Lesson for future Laya ideas:** Laya has an edge when the signal is **semantic** and keywords cannot catch it, such as judging the intent or difficulty of a natural-language request. It has no edge when the input already carries clear keywords, as error logs do.

---

## 10. How to reproduce

```bash
# 1. Start Laya
LAYA_MODELS=english laya-serve

# 2. Regenerate the dataset (runs the failing commands for real, about 2–3 minutes)
python triage/dataset/build_dataset.py

# 3. Evaluate (about 5–8 minutes on CPU)
python triage/eval.py

# 4. Ablations (about 5–8 minutes each)
python triage/ablate.py
python triage/ablate2.py

# 5. Stop laya-serve when done
```
