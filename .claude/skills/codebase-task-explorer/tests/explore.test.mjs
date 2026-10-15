// node --test — batching, local-rank survivors, none_of_these, guards and fallback, with a mocked decide() (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { jevRank, cleanup, readBatch, NONE_ID, DEFAULTS } from '../scripts/explore.mjs';

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${String(i).padStart(3, '0')}`, path: `src/f${i}.cs`, category: 'source', matched: [], queries: ['q'], importers: null, hub: false }));
// mock: prefers the highest index in each batch; records option sets
const mock = (log, opts = {}) => async ({ questions }) => {
  const ids = Object.keys(questions.best.criteria);
  log.push(ids);
  if (opts.fail) return { ok: false, error: 'http 500', meta: {} };
  const probabilities = {};
  ids.forEach((id, i) => { probabilities[id] = id === NONE_ID ? (opts.none ? 0.9 : 0.001) : (i + 1) / 1000; });
  return { ok: true, answers: { best: { probabilities } }, meta: { latencyMs: 1, cost: 0.0001 } };
};
const base = { task: 't', mode: 'bug', coverage: { status: 'complete' }, provider: 'jev', cfg: {} };

test('batches of 24 + none option, top-K local survivors, one global rerank', async () => {
  const log = [];
  const r = await jevRank({ ...base, ranked: mk(60), opts: { ...DEFAULTS, batch: 24, keep: 4 }, decideImpl: mock(log) });
  assert.equal(log.length, 4); // 3 batches + global
  assert.ok(log.slice(0, 3).every((ids) => ids.includes(NONE_ID) && ids.length <= 25));
  assert.equal(r.jev.survivors.length, 12);
  assert.deepEqual(log[3].filter((x) => x !== NONE_ID).sort(), [...r.jev.survivors].sort());
  assert.equal(r.order.length, 60);
});

test('single batch is its own global pass', async () => {
  const log = [];
  const r = await jevRank({ ...base, ranked: mk(10), opts: { ...DEFAULTS }, decideImpl: mock(log) });
  assert.equal(log.length, 1);
  assert.equal(r.order[0], 'c009');
});

test('call budget and payload guards fall back to rules order', async () => {
  const r1 = await jevRank({ ...base, ranked: mk(60), opts: { ...DEFAULTS, batch: 24, maxCalls: 2 }, decideImpl: mock([]) });
  assert.ok(r1.jev.fallback && /budget/.test(r1.jev.reason));
  const r2 = await jevRank({ ...base, ranked: mk(30), opts: { ...DEFAULTS, maxPayload: 500 }, decideImpl: mock([]) });
  assert.ok(r2.jev.fallback && /payload/.test(r2.jev.reason));
  assert.equal(r2.order[0], 'c000');
  const r3 = await jevRank({ ...base, ranked: mk(30), opts: { ...DEFAULTS }, decideImpl: mock([], { fail: true }) });
  assert.ok(r3.jev.fallback); assert.equal(r3.order[0], 'c000');
});

test('none_of_these winning is surfaced, candidates still kept', async () => {
  const r = await jevRank({ ...base, ranked: mk(10), opts: { ...DEFAULTS }, decideImpl: mock([], { none: true }) });
  assert.equal(r.jev.global.noneWon, true);
  assert.equal(r.order.length, 10);
  assert.equal(readBatch({ probabilities: { a: 0.2, [NONE_ID]: 0.8 } }, ['a']).noneWon, true);
});

test('cleanup dedupes and drops vendor/build/binary only', () => {
  const h = (p, q) => ({ path: p, query: q, score: 1, rank: 0, matched: ['x'], importers: 0, hub: false });
  const c = cleanup([h('src/A.cs', 'a'), h('./src/A.cs', 'b'), h('node_modules/x.js', 'a'), h('bin/Debug/a.dll', 'a'), h('obj/X.g.cs', 'a'), h('docs/a.md', 'a')]);
  assert.deepEqual(c.map((x) => x.path).sort(), ['docs/a.md', 'src/A.cs']);
  assert.equal(c.find((x) => x.path === 'src/A.cs').queries.length, 2);
});
