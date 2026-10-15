import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail } from '../src/email.js';
test('valid', () => assert.equal(isValidEmail('first.last+tag@sub.example.co.uk'), true));
test('invalid', () => { assert.equal(isValidEmail('a@b'), false); assert.equal(isValidEmail('a@@b.com'), false); });
