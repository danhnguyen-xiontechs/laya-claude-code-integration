import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signup } from '../src/signup.js';
import { updateProfile } from '../src/profile.js';
test('signup', () => { const u = []; assert.equal(signup('ada_1', u).ok, true); assert.deepEqual(signup('ada_1', u).errors, ['taken']); });
test('profile', () => assert.deepEqual(updateProfile({}, { name: '1A' }).errors, ['too short', 'invalid characters', 'starts with digit']));
