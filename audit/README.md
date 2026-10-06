# audit/ — Phase 0 transcript audit

Passive profiler for Claude Code transcripts. It answers **where tokens/cost go** and **which Laya decision point
has the best ROI**. It reads `~/.claude/projects/**/*.jsonl` read-only, makes no LLM or network calls, and is
deterministic. Results: `summary.md`, then `recommendations.md`.

## Run

`python` is not on PATH on this machine; use the Laya tool Python:

```bash
PYTHONIOENCODING=utf-8 /c/Users/ADMIN/AppData/Roaming/uv/tools/laya/Scripts/python.exe audit.py
```

Options: `--projects-root DIR`, `--pricing FILE` (default `pricing.json`), `--out DIR`, `--include SUBSTR`
(session id or project dir), `--labels FILE` (default `topic-labels.csv`). Runtime is about 3 s.

## Files

| File | Content |
|---|---|
| `audit.py` | parser + per-session metrics, cache rebuilds, topic candidates, tool carry → CSVs |
| `audit_report.py` | aggregates → `summary.md`, `aggregates.json` |
| `pricing.json` | per-model $/MTok (input, output, cache_read, cache_write_5m, cache_write_1h) |
| `sessions.csv` | one row per session: category, tokens, cost by component, main vs subagent, context max/median |
| `cost-breakdown.csv` | session × model × main/subagent, tokens and cost per component |
| `cache-expiry.csv` | every request with cache_creation ≥ 20k, with gap, TTL and inferred cause |
| `topic-switches.csv` | top 50 rule-ranked topic-switch candidates, empty `label` column for human labeling |
| `tool-output.csv` | 500 largest tool results: kind, estimated tokens, later requests, estimated carry cost |
| `laya_eval.py` | offline Laya vs rule on labeled candidates (run only after labeling) |
| `recommendations.md` | candidate table + chosen next experiment (hand-written from `summary.md`) |

**Privacy:** the CSVs contain prompt text and file paths from other projects. Do not commit or share them as-is.

## Parsing assumptions (verified 2026-10-05)

- **Dedupe.** One API response is written as several JSONL lines (one per content block), each with the same
  `message.id` and identical `usage`. Usage is counted once per `message.id`. Cross-check on session a3ed186f:
  532 lines → 262 requests, identical totals when deduped by `requestId` instead.
- **Subagents.** Transcripts live in `<session>/subagents/**/agent-*.jsonl` (+ `.meta.json` with type/description).
  They are added to their parent session as `subagent`. Main and subagent message ids never overlap
  (`main_sub_id_overlap` = 0), so there is no double counting.
- `<synthetic>` assistant messages (no API call) are skipped. Corrupt lines are counted in `bad_lines` and skipped.
- **Context size** of a request = input + cache_read + cache_creation. [M]
- **Cache TTL** comes from `usage.cache_creation.ephemeral_5m/1h_input_tokens`. [M] Records without the split are
  treated as 5m.
- **Thinking.** `usage.output_tokens_details.thinking_tokens` exists only on some requests and is already included
  in `output_tokens`. It is reported only where present.
- **Tool-result size.** No per-block token count exists. Size is estimated as serialized chars / 4. [E] Carry cost
  assumes the result is written to cache on the next request and read on every later request until compaction. [E]
- **Human prompts** = `user` records that are not tool results, not `isMeta`, and not command or system-reminder
  wrappers.

## Cost model

API-equivalent cost = Σ tokens × per-model price from `pricing.json`, with longest-prefix model matching.
Input, output and cache-read prices come from the claude-api skill model table. Cache writes are 1.25× (5m) / 2× (1h)
input. **Validated:** recomputing Claude Code's own `cost-state` token totals reproduces its `costUSD` exactly
(5/5 records, using the 1h write price). `cost-state` covers only the last process run of a session, so it validates
unit prices, not session totals.

This is **not Claude subscription quota**. Quota is not visible in transcripts and is not priced like the API.

## Session categories

`normal` (primary aggregates) · `excluded:*` (Laya research project: routing / five-step workflow / PXP runs / this
audit; first prompts matching experiment keywords) · `uncertain:*` (worktree copies, test projects, empty or
prompt-less sessions). Nothing is dropped. Every session appears in `sessions.csv` with its category.

## Heuristics

- **Cache rebuild cause:** session-start / compaction / model-switch / likely-expiry (gap > TTL) /
  prefix-invalidated (cache existed but < 50% reused) / growth. Explicit expiry metadata
  (`prompt_cache_likely_expired`, …) is searched for, but this Claude Code version does not write it.
- **Topic candidates** (prompts with context ≥ 30k): score = 0.6·(1 − word Jaccard vs last 3 prompts) +
  0.2·min(gap, 120 min)/120 + 0.2·switch-keyword. Prompts with < 5 content words get Jaccard ≥ 0.6. Score ≥ 0.6 =
  "flagged". This is a candidate generator and the rule baseline, not ground truth.
- **Dead context:** for each request, the context carried from before the latest flagged switch, priced at
  cache-read rate.

## Labeling → Laya offline eval

1. `cp topic-switches.csv topic-labels.csv`, then fill `label` with SAME_TASK / NEW_TASK / UNCLEAR.
2. Rerun `audit.py`. Section D reports the labeled ceiling and rule TP/FP/FN.
3. Start `laya-serve` (port in `LAYA_URL`, default 8000), then run `laya_eval.py`. It writes `laya-eval.csv` and
   `laya-eval.json` with a threshold sweep and latency.
