import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const u = await work('src/users/index.js');
const { orderLabel } = await work('src/orders/label.js');
const { greet } = await work('src/orders/greet.js');
test('renamed export', () => { assert.equal(typeof u.fetchUserName, 'function'); assert.equal(u.getUserName, undefined); assert.equal(u.fetchUserName(1), 'Ada'); });
test('length kept', () => assert.equal(u.getUserNameLength(2), 5));
test('callers', () => { assert.equal(orderLabel({ id: 7, userId: 2 }), '#7 for Linus'); assert.equal(greet(3), 'Hello unknown'); });
