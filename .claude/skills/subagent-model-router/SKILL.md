---
name: subagent-model-router
description: "Pick the cheapest adequate model tier (haiku / sonnet / opus) for each subagent BEFORE it is spawned, from local rules plus TypeSafe Jev (or Laya), combined by agreement gating and self-consistency, with an escalate-once-on-failure cascade. Use when an orchestrator is about to spawn subagents (especially many in parallel, one per story), when setting up or tuning the router's PreToolUse hook, or when reading its log or the quota history. Never overrides a model the caller set."
compatibility: Node.js 18+. Provider jev needs OPENROUTER_API_KEY; provider laya needs a local laya-serve; provider none needs nothing.
---

# Subagent model router

Chooses the `model` for an Agent-tool call. A subagent has its own fresh context, so choosing its
model does not break the parent's prompt cache (unlike switching model inside one session).

## Two ways to use it

**1. As an orchestrator (you are about to spawn subagents).** For each subagent, before the
Agent call:

```bash
node .claude/skills/subagent-model-router/scripts/route.mjs --mode apply --task-file <prompt.txt> --type <subagent_type>
```

It prints `haiku`, `sonnet` or `opus` → pass it as the Agent tool's `model`. It prints nothing
when the router cannot decide (provider down) → omit `model`. Add `--json` to see why.
Spawn all subagents in one message as usual; routing takes about 0.6–1.3 s per subagent with
Jev k=3 (the k calls run in parallel), so route them all in one Bash call first.
Mind the orchestrator's own cost: in the pilot, 18 background hand-backs each re-woke the parent
($2.72 of parent spend vs $3.03 for all 18 subagents). Keep the parent's context small and collect
results in as few turns as possible.

**Cascade (required when you route below opus).** When a subagent's result fails its check
(tests, acceptance criteria, an exact expected output), retry it ONCE at the next tier:

```bash
node .claude/skills/subagent-model-router/scripts/route.mjs --escalate-from haiku   # → sonnet
```

The retry is counted in the log, not only documented: a second `--escalate-from` for the same task
and session prints nothing (logged with `tier: null`, reason "retry limit reached"). Pass the same
`--task` / `--task-file` and `--session` as the first call. `opus` has no next tier, so report the
failure. Without an automatic check the cascade cannot catch a miss, and the router adds no tier floor
for that case: the rules and the provider decide, so review those results yourself or use Jev gate+sc.

Which policy (benchmark, 18 small checked tasks, README §4b): for tasks WITH an automatic check,
rules (`--provider none`) + the cascade matched always-opus's pass rate at ~20% of its cost (re-scored 2026-10-18; the earlier ~14% came from stale cached routes). Jev
gate+sc was also 100% but cost ~51%, because it sends most coding tasks to sonnet. Use Jev gate+sc for
tasks WITHOUT an automatic check, where no cascade can catch a miss.

**2. As a PreToolUse hook (automatic).** `scripts/hook-pretooluse.mjs` (matcher `Agent`) sets
`model` when the caller did not set one and the agent definition has no `model` of its own.
Shadow mode (the default) only logs. The README has the settings snippet; it is not
registered anywhere by default.

## Rollback

Turning the router off needs no code change, and it makes no provider call:

```bash
sed -i 's/"mode": *"[a-z]*"/"mode": "off"/' .claude/skills/subagent-model-router/config.json
```

Then remove the `PreToolUse` entry with matcher `Agent` from `.claude/settings.json` (or
`~/.claude/settings.json`) so the hook process does not start at all. `SUBAGENT_ROUTER_MODE=off`
does the same for one shell. With mode `off` the hook is a no-op and `route.mjs` prints nothing.

## Settings

`config.json` ← env (`SUBAGENT_ROUTER_MODE`, `_PROVIDER`, `_POLICY`, `_K`, `_LOG`) ← CLI flags.

| setting | values | default |
|---|---|---|
| mode | `off` / `shadow` (log only) / `apply` | shadow |
| provider | `none` (rules only) / `jev` / `laya` | none: `jev` sends each subagent prompt to OpenRouter, so turn it on deliberately |
| policy | `rules` / `jev` / `gate` / `sc` / `gate+sc` | gate+sc (rules when provider none) |
| k | self-consistency calls (clamped 1–9) | 3 |
| maxUsdPerSession | USD cap per session, from the spend ledger; reached → rule tier, no provider call | 2 |
| maxCallsPerSession | provider calls per session; a batch that would pass it is refused | 60 |

The two caps are set in `config.json` only (no env variable).

- **gate**: final = max(rule tier, Jev tier); a cheaper tier only when both agree.
- **sc**: Jev asked k times with the tier options rotated. If the k answers agree, use that tier. If
  they differ, keep the rule tier and set `unstable: true` in the log (policy v1: a split vote never
  raises the tier by itself).
- Provider error, timeout, invalid output, or a spend/call cap → the rule tier, with `fallback_reason`
  in the log. Never blocks a spawn.

Every decision → `~/.subagent-model-router/log.jsonl`: features, rule, answers, votes, latency,
`cost_usd` (Jev only, from OpenRouter's usage; `cost_unreported` when missing), `unstable`,
`fallback_reason`, `cascade_step` and `retry_of` (cascade only), and `taskHash` (first 12 hex chars of
a sha1 of the prompt). The prompt text is never written.

## Other tools

- `scripts/mine-history.mjs`: quota per model / subagent type / task kind from
  `~/.claude/projects/**/subagents/`. Writes to `~/.subagent-model-router/history/` (prompts stay local).
- `bench/bench.mjs`: 18 synthetic tasks with automatic checks; `validate`, `prepare`, `check`,
  `route`, `score`. See README.
- `scripts/spend-ledger.mjs`: the per-session USD and call ledger (`~/.subagent-model-router/spend.json`)
  behind the caps. It has no lock: parallel routes can lose an update, so a burst may pass a cap slightly.
- `scripts/decision-provider.mjs` duplicates `review-pr-jev-classify`. Both copies are kept in v1; merging
  them is a separate change.
- `scripts/governor.mjs` (agent-budget-governor, opt-in): turns a routed tier into an execution profile (limits, per-story/batch caps, 20% verification reserve, concurrency queue, retry, review_required, reason_codes); JEV shadow-only; JEV never lowers a tier in any mode (`JEV_LOWER_IGNORED`, and `JEV_LOWER_IGNORED_HIGH_RISK` for high-risk work); guarded mode can only raise a tier. Policy in `governor.json` (no prices). Batch: `node scripts/govern.mjs --stories s.json [--provider jev --k 1]`.
- Tests: `node --test test/router.test.mjs test/bench.test.mjs test/governor.test.mjs` (fake provider, no network).
