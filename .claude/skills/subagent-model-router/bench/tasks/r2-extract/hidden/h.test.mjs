import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { validateUsername } = await work('src/validate-username.js');
const { signup } = await work('src/signup.js');
const { updateProfile } = await work('src/profile.js');
test('module', () => {
  assert.deepEqual(validateUsername('ok_name'), []);
  assert.deepEqual(validateUsername('9' + 'a'.repeat(20)), ['too long', 'starts with digit']);
  assert.deepEqual(validateUsername(undefined), ['too short']);
  assert.deepEqual(validateUsername(''), ['too short']);
});
test('callers unchanged', () => {
  assert.deepEqual(signup('Bad!', []).errors, ['invalid characters']);
  assert.equal(updateProfile({ a: 1 }, { b: 2 }).profile.b, 2);
});
