---
name: story-batch-planner
description: "Plan a batch of stories BEFORE spawning one agent per story: builds a dependency graph from explicit links plus shared files, modules, API/DTO contracts, schema migrations and test fixtures, reports cycles and incomplete stories, and packs the rest into execution waves (JSON + summary) that subagent-model-router can dispatch. Optional TypeSafe Jev shadow mode classifies only the ambiguous pairs and never changes the waves. Use when an orchestrator is about to run several stories in parallel, or the user asks which stories can run together / in what order."
compatibility: Node.js 18+. Shadow mode (--jev) needs OPENROUTER_API_KEY; without it the planner runs fully rule-based.
---

# Story batch planner

`<skill-dir>` is the folder holding this SKILL.md. Run scripts from the project root; never `cd`.

## Use

1. Write the batch as JSON (`stories[]`: `id`, `title`, `description`, `ac[]`, optional `links[]`
   `{type:"depends_on", id}`, `files[]`, `modules[]`, `contracts[]` `{name, role: producer|consumer}`,
   `tables[]`, `migrations[]`, `fixtures[]`; optional `policy` overrides). See `fixtures/`.
2. Plan:

```bash
node <skill-dir>/scripts/plan.mjs --in batch.json --out plan.json --summary
```

3. Show the user the summary, especially **Needs a decision** (cycles, incomplete stories, unknown
   pairs). Do not invent an order for a cycle; ask.
4. Dispatch wave by wave: for each `dispatch[]` entry of wave N, write `task` to a file and route it
   with `node .claude/skills/subagent-model-router/scripts/route.mjs --mode apply --task-file <f> --type general-purpose`,
   then spawn those agents in one message (separate worktrees). Start wave N+1 only after wave N merged.

## What decides what

| Evidence | Relation | Handling |
|---|---|---|
| ADO link / "depends on S-2" in text | `depends_on` | hard order (highest precedence) |
| A adds endpoint/DTO, B calls it | `depends_on` (`contract_role`) | order A → B |
| same file, fixture, DTO changed by both | `shared_resource` | serialize |
| both add migrations / schema + reader | `shared_resource`, protected | serialize, Jev can never parallelize |
| same module only, topical overlap, incomplete story | `unknown` (ambiguous) | serialize + review; Jev candidate |
| nothing shared | `likely_independent` | same wave allowed |

Cycles → reported, members and their dependents are not scheduled. Incomplete stories (< 8 words,
no metadata) → review, scheduled alone in a final wave. `maxConcurrency` (config, default 4) splits wide waves.

## Jev shadow (Phase 3)

`--jev` asks Jev (`typesafe/jev-1.13`, closed labels `independent`, `shared_module_or_contract`,
`depends_on_A`, `depends_on_B`, `unknown`) about the **ambiguous pairs only**, capped by
`jev.maxCalls` (10). Answers land in `edges[].jev_suggestion` with provenance and `applied:false`
and in `~/.story-batch-planner/jev-shadow.jsonl`. Invalid / timeout / error / over budget → `unknown`.
Waves never change. Sends story title, first 400 chars of description, 3 ACs and module names to
OpenRouter: only with Security approval for the project's data.

## Tests

`node --test <skill-dir>/test/` (no network). `node <skill-dir>/bench/eval.mjs [--jev]` scores the
fixtures: false-parallel, dependency recall, over-serialization, Jev agreement.
