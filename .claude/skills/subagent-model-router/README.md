# subagent-model-router

Picks the model tier (Haiku 5.5 / Sonnet 5.5 / Opus 5.5) for each subagent before it is spawned,
so that a fan-out of ~20 parallel subagents (one per story) runs each on the cheapest adequate
model. Signals: local rules + TypeSafe Jev (or Laya). Combined by **agreement gating** and
**self-consistency** rather than probability thresholds; backed by an **escalate-once cascade**.

Node 18+ stdlib only. Tests: `node --test test/router.test.mjs test/bench.test.mjs` (18 tests, fake provider).

## 1. Mechanism (verified 2026-10-15, Claude Code 2.1.300)

| question | answer | source |
|---|---|---|
| Can a model be set per subagent call? | Yes: the Agent tool (renamed from Task in 2.1.63) takes `model` (`haiku` / `sonnet` / `opus` / `fable` / a full ID). | docs: sub-agents, "Choose a model" |
| Precedence | per-call `model` > agent definition `model` frontmatter > `CLAUDE_CODE_SUBAGENT_MODEL` > main model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` disables per-call and frontmatter models. A mod's `agent.spawn` hook beats the per-call parameter. | same |
| Can a PreToolUse hook set it? | Yes: `hookSpecificOutput.updatedInput` **replaces the whole tool input** (copy every field) and works only with `permissionDecision` `allow` or `ask` (ignored with `defer`). Matcher `Agent`. | docs: hooks, "PreToolUse decision control" |
| Does it work in practice? | **Yes, tested live**: `claude -p --model sonnet` with the hook in apply mode (via `--settings`), a read-only subagent prompt → hook returned `model: haiku` → the subagent's `meta.json` recorded `"model":"haiku"`, its messages ran on `claude-haiku-5-5` ($0.005), main thread on Sonnet. | this repo, scratch run |

Consequences for the hook design:
- A per-call `model` would override the definition's frontmatter, so the hook **skips subagent types
  whose `.claude/agents/<type>.md` sets `model`** (unless `inherit`) and **never touches a call that
  already has `model`**.
- `permissionDecision: "allow"` is required to carry `updatedInput`; deny/ask permission rules are
  still evaluated against the returned input, so this does not widen permissions.
- Any error, provider failure or non-apply mode → no output, exit 0 → Claude Code behaves exactly
  as without the hook.

## 2. Router

**Rule features** (`ruleFeatures` / `ruleTier` in `scripts/router.mjs`): subagent type (Explore /
claude-code-guide → cheaper; Plan → never below sonnet), hard verbs (imperative *design /
architect*, *refactor across modules*, *migrate*, *debug … failing/flaky*, *find the root cause*,
*fix … race condition / deadlock / leak*), lookup verbs (find/list/locate…, read-only), size (≥6
files, ≥4 explicit ACs, >4000 chars: at most +1 together), and an automatic check (tests /
acceptance / expected output: −1 when the change is local, because the cascade will catch a
failure). Score → haiku / sonnet / opus.

**Jev request** (one call): a Choice `tier` over `haiku|sonnet|opus` whose criteria describe each tier,
plus three Nouls: `multi_file_design`, `mechanical`, `costly_failure` (logged; not used in the
decision yet: on probes they sat near 0.4–0.75 regardless of the task).

**Policies** (`combine`):

| policy | tier |
|---|---|
| `rules` | rule tier |
| `jev` | Jev top label (1 call) |
| `gate` | max(rule, Jev): cheaper only when both agree |
| `sc` | Jev k times with the option order rotated (each tier shown first once for k=3); all equal → that tier, otherwise the highest answer |
| `gate+sc` | max(rule, sc) |

**Cascade policy.** Start at the routed tier. If the subagent's result fails its check (tests,
acceptance, expected output), retry **once** at the next tier (`route.mjs --escalate-from <tier>`).
No check → do not route a code-changing task below sonnet.

**Modes / providers.** `off` / `shadow` (default: log only) / `apply`; `none` (default: rules only,
nothing leaves the machine) / `jev` / `laya`. Log: `~/.subagent-model-router/log.jsonl`, one line per
decision, with a 12-char prompt hash instead of the prompt.

## 3. Enabling it

Orchestrator (explicit, recommended for the parallel-stories flow):

```bash
node .claude/skills/subagent-model-router/scripts/route.mjs --mode apply --provider jev --task-file story-17.txt --type general-purpose
```

Hook (automatic). Add this to `.claude/settings.json` or `~/.claude/settings.json`. **It is not registered anywhere in this repo.**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "node .claude/skills/subagent-model-router/scripts/hook-pretooluse.mjs", "timeout": 15 }
        ]
      }
    ]
  }
}
```

