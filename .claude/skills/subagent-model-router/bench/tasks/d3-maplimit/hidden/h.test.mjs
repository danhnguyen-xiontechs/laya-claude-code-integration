import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { mapLimit } = await work('src/map-limit.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('order', async () => assert.deepEqual(await mapLimit([30, 10, 20, 0], 4, async (ms, i) => { await sleep(ms); return i; }), [0, 1, 2, 3]));
test('limit respected', async () => {
  let inFlight = 0, peak = 0;
  await mapLimit([...Array(20).keys()], 3, async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(5); inFlight--; });
  assert.equal(peak, 3);
});
test('empty', async () => assert.deepEqual(await mapLimit([], 2, async () => 1), []));
test('first error rejects and stops launching', async () => {
  let started = 0;
  await assert.rejects(mapLimit([...Array(10).keys()], 2, async (x) => { started++; await sleep(5); if (x === 1) throw new Error('bad'); return x; }), /bad/);
  await sleep(50);
  assert.ok(started <= 3, `started ${started}`);
});
test('sync throw in fn rejects', async () => {
  await assert.rejects(mapLimit([1], 1, () => { throw new Error('sync'); }), /sync/);
});
