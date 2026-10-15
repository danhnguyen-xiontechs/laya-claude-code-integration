import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';
test('collapse runs', () => assert.equal(slugify('Hello,  World!!'), 'hello-world'));
test('accents', () => assert.equal(slugify('Crème Brûlée'), 'creme-brulee'));
test('trim both ends', () => assert.equal(slugify('--a b--'), 'a-b'));
test('truncate no trailing dash', () => assert.equal(slugify('abc def', { maxLength: 4 }), 'abc'));
test('default max 60', () => assert.equal(slugify('a'.repeat(55) + ' ' + 'b'.repeat(10)).length, 60));
