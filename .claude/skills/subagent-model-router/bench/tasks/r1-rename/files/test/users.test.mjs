import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUserName, getUserNameLength } from '../src/users/index.js';
import { orderLabel } from '../src/orders/label.js';
import { greet } from '../src/orders/greet.js';
test('names', () => { assert.equal(getUserName(1), 'Ada'); assert.equal(getUserNameLength(2), 5); });
test('orders', () => { assert.equal(orderLabel({ id: 7, userId: 2 }), '#7 for Linus'); assert.equal(greet(1), 'Hello Ada'); });
