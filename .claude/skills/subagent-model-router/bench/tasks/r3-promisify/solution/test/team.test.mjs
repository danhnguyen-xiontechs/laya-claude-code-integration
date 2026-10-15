import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTeam } from '../src/team.js';
test('team', async () => assert.deepEqual((await loadTeam(['u2', 'u1'])).map((u) => u.name), ['Linus', 'Ada']));
