// governor.mjs — agent-budget-governor: resource policy owned by subagent-model-router.
// Zero dependencies, Node >= 18. No network; callable in unit tests with no live JEV.
//
// The router proposes a tier; the governor turns it into an execution_profile:
//   tier → model + limits (max_turns, timeout, retry, per-story cap), risk floors, review_required,
//   batch budget with a reserve for orchestration/verification, a concurrency slot or queue
//   position, reason_codes, fallback_mode. JEV (Phase 4) is shadow-only by default: its tier is
//   recorded, never executed; in 'guarded' mode it may only RAISE a tier, never lower one.
// Budgets are abstract units (whatever the caller records). Prices are never hard-coded here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl } from './decision-provider.mjs';

export const GOV_TIERS = ['fast', 'balanced', 'strong', 'review_required'];
const rank = (t) => GOV_TIERS.indexOf(t);
const maxGov = (a, b) => (rank(b) > rank(a) ? b : a);
/** Router tier (haiku|sonnet|opus) ↔ governor tier. */
export const FROM_ROUTER = { haiku: 'fast', sonnet: 'balanced', opus: 'strong' };

export function loadGovernorConfig({ file, overrides = {} } = {}) {
  const f = file ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'governor.json');
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { ...cfg, ...overrides };
}

// ---------------------------------------------------------------------------
// Batch state: budget + concurrency queue
// ---------------------------------------------------------------------------

export function createBatch(cfg, { budget, maxConcurrent, reserve } = {}) {
  const total = budget ?? cfg.batchBudget;
  const r = reserve ?? cfg.verificationReserve;
  return {
    total, reserved: total * r, maxConcurrent: maxConcurrent ?? cfg.maxConcurrent,
    committed: 0,                       // caps of running stories not yet settled
    spent: { actual: 0, estimated: 0 }, // settled usage, labelled
    overhead: { actual: 0, estimated: 0 }, // JEV calls, routing, rework bookkeeping
    active: new Map(), queue: [], usage: [],
  };
}
const spentTotal = (b) => b.spent.actual + b.spent.estimated + b.overhead.actual + b.overhead.estimated;
/** Budget workers may still claim (verification reserve excluded). */
export const workerHeadroom = (b) => b.total - b.reserved - spentTotal(b) - b.committed;

// ---------------------------------------------------------------------------
// Policy: story + proposed tier (+ optional JEV) → execution_profile
// ---------------------------------------------------------------------------

/**
 * story: { id, summary, acs?, risk?: { security, migration, publicContract, ambiguous, files, dependencies }, priority? }
 * proposedTier: governor tier or router tier. jev: { tier, confidence } | { error } | undefined.
 * Pure apart from reading cfg; does not touch the batch (see admit()).
 */
export function decideProfile({ story, proposedTier, jev, cfg }) {
  const reasons = [];
  let fallback_mode = 'none';
  let review_required = false;
  let tier = FROM_ROUTER[proposedTier] ?? proposedTier;

  const complete = story && story.id && story.summary && GOV_TIERS.includes(tier);
  if (!complete) {
    tier = cfg.safeDefault;
    fallback_mode = 'safe_default';
    review_required = true;
    reasons.push('INCOMPLETE_INPUT_SAFE_DEFAULT');
  } else reasons.push(`PROPOSED_${tier.toUpperCase()}`);

  // Deterministic risk floors first: nothing below can undo them.
  const risk = story?.risk ?? {};
  const floor = (t, code) => { if (rank(t) > rank(tier)) tier = t; reasons.push(code); };
  if (risk.security) { floor('strong', 'RISK_SECURITY'); review_required = true; }
  if (risk.migration) { floor('strong', 'RISK_MIGRATION'); review_required = true; }
  if (risk.publicContract) { floor('strong', 'RISK_PUBLIC_CONTRACT'); review_required = true; }
  if ((risk.files ?? 0) >= cfg.broadScopeFiles) floor('strong', 'RISK_BROAD_SCOPE');
  if ((risk.dependencies ?? 0) >= cfg.highDependencyCount) floor('balanced', 'RISK_HIGH_DEPENDENCIES');
  if (risk.ambiguous) { review_required = true; reasons.push('AMBIGUOUS_ACS'); }
  const highRisk = Boolean(risk.security || risk.migration || risk.publicContract);
  if (tier === 'review_required') review_required = true;

  // JEV: shadow (record only) or guarded (raise only). Never lowers; failure → rules stand.
  const shadow = { jev_tier: null, applied: false };
  if (jev) {
    if (jev.error || !GOV_TIERS.includes(FROM_ROUTER[jev.tier] ?? jev.tier)) {
      reasons.push('JEV_UNAVAILABLE_RULES_ONLY');
      if (fallback_mode === 'none') fallback_mode = 'rules_only';
    } else {
      const jt = FROM_ROUTER[jev.tier] ?? jev.tier;
      shadow.jev_tier = jt; shadow.confidence = jev.confidence ?? null;
      if (rank(jt) < rank(tier)) reasons.push(highRisk ? 'JEV_LOWER_IGNORED_HIGH_RISK' : 'JEV_LOWER_IGNORED');
      else if (rank(jt) > rank(tier) && cfg.jevMode === 'guarded') { tier = maxGov(tier, jt); shadow.applied = true; reasons.push('JEV_RAISED'); }
      else if (rank(jt) > rank(tier)) reasons.push('JEV_HIGHER_SHADOW_ONLY');
      else reasons.push('JEV_AGREES');
    }
  }

  const p = cfg.profiles[tier];
  return {
    story_id: story?.id ?? null,
    model_tier: tier,
    model: cfg.tierToModel[tier],
    max_turns: p.maxTurns, timeout_ms: p.timeoutMs, retry_limit: p.retryLimit,
    story_cap: p.storyCap, tools: p.tools,
    escalation: { at: 'checkpoint_after_bounded_failure', over_budget: cfg.overBudget },
    review_required, fallback_mode, reason_codes: reasons, jev_shadow: shadow,
    priority: story?.priority ?? 0,
  };
}

