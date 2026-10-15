import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { paginate } = await work('src/paginate.js');
const a = [1,2,3,4,5,6,7,8,9,10];
test('page 1', () => assert.deepEqual(paginate(a, 1, 3), [1,2,3]));
test('last partial page', () => assert.deepEqual(paginate(a, 4, 3), [10]));
test('out of range', () => assert.deepEqual(paginate(a, 5, 3), []));
test('page 0 is out of range', () => assert.deepEqual(paginate(a, 0, 3), []));
