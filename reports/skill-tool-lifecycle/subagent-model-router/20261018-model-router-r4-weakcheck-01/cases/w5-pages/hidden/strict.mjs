import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { pageWindow } = await import(pathToFileURL(path.join(process.env.WORK_DIR, 'src/pages.js')).href);
let failed = 0;
const t = (name, fn) => { try { fn(); } catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`); } };
t('even span puts extra link after current page', () => {
  assert.deepEqual(pageWindow(100, 5, 10, 4), [3, 4, 5, 6]);
  assert.deepEqual(pageWindow(100, 5, 10, 2), [4, 5]);
});
t('clamp at start and end', () => {
  assert.deepEqual(pageWindow(100, 1, 10, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageWindow(100, 10, 10, 4), [7, 8, 9, 10]);
  assert.deepEqual(pageWindow(100, 10, 10, 7), [4, 5, 6, 7, 8, 9, 10]);
});
t('partial last page counts', () => {
  assert.deepEqual(pageWindow(95, 1, 10, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(25, 2, 10, 7), [1, 2, 3]);
});
t('empty and span 1', () => {
  assert.deepEqual(pageWindow(0, 1, 10, 3), [1]);
  assert.deepEqual(pageWindow(100, 5, 10, 1), [5]);
});
t('out of range throws', () => {
  for (const p of [0, 11]) {
    assert.throws(() => pageWindow(100, p, 10, 4), (e) => e instanceof RangeError && e.message === `page out of range: ${p}`);
  }
});
process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} failed` : 'all strict checks passed');
