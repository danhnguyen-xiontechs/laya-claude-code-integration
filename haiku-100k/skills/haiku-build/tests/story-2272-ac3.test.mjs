// Story 2272 AC3: one context bundle is built, rendered within 10 KB, reused, and refreshed only when stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, validateContext, refreshContext, renderContext } from '../scripts/v3.mjs';

const sources = () => ({
  specText: '## 6. Tasks & Acceptance Criteria\n- `src/a.mjs` add the flag\n- AC1: flag works. Checked by `tests/a.test.mjs` "2272 AC1 flag works".\n',
  answers: [],
  diff: 'diff --git a/src/a.mjs b/src/a.mjs\n+export const flag = true;\n',
  tests: { passed: 1, failed: 0 },
  files: ['src/a.mjs'],
});

test('2272 AC3 plan and review reuse one bundle', () => {
  const s = sources();
  const bundle = buildContext(s);
  assert.equal(bundle.version, 3);
  assert.deepEqual(Object.keys(bundle.parts).sort(), ['acs', 'diff', 'locations', 'tests']);
  for (const p of Object.values(bundle.parts)) {
    assert.equal(typeof p.hash, 'string');
    assert.ok('data' in p);
  }
  const text = renderContext(bundle, { maxBytes: 10240 });
  assert.equal(typeof text, 'string');
  assert.ok(Buffer.byteLength(text, 'utf8') <= 10240);

  const diffChanged = { ...s, diff: s.diff + '+const more = 1;\n' };
  const v1 = validateContext(bundle, diffChanged);
  assert.deepEqual(v1.stale, ['diff']);
  assert.ok(v1.bundle.parts.acs, 'acs part kept');

  const specChanged = { ...s, specText: s.specText + '- AC2: new one.\n' };
  const v2 = validateContext(bundle, specChanged);
  assert.ok(v2.stale.includes('acs') && v2.stale.includes('locations'));

  const refreshed = refreshContext(v1.bundle, diffChanged);
  assert.equal(refreshed.version, 3);
});

test('2272 AC3 large diff keeps ACs, locations and tests in the capped render', () => {
  const s = sources();
  const big = Array.from({ length: 6 }, (_, i) => `diff --git a/src/f${i}.mjs b/src/f${i}.mjs\n${`+${'x'.repeat(40)}\n`.repeat(200)}`).join('');
  assert.ok(Buffer.byteLength(big) > 10240);
  const bundle = buildContext({ ...s, diff: big });
  const text = renderContext(bundle, { maxBytes: 10240 });
  assert.ok(Buffer.byteLength(text, 'utf8') <= 10240);
  assert.match(text, /## Acceptance criteria[\s\S]*AC1/);
  assert.match(text, /## Locations[\s\S]*src\/a\.mjs/);
  assert.match(text, /## Tests[\s\S]*"failed":0/);
  assert.ok(text.indexOf('## Tests') < text.indexOf('## Diff'), 'diff renders after the tests');
  assert.match(text, /\[context truncated\]$/);

  const noDiff = renderContext(bundle, { includeDiff: false });
  assert.doesNotMatch(noDiff, /## Diff/);
  assert.match(noDiff, /## Tests/);
  assert.doesNotMatch(noDiff, /truncated/);

  const small = renderContext(buildContext(s));
  assert.match(small, /## Diff[\s\S]*export const flag/);
  assert.doesNotMatch(small, /truncated/);
});

test('2272 AC3 refresh of an unchanged bundle reuses every part', () => {
  const s = sources();
  const bundle = buildContext(s);
  assert.deepEqual(refreshContext(bundle, s), bundle);
  const changed = { ...s, tests: { passed: 0, failed: 1 } };
  const r = refreshContext(bundle, changed);
  assert.equal(r.parts.acs, bundle.parts.acs, 'acs part reused');
  assert.notEqual(r.parts.tests.hash, bundle.parts.tests.hash, 'tests part rebuilt');
  assert.deepEqual(r.parts.tests.data, { passed: 0, failed: 1 });
});

test('2272 AC3 malformed or absent bundle falls back to a fresh build', () => {
  const s = sources();
  for (const bad of [null, undefined, 'junk', { version: 2 }, { version: 3, parts: 'x' }]) {
    const r = validateContext(bad, s);
    assert.equal(r.bundle.version, 3);
    assert.ok(r.bundle.parts.acs && r.bundle.parts.diff);
  }
});
