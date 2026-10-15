import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { fetchAll } = await work('src/batch.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('order kept despite timing', async () => {
  const r = await fetchAll([1, 2, 3], async (id) => { await sleep(30 - id * 10); return id; });
  assert.deepEqual(r.results, [1, 2, 3]);
});
test('errors skipped and reported', async () => {
  const r = await fetchAll([1, 2, 3], async (id) => { if (id === 2) throw new Error('boom'); return id; });
  assert.deepEqual(r.results, [1, 3]);
  assert.deepEqual(r.errors, [{ id: 2, error: 'boom' }]);
});
