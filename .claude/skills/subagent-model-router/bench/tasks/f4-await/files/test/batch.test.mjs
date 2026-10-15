import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAll } from '../src/batch.js';
test('collects results', async () => {
  const r = await fetchAll([1, 2], async (id) => id * 10);
  assert.deepEqual(r.results, [10, 20]);
});
