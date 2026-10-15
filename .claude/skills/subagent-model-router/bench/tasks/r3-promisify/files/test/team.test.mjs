import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTeam } from '../src/team.js';
test('team', (t, done) => loadTeam(['u2', 'u1'], (err, team) => { assert.equal(err, null); assert.deepEqual(team.map((u) => u.name), ['Linus', 'Ada']); done(); }));
