---
name: codebase-task-explorer
description: Find where to start in an existing codebase before investigating a bug, tracing an existing feature, planning a refactor or adding a feature. Broad multi-query codemap (JordanCoin/codemap) retrieval, mechanical cleanup, deterministic ranking, then optional TypeSafe Jev batch ranking (on by default when configured), and an evidence-backed handoff. Discovery only — it does not fix or implement. Use on "/codebase-task-explorer <task>" or when the user asks "where is X implemented", "where should I start looking for this bug", "what does refactoring Y touch".
---

# codebase-task-explorer

Shortens the discovery phase. Codemap and deterministic search produce candidates; Jev (optional) ranks them; **you** verify by reading source. Stop at the handoff unless the user asked to continue into implementation.

## Requirements

- `codemap` ≥ 4.6 on PATH, or `CODEMAP_BIN`, or `~/tools/codemap/codemap(.exe)` (release zip `codemap-full_*` includes `ast-grep`). If missing, the script runs a **labelled deterministic fallback** (`git ls-files` path match + `rg` content match, no importer evidence) — say so in the handoff.
- Jev: `OPENROUTER_API_KEY` in the environment. Opt-out: `--provider none`, or `CODEBASE_EXPLORER_JEV=off` (global/per-repo via env), or no provider configured.
- **Security gate:** Jev receives paths, matched symbols, importer counts and the first header comment line of each candidate file — no source bodies. For proprietary repos, ask the user before the first `--provider jev` run in that repo; if they decline, use `--provider none`.

## Stage 0 — understand the task

Pick the mode: `bug` | `feature` (existing flow) | `refactor` | `new-feature`. Extract 3–6 **distinct** search vocabularies (codemap `find` is lexical over paths + symbols, not semantic): domain terms, exact error text, endpoint/UI/DTO names, likely symbol names, implementation concepts (controller/service/repository/validator), legacy synonyms.

If the user named an exact file/symbol, add `--exact` (Jev skipped) or just open it.

## Stage 1 — orientation (only if the repo is new to you)

`codemap --depth 2 .` or MCP `get_structure`. Check `.codemap/config.json` (only/exclude/depth) does not hide source folders.

## Stage 2–3 — candidate pool and ranking

```bash
node .claude/skills/codebase-task-explorer/scripts/explore.mjs --task "<task in the user's words>" --mode bug --queries "term a|ErrorText|SymbolName|concept" --provider jev
```

What it does: one `codemap find -json -limit 30` per query → merge (keeps why each path matched) → drop vendor/generated/build/binary only → rules score (normalized per-query score, multi-query bonus, mode priors) → capped pool (96) → Jev choice batches of 24 (+ `none_of_these`), keep top-4 per batch by **local** rank → one global rerank of the survivors (probabilities are never compared across batches) → rules order for the rest.
Guards: ≤6 calls, ≤24k chars per request; any failure/guard → rules order, flagged. Log: `~/.claude/codebase-task-explorer/runs.jsonl`. `--json` for machine output. Tune with `--batch --keep --max-pool --max-calls --max-payload`.

## Stage 4 — verify (mandatory)

Open the top 3–5, read implementation and tests, follow real references. Use `codemap --importers <file> --json` / MCP `get_importers`, `get_dependencies`, `get_file_context`; for refactors `codemap --diff` / blast radius. Import edges ≠ runtime calls (DI, reflection, events, config-bound routes need manual checks). If coverage is `partial`, a missing edge proves nothing.

If the candidates are wrong or `none_of_these won` → new vocabulary or expand from importers/deps, rerun **once** with a materially different pool. Do not re-call Jev on the same pool.

## Stage 5 — handoff (output)

1. **Likely starting points** — ranked files/symbols, one-line rationale each.
2. **Evidence** — codemap match / importer counts / source lines you actually read (`path:line`).
3. **Investigation path** — what to inspect next and which relationships to verify.
4. **Hypotheses** — labelled as hypotheses until code confirms (bug: 1–3 root-cause candidates; feature: observed flow; refactor: change map + risks; new-feature: analogous implementation + extension points).
5. **Unknowns / limitations** — coverage status, engine (codemap vs fallback), dynamic paths.
6. **Jev contribution** — called or skipped (why), calls, whether its top pick was accepted or overridden by you after reading code.

## Mode notes

- **bug**: include exact error text as a query; look for tests and error handling near the hit.
- **feature**: start from UI label / endpoint / DTO; describe boundaries and unknown hops.
- **refactor**: importers and hubs matter; list consumers and tests; import graph ≠ all runtime deps.
- **new-feature**: find the closest analogous feature and its conventions; flag weak evidence.

Pilot results and caveats: see report section "codebase-task-explorer" in `report/LAYA-JEV-REPORT.*`. Eval: `node eval/run-eval.mjs --provider jev|none`; tests: `node --test tests/explore.test.mjs`.
