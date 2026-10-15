import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { evaluate } = await work('src/expr.js');
const cases = [['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['10 - 4 - 3', 3], ['2 ^ 3 ^ 2', 512], ['-2 ^ 2', -4], ['(-2) ^ 2', 4], ['- -3', 3], ['+4', 4],
  ['7 % 4 * 2', 6], ['.5 + 2.25', 2.75], ['8 / 4 / 2', 1], ['2 * -3', -6], ['x * (y + 1)', 12], [' ( ( 1 ) ) ', 1], ['2^-1', 0.5]];
for (const [src, want] of cases) test(src, () => assert.equal(evaluate(src, { x: 3, y: 3 }), want));
test('unknown variable', () => assert.throws(() => evaluate('a + 1'), { message: 'unknown variable: a' }));
test('division by zero', () => assert.throws(() => evaluate('1 / (2 - 2)'), { message: 'division by zero' }));
for (const bad of ['1 +', '(1 + 2', '1 2', '* 3', '1 + )', '', '2..3', '3 $ 4']) test(`syntax ${JSON.stringify(bad)}`, () => assert.throws(() => evaluate(bad), /^Error: syntax error/));
test('no eval', async () => { const fs = await import('node:fs'); const src = fs.readFileSync(`${process.env.WORK_DIR}/src/expr.js`, 'utf8'); assert.ok(!/\beval\s*\(|new Function|\bFunction\s*\(/.test(src)); });
