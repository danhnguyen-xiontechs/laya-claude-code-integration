import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../src/map-limit.js';
test('doubles', async () => {
  const r = await mapLimit([1, 2, 3, 4], 2, async (x) => { await new Promise((s) => setTimeout(s, Math.random() * 10)); return x * 2; });
  assert.deepEqual(r, [2, 4, 6, 8]);
});
