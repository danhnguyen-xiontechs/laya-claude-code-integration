import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { daysBetween } = await work('src/dates.js');
test('across US DST start', () => assert.equal(daysBetween('2024-03-09', '2024-03-11'), 2));
test('across EU DST end', () => assert.equal(daysBetween('2024-10-26', '2024-10-28'), 2));
test('negative', () => assert.equal(daysBetween('2024-03-11', '2024-03-09'), -2));
test('leap year', () => assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2));
test('long span', () => assert.equal(daysBetween('1999-12-31', '2025-06-15'), 9298));
