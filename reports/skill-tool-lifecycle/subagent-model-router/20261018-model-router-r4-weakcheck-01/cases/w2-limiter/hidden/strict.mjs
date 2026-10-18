import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { createLimiter } = await import(pathToFileURL(path.join(process.env.WORK_DIR, 'src/limiter.js')).href);
let failed = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`); } };
const within = (p, ms = 500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);
const sleep = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
await t('peak running equals max', async () => {
  const run = createLimiter(2);
  let active = 0, peak = 0;
  const job = (i) => run(async () => { active++; peak = Math.max(peak, active); await sleep(10); active--; return i; });
  const out = await Promise.all([0, 1, 2, 3, 4].map(job));
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});
await t('fifo start order with max 1', async () => {
  const run = createLimiter(1);
  const order = [];
  await Promise.all([3, 1, 2].map((d, i) => run(async () => { order.push(i); await sleep(d); })));
  assert.deepEqual(order, [0, 1, 2]);
});
await t('rejection propagates and frees the slot', async () => {
  const run = createLimiter(1);
  const boom = new Error('boom');
  const first = run(() => Promise.reject(boom));
  const second = run(() => 'ok');
  await assert.rejects(first, (e) => e === boom);
  assert.equal(await within(second), 'ok');
});
await t('synchronous throw frees the slot', async () => {
  const run = createLimiter(1);
  const first = run(() => { throw new Error('sync'); });
  const second = run(async () => 'after');
  await assert.rejects(first, /sync/);
  assert.equal(await within(second), 'after');
});
await t('fn not called synchronously', async () => {
  const run = createLimiter(3);
  let started = false;
  const p = run(() => { started = true; return 1; });
  assert.equal(started, false);
  assert.equal(await p, 1);
});
await t('invalid max throws RangeError', () => {
  for (const bad of [0, -1, 1.5, '2', NaN]) {
    assert.throws(() => createLimiter(bad), (e) => e instanceof RangeError && e.message === 'max must be a positive integer', String(bad));
  }
});
process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} failed` : 'all strict checks passed');