Then pick the mode in `config.json` or the environment: `SUBAGENT_ROUTER_MODE=shadow` first (log
only), `apply` once the log looks right; `SUBAGENT_ROUTER_PROVIDER=jev` only when it is acceptable
to send subagent prompts to OpenRouter.

## 4. Results

### 4a. History: where subagent quota went (`scripts/mine-history.mjs`)

All local transcripts on this machine (132 subagents in 23 sessions), cost at list price as the
quota proxy (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per MTok, cache reads
$0.20/$0.20/$0.01). Raw rows (with prompts) stay in `~/.subagent-model-router/history/`.

- Subagents were **28%** of all spend ($136 of $479); main threads 72%.
- **98% of subagent spend had no `model` set** (inherited the main model). Explicit `haiku` was used
  20 times, for $0.47 in total.

| tier that ran | subagents | turns | cost | share |
|---|---:|---:|---:|---:|
| sonnet | 35 | 1801 | $102.43 | 75% |
| opus | 64 | 809 | $32.73 | 24% |
| haiku | 29 | 245 | $0.56 | 0% |

| task kind | subagents | cost | share |
|---|---:|---:|---:|
| review/verify | 51 | $51.83 | 38% |
| plan/design | 20 | $47.96 | 35% |
| write tests | 7 | $14.49 | 11% |
| fix/debug | 27 | $10.61 | 8% |
| implement | 9 | $7.23 | 5% |
| refactor/migrate | 2 | $1.99 | 1% |
| explore/lookup | 12 | $1.27 | 1% |
| research/summarise, other | 4 | $0.34 | 0% |

Haiku costs 1/20 of Sonnet per token while Opus costs 2× Sonnet. So the money is in moving work
to Haiku, not in avoiding Opus, and the expensive kinds (review, plan/design) are exactly the
ones where Haiku is risky. Rules-only counterfactual (same tokens, re-priced): 102% of actual. It
moves about as much to Opus as to Haiku, so rules alone do not save quota on this history.
History prompts were **not** sent to Jev: that needs the user's OK.

### 4b. Benchmark (`bench/`)

18 synthetic tasks, each with an automatic check (hidden tests stay in the repo, outside the work dir the subagent is told to stay in), validated (every check fails on the untouched
fixture and passes with the reference solution: `node bench/bench.mjs validate`):

| kind | tasks | check |
|---|---|---|
| explore | e1-locate, e2-count, e3-importers, e4-config | exact `answer.txt` |
| fix | f1-paginate, f2-email, f3-days (3 DST time zones), f4-await | visible + hidden tests |
| refactor | r1-rename, r2-extract, r3-promisify | hidden tests + grep for leftovers |
| tests | t1-slugify-tests, t2-csv-tests | agent's tests pass and kill every mutant (5 / 6) |
| design / debug | d1-lru, d2-ratelimit, d3-maplimit, d4-expr, d5-deps | hidden tests only |

Routing of the 18 prompts (offline, already run; Jev k=3, `bench/results/route-jev.json`):

| | haiku | sonnet | opus |
|---|---:|---:|---:|
| rules-only | 16 | 2 | 0 |
| Jev (first call) | 4 | 14 | 0 |
| Jev + gate + sc | 4 | 13 | 1 |

Jev is stable (unanimous on 16/18; split on f1-paginate and d3-maplimit) and confident (top p
0.97–1.0 on most). Rules and Jev disagree on 12/18: rules say Haiku because a test command is given;
Jev says Sonnet. Wall time per decision, k=3 in parallel: p50 ≈ 0.55 s, max 1.3 s; cost ≈ $0.00005
per Jev call.

**Pilot (run 2026-10-15, approved by the user): 6 tasks × 3 tiers.** e2-count (explore),
f1-paginate and f3-days (fix), r3-promisify (refactor), t2-csv-tests (test writing, 6 mutants),
d3-maplimit (debug: 4 bugs). All subagents were general-purpose, so only the model differed; one run
per cell. Records: `bench/results/runs-pilot.jsonl`.

**Every tier passed every task: 18/18. All six labels = haiku.**

| task | haiku | sonnet | opus |
|---|---|---|---|
| e2-count | pass $0.009 | pass $0.178 | pass $0.308 |
| f1-paginate | pass $0.010 | pass $0.180 | pass $0.337 |
| f3-days | pass $0.010 | pass $0.180 | pass $0.341 |
| r3-promisify | pass $0.011 | pass $0.195 | pass $0.144 |
| t2-csv-tests | pass $0.010 | pass $0.198 | pass $0.357 |
| d3-maplimit | pass $0.013 (9 turns) | pass $0.193 | pass $0.355 |
| **total** | **$0.06** | **$1.12** | **$1.84** |

Scored (`node bench/bench.mjs score --run pilot`; cost relative to always-opus on the same tasks):

