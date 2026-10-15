import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { createLimiter } = await work('src/limiter.js');
const clock = () => { let t = 1000; const f = () => t; f.tick = (d) => { t += d; }; return f; };
test('burst then refuse', () => {
  const now = clock(); const l = createLimiter({ capacity: 3, refillPerSec: 1, now });
  assert.deepEqual(l.take('a'), { ok: true, remaining: 2 });
  l.take('a'); assert.deepEqual(l.take('a'), { ok: true, remaining: 0 });
  assert.deepEqual(l.take('a'), { ok: false, remaining: 0, retryAfterMs: 1000 });
});
test('fractional refill and retryAfter rounding', () => {
  const now = clock(); const l = createLimiter({ capacity: 2, refillPerSec: 3, now });
  l.take('k', 2); now.tick(100);
  const r = l.take('k');
  assert.equal(r.ok, false); assert.equal(r.retryAfterMs, 234);
  now.tick(234); assert.equal(l.take('k').ok, true);
});
test('keys independent, capacity cap', () => {
  const now = clock(); const l = createLimiter({ capacity: 2, refillPerSec: 10, now });
  l.take('a', 2); assert.equal(l.peek('b'), 2); now.tick(10000); assert.equal(l.peek('a'), 2);
});
test('failed take consumes nothing', () => {
  const now = clock(); const l = createLimiter({ capacity: 5, refillPerSec: 1, now });
  l.take('a', 4); assert.equal(l.take('a', 3).ok, false); assert.equal(l.peek('a'), 1);
  assert.deepEqual(l.take('a', 1), { ok: true, remaining: 0 });
});
test('cost above capacity', () => {
  const l = createLimiter({ capacity: 2, refillPerSec: 1, now: clock() });
  assert.deepEqual(l.take('x', 3), { ok: false, remaining: 2, retryAfterMs: Infinity });
});
