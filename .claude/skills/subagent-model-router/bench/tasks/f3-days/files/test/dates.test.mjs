import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween } from '../src/dates.js';
test('simple', () => assert.equal(daysBetween('2024-01-01', '2024-01-31'), 30));
