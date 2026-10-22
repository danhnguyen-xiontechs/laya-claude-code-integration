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

test('2272 AC3 malformed or absent bundle falls back to a fresh build', () => {
  const s = sources();
  for (const bad of [null, undefined, 'junk', { version: 2 }, { version: 3, parts: 'x' }]) {
    const r = validateContext(bad, s);
    assert.equal(r.bundle.version, 3);
    assert.ok(r.bundle.parts.acs && r.bundle.parts.diff);
  }
});
