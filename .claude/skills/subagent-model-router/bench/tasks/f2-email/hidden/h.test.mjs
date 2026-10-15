import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { isValidEmail } = await work('src/email.js');
const ok = ['a@b.co', 'x_y%z-1@my-host.io', 'A.B@C.DE'];
const bad = ['.a@b.com', 'a.@b.com', 'a..b@c.com', 'a@-b.com', 'a@b-.com', 'a@b.c', 'a@b.c0', 'a b@c.com', '@b.com', 'a@.com', 'a@b..com'];
for (const s of ok) test(`ok ${s}`, () => assert.equal(isValidEmail(s), true));
for (const s of bad) test(`bad ${s}`, () => assert.equal(isValidEmail(s), false));
