# Laya Error Triage – Feature and Evaluation Report

> Branch: `feat/laya-error-triage` · Date: 2026-10-07 · Status: **STOPPED** – step 2 showed Laya does not pass the bar; the real hook will not be written. Round 2 (real error logs, human-reviewed labels, section 9) confirms it: Laya is right 28% of the time, below even a simple rule set.
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
| **Results on real logs (round 2)** | 89 real error logs (Claude Code history + GitHub issues), human-reviewed labels, category set from the detailed plan. Laya is right **28%** of the time (25/89), simple rules 33%, random guessing about 14%, plan bar 80% (section 9). |

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
  v2/                             # round 2: real error logs, following the detailed plan (section 9)
    categories.py                 # 8 categories by debug direction (frozen before seeing data)
    rules.py                      # simple rule set, ~6 regex lines (frozen before seeing data)
    extract_transcripts.py        # pulls failed Bash/PowerShell commands from Claude Code history
    build_label_file.py           # merges logs + Sonnet label suggestions → data/to_label.json
    eval.py / results.json        # scores Laya vs rules (results.json holds only ids + labels, no logs)
    data/                         # real logs + label file – in .gitignore, never pushed
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

## 9. Round 2 – Retest on real error logs (following the detailed plan) (DONE)

### Why it was redone
The results in section 8 had three fairness problems:
1. **Self-made logs:** the 45 cases were generated by running failing commands in a temp folder, not failures hit during real work.
2. **Tuned on the test:** the regex and sub-category set B were written **after** seeing the cases. On 40 new logs nobody had seen, the same Laya B setup dropped from 73% to 57.5%.
3. **LLM labels:** the detailed plan (`laya_error_triager_mcp_detailed_plan.md`, section 14) asks for human labels and forbids using an LLM as the only source of truth.

Round 2 follows the plan: phase 2 (dataset), phase 3 (offline Laya) and section 16 (simple rule baseline).

### Method
| Step | What | Evidence |
|---|---|---|
| 1. Plan categories | 8 categories by **debug direction** (where to look), not by error name. Each description ≤ 29 tokens | `v2/categories.py` |
| 2. Simple rules | ~6 regex lines, "intentionally simple" per plan section 16 | `v2/rules.py` |
| 3. Freeze | Steps 1 and 2 committed **before** collecting or reading any log | commit `2f2b51f` |
| 4. Real logs | 49 failed commands from Claude Code history (ess-be, ess-fe, Act01, Laya…) + 55 logs pasted in GitHub issues (React 14, Node 13, .NET 14, Python 14), each with the real cause from its thread | `v2/extract_transcripts.py`, `v2/data/` |
| 5. Labels | Claude labeled each case and noted ambiguous ones; **the user reviewed and approved** | `v2/data/to_label.json` |
| 6. Scoring | Same input for both: last ~50 cleaned log lines (plan section 11) | `v2/eval.py` |

**Filtering and merging before scoring** (approved by the user):
- Dropped 12 cases that were not command failures: permission prompts, harness blocks, interrupted calls.
- Dropped 3 `UNKNOWN` cases: too few to measure, and their logs are nearly empty. Laya can still answer `UNKNOWN`.
- Merged `FLAKY_TEST` into `ENVIRONMENT` for scoring, since it had only 1 case (plan section 7: merge categories that cannot be separated).
- Commands Claude typed wrong (path, quoting, `sed`/PowerShell syntax) are labeled `CODE_BUG`.

→ **89 cases** remain; both contestants answer the same 89.

### Results

| | Correct / 89 | Accuracy | Macro F1 |
|---|---|---|---|
| Random guess (1 of 7) | ~13 | ~14% | – |
| **Laya** | **25** | **28%** | **0.26** |
| Simple rules | 29 | 33% | 0.33 |
| *Plan bar (section 17)* | *71* | *80%* | |

- **Accuracy** = share of the 89 cases answered correctly.
- **Macro F1** = a score per category, averaged equally. A category that is never recognised pulls it down, so large categories cannot hide failures on small ones.

**Accuracy split by source** (same 89 cases, counted separately):

| Source | Cases | Laya | Rules |
|---|---|---|---|
| Claude Code history | 34 | 32% | 26% |
| GitHub issues | 55 | 25% | 36% |

**F1 per category:**