/**
 * Admit a profile into the batch: run now, queue, or stop (budget). Mutates batch.
 * Returns the profile with { slot: 'run'|'queued'|'stopped', queue_position?, status }.
 */
export function admit(batch, profile) {
  const out = { ...profile, reason_codes: [...profile.reason_codes] };
  if (out.story_cap > workerHeadroom(batch)) {
    out.slot = 'stopped'; out.status = 'needs_approval';
    out.reason_codes.push('BATCH_BUDGET_EXHAUSTED');
    return out;
  }
  if (batch.active.size < batch.maxConcurrent) {
    batch.active.set(out.story_id, { cap: out.story_cap, retries: 0, profile: out, t0: Date.now() });
    batch.committed += out.story_cap;
    out.slot = 'run'; out.status = 'spawn';
  } else {
    batch.queue.push(out);
    batch.queue.sort((a, b) => b.priority - a.priority);
    out.slot = 'queued'; out.status = 'wait';
    out.queue_position = batch.queue.indexOf(out) + 1;
    out.reason_codes.push('CONCURRENCY_LIMIT_QUEUED');
  }
  return out;
}

/** One-call governor for the router: decide + admit. */
export function govern({ story, proposedTier, jev, cfg, batch }) {
  return admit(batch, decideProfile({ story, proposedTier, jev, cfg }));
}

// ---------------------------------------------------------------------------
// Phase 2: usage recording (estimated vs actual never mixed) + lifecycle
// ---------------------------------------------------------------------------

/**
 * Record usage. source: 'actual' (platform-reported) | 'estimated'. kind: 'story' | 'overhead'.
 * Returns { over_cap } so the caller can stop the story in a controlled way.
 */
export function recordUsage(batch, { storyId, units, source, kind = 'story', note, log }) {
  if (source !== 'actual' && source !== 'estimated') throw new Error('usage source must be actual|estimated');
  const entry = { storyId: storyId ?? null, units: Number(units) || 0, source, kind, note };
  batch.usage.push(entry);
  (kind === 'overhead' ? batch.overhead : batch.spent)[source] += entry.units;
  if (log) appendJsonl(log, { governor: 'usage', ...entry });
  const a = storyId != null ? batch.active.get(storyId) : null;
  if (!a) return { over_cap: false };
  a.used = (a.used ?? 0) + entry.units;
  return { over_cap: a.used > a.cap, used: a.used, cap: a.cap };
}

/** Story finished (ok or not): release slot + commitment; returns the next queued profile admitted, if any. */
export function release(batch, storyId) {
  const a = batch.active.get(storyId);
  if (a) { batch.committed -= a.cap; batch.active.delete(storyId); }
  if (!batch.queue.length) return null;
  const next = batch.queue.shift();
  return admit(batch, { ...next, reason_codes: [...next.reason_codes.filter((c) => c !== 'CONCURRENCY_LIMIT_QUEUED'), 'DEQUEUED'] });
}

/** Bounded failure checkpoint: retry (escalated one tier) within retry_limit, else stop. */
export function onFailure(batch, storyId, cfg, why = 'check_failed') {
  const a = batch.active.get(storyId);
  if (!a) return { action: 'stop', reason_codes: ['UNKNOWN_STORY'] };
  if (a.retries >= a.profile.retry_limit) return { action: 'stop', reason_codes: ['RETRY_LIMIT_REACHED'], why };
  a.retries += 1;
  const order = ['fast', 'balanced', 'strong'];
  const cur = a.profile.model_tier;
  const next = order[Math.min(order.indexOf(cur) + 1, 2)] ?? 'strong';
  return { action: 'retry', retry: a.retries, model_tier: next, model: cfg.tierToModel[next], reason_codes: ['RETRY_AT_CHECKPOINT', next !== cur ? 'ESCALATED' : 'SAME_TIER'], why };
}

/** Stories past their timeout (stall detection). */
export function stalled(batch, now = Date.now()) {
  return [...batch.active.entries()].filter(([, a]) => now - a.t0 > a.profile.timeout_ms).map(([id]) => id);
}

/** Labelled summary; estimated never reported as measured. */
export function summary(batch) {
  return {
    total: batch.total, reserved_for_verification: batch.reserved,
    spent_actual: batch.spent.actual, spent_estimated: batch.spent.estimated,
    overhead_actual: batch.overhead.actual, overhead_estimated: batch.overhead.estimated,
    worker_headroom: workerHeadroom(batch), active: batch.active.size, queued: batch.queue.length,
    measured: batch.spent.estimated === 0 && batch.overhead.estimated === 0,
  };
}
