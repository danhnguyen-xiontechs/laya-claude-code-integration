import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { LruCache } = await work('src/lru.js');
const clock = () => { let t = 0; const f = () => t; f.tick = (d) => { t += d; }; return f; };
test('basic LRU eviction', () => {
  const c = new LruCache({ max: 2 });
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 1); assert.equal(c.get('c'), 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
});
test('update moves to MRU', () => {
  const c = new LruCache({ max: 2 });
  c.set('a', 1); c.set('b', 2); c.set('a', 9); c.set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']); assert.equal(c.get('a'), 9);
});
test('has does not touch recency', () => {
  const c = new LruCache({ max: 2 });
  c.set('a', 1); c.set('b', 2); assert.equal(c.has('a'), true); c.set('c', 3);
  assert.equal(c.has('a'), false);
});
test('ttl default and per entry', () => {
  const now = clock();
  const c = new LruCache({ max: 5, ttlMs: 100, now });
  c.set('a', 1); c.set('b', 2, { ttlMs: 500 });
  now.tick(150);
  assert.equal(c.get('a'), undefined); assert.equal(c.get('b'), 2);
  assert.equal(c.size, 1); assert.deepEqual(c.keys(), ['b']);
});
test('expired evicted before LRU live entries', () => {
  const now = clock();
  const c = new LruCache({ max: 2, now });
  c.set('old', 1); c.set('short', 2, { ttlMs: 10 });
  now.tick(20);
  c.set('new', 3);
  assert.equal(c.get('old'), 1); assert.equal(c.get('new'), 3);
});
test('delete and size', () => {
  const c = new LruCache({ max: 3 });
  c.set('a', 1); assert.equal(c.delete('a'), true); assert.equal(c.delete('a'), false); assert.equal(c.size, 0);
});
test('stores undefined-ish values correctly', () => {
  const c = new LruCache({ max: 2 }); c.set('z', 0); c.set('n', null);
  assert.equal(c.get('z'), 0); assert.equal(c.get('n'), null); assert.equal(c.has('n'), true);
});
test('O(1)-ish: 60k ops quickly', () => {
  const c = new LruCache({ max: 20000 }); const t0 = Date.now();
  for (let i = 0; i < 60000; i++) { c.set(i, i); c.get(i - 100); }
  assert.ok(Date.now() - t0 < 2000);
});
