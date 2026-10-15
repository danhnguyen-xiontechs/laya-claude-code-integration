import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.js';
test('page 2 of 3', () => assert.deepEqual(paginate([1,2,3,4,5,6,7,8,9,10], 2, 3), [4,5,6]));
