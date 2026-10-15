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

**Pending: running the tasks.** Labels (cheapest passing tier) need each task run as a subagent on
all three tiers. This spends quota and waits for the user's go-ahead. Estimate at list price:

| run | subagent runs | estimate |
|---|---:|---:|
| pilot: 6 tasks × 3 tiers (e2-count, f1-paginate, f3-days, r3-promisify, t2-csv-tests, d3-maplimit) | 18 | ≈ $4 (≈ $0.3 Haiku, $1.5 Sonnet, $2.4 Opus) |
| full: 18 tasks × 3 tiers | 54 | ≈ $12 (≈ $0.4 / $4.5 / $7) |

(Per run, for small tasks: Haiku ≈ $0.02, Sonnet ≈ $0.25, Opus ≈ $0.40, plus about $1 of
orchestration in the parent session. For scale: the history above is $479 in total.)

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