| Category | Cases | Laya | Rules |
|---|---|---|---|
| BUILD_TOOLCHAIN | 19 | 0.39 | 0.47 |
| ENVIRONMENT (incl. FLAKY_TEST) | 17 | 0.28 | 0.48 |
| DEPENDENCY_MISSING | 16 | 0.32 | 0.48 |
| CODE_BUG | 14 | 0.32 | 0.33 |
| EXPECTED_FAILURE | 14 | 0.24 | 0.00 |
| CONFIGURATION | 9 | **0.00** | 0.21 |

**Laya confidence and latency:**

| Top probability ≥ | Share of cases with a hint | Accuracy |
|---|---|---|
| 0.0 | 100% | 28% |
| 0.4 | 29% | 38% |
| 0.5 | 10% | 56% |
| 0.6 | 6% | 60% |
| 0.7 | 3% | 33% |

Latency p50 / p90: 2.1 s / 3.3 s, vs under 1 ms for the rules.

### How Laya fails
- **Over-predicts `EXPECTED_FAILURE`:** 27 times, against 14 real ones. Environment errors (7/17), code bugs (5/14) and missing dependencies (5/16) get called "harmless". This is the dangerous kind of mistake plan section 23 warns about: Claude could ignore a real failure.
- **Never recognises `CONFIGURATION`:** 4 of 9 configuration cases go to `DEPENDENCY_MISSING`.
- **Confidence is not usable as a filter:** only 10% of cases reach p ≥ 0.5, and even those are only 56% correct. Two cases at p ≥ 0.7 were wrong.

### Caveats
- **The rules also reach only 33%.** Real logs are much harder than the self-made ones in section 8, and the plan's category boundaries are fuzzy. While labeling, Claude and Sonnet disagreed on 17/92 cases.
- **Labels were assigned by Claude and quickly reviewed by the user**, not labeled by a human from scratch.
- **About half the GitHub cases are bugs in the tools themselves** (npm, pytest, Vite…), so `BUILD_TOOLCHAIN` may be over-represented compared with company work.

None of these caveats changes the verdict on Laya: it is below the rules and far below the 80% bar.

---

## 10. Conclusion

> **Final verdict (round 2, real logs):** Laya is right **28%** of the time on 89 real, reviewed error logs, below the simple rule set (33%) and far below the plan's 80% bar. Round 2 hits the plan's stop conditions (section 27): accuracy no better than rules, high category confusion, and 2 s latency.
> **Stop using (zero-shot) Laya for error triage.** No MCP build and no A/B run (plan phase 4 only follows a passing offline result).

**Round 1 conclusion (section 8, kept for reference; those numbers are optimistic, see section 9):**

> **Step 2 does NOT pass the 75% bar.** Laya's best variant reaches 73% on categorization (fine-grained categories, ablation 2) and 38% on picking the log section. Regex reaches 87% and 93%.
> Recommendation: **do not use Laya as the main classifier.** If a triage hook is built, use option (a); to keep Laya at all, only via option (b) with category set B.

1. **The integration mechanism is sound.** A `PostToolUseFailure` hook with `additionalContext` is the right approach: cheap and automatic.
2. **Laya is the weak link for this problem.** Error logs are full of clear keyword signals (`ModuleNotFoundError`, `AssertionError`, `ECONNREFUSED`...). A regex exploits them better, runs about 2000× faster, and needs no server.
3. **Category wording matters for Laya:** narrow, concrete sub-categories (B) do much better than broad, abstract ones. Even so, Laya stays below the bar and below regex. The two remaining options:
   - **(a)** Build the triage hook anyway, using regex plus keyword-based section picking. The tool is useful, but it no longer involves Laya. **(Recommended)**
   - **(b)** Hybrid: regex first, call Laya (category set B, input = section with most keywords) only when the regex falls into `other`, and use its answer only when its probability is ≥ 0.6. Laya's contribution would be small.
4. **Lesson for future Laya ideas:** Laya has an edge when the signal is **semantic** and keywords cannot catch it, such as judging the intent or difficulty of a natural-language request. It has no edge when the input already carries clear keywords, as error logs do.

---

## 11. How to reproduce

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

# 5. Round 2 – real logs (data/ is not in the repo; re-extract on a machine with Claude Code history)
python triage/v2/extract_transcripts.py      # → v2/data/transcript_failures.jsonl
#   (GitHub logs: v2/data/github_failures.jsonl, collected read-only with the gh CLI)
python triage/v2/build_label_file.py         # → v2/data/to_label.json (label + review)
python triage/v2/eval.py                     # → v2/results.json

# 6. Stop laya-serve when done
```
