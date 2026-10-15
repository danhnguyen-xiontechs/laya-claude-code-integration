import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../bench/bench.mjs';
import { usageCost, tierOf } from '../scripts/pricing.mjs';
import { taskKind } from '../scripts/mine-history.mjs';

const run = (pass, cost) => ({ pass, cost });
// a: haiku passes; b: needs sonnet; c: needs opus
const runs = {
  a: { haiku: run(true, 1), sonnet: run(true, 10), opus: run(true, 20) },
  b: { haiku: run(false, 1), sonnet: run(true, 10), opus: run(true, 20) },
  c: { haiku: run(false, 1), sonnet: run(false, 10), opus: run(true, 20) },
};
const ans = (t) => [{ tier: t }, { tier: t }, { tier: t }];
const routes = {
  a: { rule: 'haiku', answers: ans('haiku'), wallMs: 500 },
  b: { rule: 'haiku', answers: ans('sonnet'), wallMs: 600 },
  c: { rule: 'opus', answers: ans('sonnet'), wallMs: 700 },
};

test('score: labels, pass rate, cost vs opus, cascade', () => {
  const s = score(runs, routes);
  assert.deepEqual(s.labels, { a: 'haiku', b: 'sonnet', c: 'opus' });
  const row = (n) => s.rows.find((r) => r.router === n);
  assert.equal(row('always-opus').passRate, 1);
  assert.equal(row('always-opus').costVsOpus, 1);
  assert.equal(row('always-sonnet').pass, 2);
  // rules: haiku, haiku, opus → passes a, c; b fails; cascade b → sonnet passes
  assert.equal(row('rules-only').pass, 2);
  assert.equal(row('rules-only').cascadePass, 1);
  assert.equal(row('rules-only').escalationRate, 1 / 3);
  assert.equal(row('rules-only').cascadeCostVsOpus, (1 + 1 + 10 + 20) / 60);
  // gate: max(rule, jev) = haiku, sonnet, opus → all exact
  assert.equal(row('jev+gate').exact, 3);
  assert.equal(row('jev+gate').costVsOpus, 31 / 60);
  // jev-only under-routes c
  assert.equal(row('jev-only').under, 1);
});

test('pricing: tiers and a known claude -p usage', () => {
  assert.equal(tierOf('claude-haiku-5-5'), 'haiku');
  assert.equal(tierOf('claude-opus-5-5'), 'opus');
  const c = usageCost('haiku', { input_tokens: 4, output_tokens: 140, cache_read_input_tokens: 34297, cache_creation_input_tokens: 36616, cache_creation: { ephemeral_5m_input_tokens: 36616, ephemeral_1h_input_tokens: 0 } });
  assert.ok(Math.abs(c - 0.00499037) < 1e-6);
});

test('history task kinds', () => {
  assert.equal(taskKind('Where is X defined?', 'Explore'), 'explore/lookup');
  assert.equal(taskKind('Fix the failing test in a.js'), 'fix/debug');
  assert.equal(taskKind('Review the diff and report problems'), 'review/verify');
  assert.equal(taskKind('Write unit tests for slugify'), 'write tests');
});
