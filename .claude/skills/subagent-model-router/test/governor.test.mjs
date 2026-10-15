import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGovernorConfig, createBatch, decideProfile, govern, recordUsage, release, onFailure, stalled, summary } from '../scripts/governor.mjs';

const cfg = loadGovernorConfig();
const S = (id, risk = {}, extra = {}) => ({ id, summary: `story ${id}`, risk, ...extra });

test('security override beats JEV: JEV fast cannot lower a security story', () => {
  const p = decideProfile({ story: S('s1', { security: true }), proposedTier: 'fast', jev: { tier: 'fast', confidence: 0.99 }, cfg: { ...cfg, jevMode: 'guarded' } });
  assert.equal(p.model_tier, 'strong');
  assert.equal(p.review_required, true);
  assert.ok(p.reason_codes.includes('RISK_SECURITY'));
});

test('JEV lower answer on high-risk is ignored even when proposed strong', () => {
  const p = decideProfile({ story: S('s2', { migration: true }), proposedTier: 'strong', jev: { tier: 'haiku', confidence: 0.99 }, cfg: { ...cfg, jevMode: 'guarded' } });
  assert.equal(p.model_tier, 'strong');
  assert.ok(p.reason_codes.includes('JEV_LOWER_IGNORED_HIGH_RISK'));
});

test('shadow mode: higher JEV tier recorded, not executed; guarded mode raises', () => {
  const sh = decideProfile({ story: S('s3'), proposedTier: 'fast', jev: { tier: 'opus' }, cfg });
  assert.equal(sh.model_tier, 'fast'); assert.equal(sh.jev_shadow.jev_tier, 'strong'); assert.equal(sh.jev_shadow.applied, false);
  const gd = decideProfile({ story: S('s3'), proposedTier: 'fast', jev: { tier: 'opus' }, cfg: { ...cfg, jevMode: 'guarded' } });
  assert.equal(gd.model_tier, 'strong'); assert.equal(gd.jev_shadow.applied, true);
});

test('incomplete input → configured safe default + review', () => {
  for (const [story, tier] of [[{ id: 'x' }, 'fast'], [S('y'), undefined], [S('z'), 'bogus'], [null, 'fast']]) {
    const p = decideProfile({ story, proposedTier: tier, cfg });
    assert.equal(p.model_tier, cfg.safeDefault);
    assert.equal(p.fallback_mode, 'safe_default');
    assert.equal(p.review_required, true);
  }
});

test('JEV failure → rules stand, fallback rules_only', () => {
  const p = decideProfile({ story: S('s4'), proposedTier: 'sonnet', jev: { error: 'timeout' }, cfg });
  assert.equal(p.model_tier, 'balanced'); assert.equal(p.model, 'sonnet');
  assert.equal(p.fallback_mode, 'rules_only');
  assert.ok(p.reason_codes.includes('JEV_UNAVAILABLE_RULES_ONLY'));
});

test('profile carries explicit limits, model, and reasons', () => {
  const p = decideProfile({ story: S('s5', { files: 12 }), proposedTier: 'balanced', cfg });
  assert.equal(p.model_tier, 'strong');
  for (const k of ['max_turns', 'timeout_ms', 'retry_limit', 'story_cap', 'model']) assert.ok(p[k] != null, k);
  assert.ok(p.reason_codes.includes('RISK_BROAD_SCOPE'));
});

test('budget exhaustion → controlled stop, verification reserve untouched', () => {
  const b = createBatch(cfg, { budget: 10, maxConcurrent: 9, reserve: 0.2 }); // workers get 8
  const a = govern({ story: S('a'), proposedTier: 'strong', cfg, batch: b }); // cap 6
  const c = govern({ story: S('c'), proposedTier: 'strong', cfg, batch: b }); // 6 > 2 left
  assert.equal(a.slot, 'run');
  assert.equal(c.slot, 'stopped'); assert.equal(c.status, 'needs_approval');
  assert.ok(c.reason_codes.includes('BATCH_BUDGET_EXHAUSTED'));
  assert.equal(summary(b).reserved_for_verification, 2);
  const r = recordUsage(b, { storyId: 'a', units: 7, source: 'estimated' });
  assert.equal(r.over_cap, true);
});

test('concurrency: excess stories queue by priority and dequeue on release', () => {
  const b = createBatch(cfg, { budget: 100, maxConcurrent: 2 });
  const ps = [S('1'), S('2'), S('3', {}, { priority: 0 }), S('4', {}, { priority: 5 })].map((s) => govern({ story: s, proposedTier: 'fast', cfg, batch: b }));
  assert.deepEqual(ps.map((p) => p.slot), ['run', 'run', 'queued', 'queued']);
  const next = release(b, '1');
  assert.equal(next.story_id, '4'); assert.equal(next.slot, 'run');
  assert.equal(b.active.size, 2); assert.equal(b.queue.length, 1);
});

test('retry bounded and escalates at checkpoint; usage labelled', () => {
  const b = createBatch(cfg, { budget: 100 });
  govern({ story: S('r'), proposedTier: 'fast', cfg, batch: b });
  const f1 = onFailure(b, 'r', cfg);
  assert.equal(f1.action, 'retry'); assert.equal(f1.model, 'sonnet');
  assert.equal(onFailure(b, 'r', cfg).action, 'stop');
  recordUsage(b, { storyId: 'r', units: 0.5, source: 'actual' });
  recordUsage(b, { units: 0.01, source: 'actual', kind: 'overhead' });
  const s = summary(b);
  assert.equal(s.spent_actual, 0.5); assert.equal(s.overhead_actual, 0.01); assert.equal(s.measured, true);
  recordUsage(b, { storyId: 'r', units: 1, source: 'estimated' });
  assert.equal(summary(b).measured, false);
  assert.throws(() => recordUsage(b, { units: 1, source: 'guess' }));
  assert.deepEqual(stalled(b, Date.now() + 10 * 3600e3), ['r']);
});