| router | pass | cost vs opus | exact tier | under-routed | cascade pass | cascade cost | escalations | decision latency p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| always-opus | 6/6 | 100% | 0 | 0 | 100% | 100% | 0% | 0 |
| always-sonnet | 6/6 | 61% | 0 | 0 | 100% | 61% | 0% | 0 |
| rules-only | 6/6 | **13%** | 5 | 0 | 100% | 13% | 0% | <1 ms |
| Jev single | 6/6 | 52% | 1 | 0 | 100% | 52% | 0% | 549 ms |
| Jev + gate | 6/6 | 52% | 1 | 0 | 100% | 52% | 0% | 549 ms |
| Jev + sc (k=3) | 6/6 | 61% | 1 | 0 | 100% | 61% | 0% | 549 ms |
| Jev + gate + sc | 6/6 | 61% | 1 | 0 | 100% | 61% | 0% | 549 ms |

What the pilot shows:
- **Ceiling effect.** These tasks are too easy to separate the tiers: Haiku 5.5 solved even the
  4-bug concurrency debug and the mutant-killing test suite. The pilot therefore measures
  over-routing only. No router under-routed, and the cascade never fired.
- **Jev is safe but expensive here.** It said Sonnet for 5/6 tasks (Haiku only for the explore task),
  so its policies cost 52–61% of always-opus against 13% for rules. Gating and self-consistency only
  ever raise the tier, so they cannot fix over-routing. They protect against under-routing, which
  never happened here.
- **A subagent's cost is mostly fixed overhead.** Every run wrote ~55k tokens of system prompt and
  tools to cache before doing any work, so per-run cost tracks the price per token: Haiku ≈ $0.01,
  Sonnet ≈ $0.18, Opus ≈ $0.34 (1 : 18 : 34) whatever the task. A cheaper tier saves money even on
  tiny tasks; the turn counts were similar (Haiku 4–9, others 3–6).
- **The orchestrator pays too.** This parent session (Opus, large context) spent **$2.72** during the
  pilot, mostly re-reading its context each time a subagent handed back (18 wake-ups). The 18
  subagents together cost $3.03. **Actual pilot total ≈ $5.75** against the ≈ $4 estimate, which had
  budgeted ~$1 for orchestration. For a 20-story fan-out, keep the orchestrator's context small.
  Collect results in one step (e.g. foreground batches, or a script) instead of one wake-up per
  subagent: this matters as much as the subagents' model.
- Task prompts said `node --test test/`, which fails on Node 24 (a directory argument is not
  accepted). Every subagent noticed and ran the file instead; the prompts now say `node --test`.

**Is the full 18 × 3 run worth it?** Not as designed: the 12 remaining tasks are of the same
difficulty, so all-Haiku labels and the same ceiling are the likely outcome, for about $9 more.
Better uses of quota, in order:
1. **Haiku-first labelling** of the other 12 tasks: run Haiku only, and escalate a task to Sonnet
   (then Opus) only when it fails. About $0.15 when Haiku passes, plus about $0.2–0.5 per failure.
   This is the cascade itself, measured.
2. **Harder tasks** that are not solved at every tier: multi-file changes in a real repo, or real
   stories from the parallel-stories flow with their acceptance checks, run Haiku-first the same way.
3. Repeats (2–3 runs per cell) only on tasks where tiers disagree, to measure variance.

How to run (from a Claude Code session, one tier per batch):
```bash
node bench/bench.mjs prepare <task> <tier> --run pilot      # prints the subagent prompt
# spawn the subagent with Agent(model=<tier>, prompt=<printed prompt>), note its agentId
node bench/bench.mjs check <task> <tier> --run pilot --agent <agentId>
node bench/bench.mjs score --run pilot                       # all routers + cascade, offline
```

`score` reports for always-opus, always-sonnet, rules-only, jev-only, jev+gate, jev+sc(k) and
jev+gate+sc: pass rate, cost vs always-opus, exact/under-routed counts, and the cascade simulation
(pass rate, cost and escalation rate).

## 5. Files

```
SKILL.md, README.md, config.json
scripts/router.mjs          features, rules, Jev request, self-consistency, gating, route()
scripts/route.mjs           CLI for orchestrators (+ --escalate-from for the cascade)
scripts/hook-pretooluse.mjs PreToolUse hook (matcher Agent)
scripts/decision-provider.mjs  Jev/Laya client (copy of review-pr-jev-classify's)
scripts/pricing.mjs         list prices, usage → USD
scripts/mine-history.mjs    transcript miner → ~/.subagent-model-router/history/
bench/bench.mjs, bench/lib/ harness: validate / prepare / check / route / score
bench/tasks/<id>/           task.json, files/ (fixture), hidden/ or mutants/, solution/, check.mjs
test/                       node --test, fake provider
```
