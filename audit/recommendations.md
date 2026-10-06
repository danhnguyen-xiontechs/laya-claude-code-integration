# Phase 0 — Recommendations

Based on `summary.md` (run 2026-10-05, 12 normal sessions, $295 API-equivalent cost). All $ figures are
**ceilings** (what disappears if the decision were always right and always acted on), not expected savings.
Tags: [M] measured, [E] estimated, [H] heuristic, [A] assumption.

## What the data says

1. **Cost is driven by context size × request count, not by output.** Cache reads are 97% of tokens and 49% of
   cost. Cache writes are 35%, output (incl. thinking) 16%, uncached input ≈ 0. [M]
2. **Contexts are huge.** Long sessions run at 250k–525k tokens of context per request. Every request in those
   sessions costs $0.05–0.10 just to re-read the context. [M]
3. **Long breaks are expensive.** 17 rebuilds after a gap longer than the cache TTL (median gap ≈ 5.5 h, median
   context ≈ 240k) cost ≈ $30 extra, **10% of all cost**. Claude Code does not persist expiry metadata, so the
   cause is inferred from gaps + measured TTL. [H]
4. **Many large-context prompts look like new work.** 39 of 131 large-context prompts are flagged by the rule.
   If they are real switches, the carried "dead" context costs ≈ $46 (**16%**). 14 of the 32 flagged candidates
   in the CSV also come after a > 1 h gap. This overlaps with point 3: `/clear` at that moment removes both the
   rebuild and the dead context. [H, unlabeled]
5. **Subagents are 45% of cost** ($133), mostly general-purpose agents and workflow fan-out. This is a usage
   pattern, not a Laya decision point. [M]
6. **Tool output is not the lever.** All tool results together ≈ 15% of cost to carry [E]. Truncating outputs
   above 4k tokens would save ≈ 1.5%. Most volume is ordinary Read of code files. [E]
7. **Thinking is a minor part of output.** Where reported (43% of requests), thinking is 19% of output tokens. An
   optimistic effort gate saves ≈ 2.4%. [M+A]

## Candidate table

| Use case | Opportunity (ceiling) | Risk | Complexity | Rule baseline | Laya value | Recommendation |
|---|---:|---|---|---|---|---|
| Session continuity | ≈ $46 · 15.7% [H] (+ overlap with ≈ $30 expiry) | Low: suggestion only, user decides | Low: one `UserPromptSubmit` hook, one Laya call per prompt | context ≥ 150k AND (gap > TTL OR low word overlap) | **Possible**: the rule over-flags short follow-ups and cannot read intent. Laya must beat it on labels | **NEXT EXPERIMENT** |
| Effort / thinking | ≈ $7 · 2.4% [A] | Medium: quality drop on misjudged prompts | High: proxy needed; effort change may invalidate messages cache | prompt length / keywords | Unproven; savings below the 5% "weak" line | Defer |
| Review gate | ≈ $17 · 5.6% [M] (cost of review/verify subagents) | High: false negatives skip needed review | Medium | diff size + risk signals (migration, auth, config) | Low: deterministic signals carry the decision | Defer; revisit if review subagents become routine |
| Tool output gate | ≈ $4 · 1.5% [E] | Medium: losing needed lines | High: hooks cannot rewrite built-in tool output | `PreToolUse` limit on Read/Grep, `tail` on Bash | None: a size limit is the natural rule | Drop for now |
| Documentation gate | ≈ $6 · 2.2% [E] | Low | Low | path allow-list | Low | Drop for now |
| *Cache expiry (no Laya)* | ≈ $37 · 12.4% [H] | none | Very low | "context > X and idle > TTL → suggest /clear or /compact" | Not needed: pure rule | Fold into the session-gate warning |

## Update after draft labels (2026-10-05)

Claude drafted labels for the 50 candidates (`topic-labels.csv`, `label_source=claude-draft`, **pending developer
review**): 42 SAME_TASK, 2 NEW_TASK, 6 UNCLEAR (4 of them are placeholder "xxx…" prompts).
- Labeled NEW_TASK ceiling: **≈ $7 · 2.4%**, below the 5% stop line.
- Rule baseline at score ≥ 0.6: TP 2, FP 27, FN 0 (precision ≈ 7%).
- The ≈ 16% "dead context" in summary G is mostly rule false positives. These users rarely switch topic inside a
  session. Large contexts come from one long task, not from unrelated tasks piled together.

**If the developer confirms these labels, the Session Continuity Gate (topic-switch part) fails go/no-go.** What
remains is the expiry rule (≈ 10%, no Laya needed): "context > X and idle > TTL → suggest /compact or /clear". With
only 2 positives there is also nothing meaningful to evaluate Laya on (`laya_eval.py` would be noise). The
original reasoning below is kept for the record.

## Decision 2026-10-05: rule-only, Laya on hold

- Shipped: `hooks/cache_expiry_gate.py` (rule only; tests and integration in `hooks/tests/report.md`).
- `laya_eval.py` on 44 labeled points (2 NEW_TASK). `english` is worse than the rule. `multilingual` @0.8: TP 2,
  FP 14 vs rule TP 2, FP 27. With 2 positives and a threshold tuned on the same data, this is not evidence that Laya
  wins. Results: `laya-eval-*.json/csv`.
- Laya **not** integrated. Collect real hook decisions (`hooks/cache_expiry_gate.log.jsonl`), label the fired cases,
  and re-evaluate Rule vs Rule+Laya once there are enough NEW_TASK examples.

## NEXT EXPERIMENT (original, before labels): Session Continuity Gate

**Why this one.** It is the only Laya-suitable target above the 15% bar. It is low-risk (it only suggests) and it
attacks the largest cost driver (re-reading huge contexts). The same hook also catches the largest non-Laya waste:
returning after a long break with a 200k+ context.

**Why Laya at all.** The rule baseline is cheap but blunt: it reads word overlap, not intent. It mislabels
"tiếp tục đi" or "commit đi" as switches and misses Vietnamese/English paraphrases. Laya is justified only if it beats
the rule on precision at equal recall, measured on the labels below.

**Before building anything:**
1. Copy `topic-switches.csv` to `topic-labels.csv` and fill `label` (SAME_TASK / NEW_TASK / UNCLEAR) for the 50 rows.
2. Rerun `audit.py`. Section D then reports the **labeled** ceiling and the rule's TP/FP/FN.
3. Start `laya-serve`, then run `laya_eval.py`. It compares Laya (threshold sweep) with the rule.

**Go / no-go:**
- Labeled NEW_TASK ceiling < 5% of cost → stop. Only the expiry rule is worth shipping.
- Laya does not beat the rule on precision at ≥ 0.8 recall → ship the rule, drop Laya for this gate.
- Otherwise → Phase 1 prototype (warning only), then measure realized savings: how often the user follows the
  warning × context dropped.

**Caveats.** 12 sessions only, dominated by 4–5 very long ones. Ceilings ignore the cost of re-reading files after a
`/clear`. Expiry cause is inferred (no explicit metadata in this Claude Code version).
