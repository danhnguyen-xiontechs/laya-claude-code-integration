import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { parseAmount } = await import(pathToFileURL(path.join(process.env.WORK_DIR, 'src/money.js')).href);
let failed = 0;
const t = (name, fn) => { try { fn(); } catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`); } };
t('exact cents for float-hostile values', () => {
  assert.equal(parseAmount('1.15'), 115);
  assert.equal(parseAmount('0.07'), 7);
  assert.equal(parseAmount('-0.29'), -29);
  assert.equal(parseAmount('0.58'), 58);
});
t('plain and signed forms', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('+3.10'), 310);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount('100.5'), 10050);
});
t('invalid forms throw with message', () => {
  for (const bad of ['1.234', '1.', '.5', '', 'abc', '1e3', '1,000', ' 5', '5 ']) {
    assert.throws(() => parseAmount(bad), (e) => e instanceof RangeError && e.message === `bad amount: ${bad}`, JSON.stringify(bad));
  }
});
process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} failed` : 'all strict checks passed');
