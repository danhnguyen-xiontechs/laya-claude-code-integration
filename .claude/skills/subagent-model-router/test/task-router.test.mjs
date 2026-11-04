import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruleRoute, signalTier, routeTask, routeKey } from '../scripts/task-router.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-router-'));
const N = (o = {}) => ({ fully_specified: 0.1, cross_file: 0.1, open_design: 0.1, unknown_cause: 0.1, ...o });
/** A fake Jev ask that answers `nouls` and counts calls. */
const fakeAsk = (nouls, ok = true) => { const f = async () => { f.n++; return ok ? { ok: true, nouls, ms: 7, cost: 0.0001 } : { ok: false, error: 'timeout', ms: 3000 }; }; f.n = 0; return f; };
const base = { runId: 'r1', taskId: 't1', phase: 'implement', text: 'Add a total row to src/report.js', facts: { kind: 'backend', files: 1, hasCheck: true, haikuAllowed: true } };

test('rules: no check or haiku not allowed or risky or many files → sonnet; small docs/tests → haiku; else ambiguous', () => {
  assert.equal(ruleRoute('x', { hasCheck: false }).tier, 'sonnet');
  assert.equal(ruleRoute('x', { hasCheck: true, haikuAllowed: false }).tier, 'sonnet');
  assert.equal(ruleRoute('Run the schema migration for orders', { hasCheck: true }).tier, 'sonnet');
  assert.equal(ruleRoute('x', { hasCheck: true, files: 5 }).tier, 'sonnet');
  assert.equal(ruleRoute('x', { hasCheck: true, kind: 'tests', files: 1 }).tier, 'haiku');
  assert.equal(ruleRoute('x', { hasCheck: true, kind: 'backend', files: 2 }).tier, null);
});

test('signals: a hard signal → sonnet, a clear spelled-out change → haiku, unsure → null', () => {
  assert.equal(signalTier(N({ cross_file: 0.7 })), 'sonnet');
  assert.equal(signalTier(N({ fully_specified: 0.9 })), 'haiku');
  assert.equal(signalTier(N({ fully_specified: 0.9, open_design: 0.5 })), null); // unsure on design
  assert.equal(signalTier({ fully_specified: 0.9 }), null);
});

test('routeTask: Jev only when the rules are unsure; a rule case makes no call', async () => {
  const ask = fakeAsk(N({ fully_specified: 0.9 }));
  const r = await routeTask({ ...base, current: 'sonnet', ask });
  assert.equal(ask.n, 1);
  assert.equal(r.source, 'jev');
  assert.equal(r.tier, 'haiku');
  assert.equal(typeof r.providerMs, 'number');
  const ask2 = fakeAsk(N());
  const rr = await routeTask({ ...base, facts: { ...base.facts, hasCheck: false }, current: 'haiku', ask: ask2 });
  assert.equal(ask2.n, 0);
  assert.equal(rr.source, 'rule');
  assert.equal(rr.tier, 'sonnet');
});

test('routeTask: provider failure or no provider keeps the current model; the floor holds', async () => {
  const f = await routeTask({ ...base, current: 'haiku', ask: fakeAsk(null, false) });
  assert.deepEqual([f.tier, f.source, f.reason], ['haiku', 'fallback', 'provider timeout']);
  const none = await routeTask({ ...base, current: 'sonnet', provider: 'none' });
  assert.equal(none.tier, 'sonnet');
  const floored = await routeTask({ ...base, current: 'sonnet', floor: 'sonnet', ask: fakeAsk(N({ fully_specified: 0.95 })) });
  assert.equal(floored.tier, 'sonnet');
});

test('routeTask: cached per run + task + phase + worker; a retry makes no new call; changed text asks again', async () => {
  const cacheFile = path.join(tmp, 'cache.json');
  const ask = fakeAsk(N({ cross_file: 0.8 }));
  const a = await routeTask({ ...base, current: 'haiku', cacheFile, ask });
  const b = await routeTask({ ...base, current: 'haiku', cacheFile, ask });
  assert.equal(ask.n, 1);
  assert.equal(a.tier, 'sonnet');
  assert.deepEqual([b.tier, b.source, b.cachedSource], ['sonnet', 'cache', 'jev']);
  await routeTask({ ...base, phase: 'fix', current: 'haiku', cacheFile, ask });
  await routeTask({ ...base, text: `${base.text} and a footer`, current: 'haiku', cacheFile, ask });
  assert.equal(ask.n, 3);
  // a provider failure is not cached: the next dispatch asks again
  const ask2 = fakeAsk(null, false);
  await routeTask({ ...base, taskId: 't9', current: 'haiku', cacheFile, ask: ask2 });
  await routeTask({ ...base, taskId: 't9', current: 'haiku', cacheFile, ask: ask2 });
  assert.equal(ask2.n, 2);
  assert.equal(routeKey({ runId: 'r', taskId: 't', phase: 'p' }), 'r|t|p|main');
});
