import { test } from 'node:test';
import assert from 'node:assert/strict';
import { work } from '../../../lib/check-util.mjs';
const { readRecord } = await work('src/store.js');
const { loadUser } = await work('src/users.js');
const { loadTeam } = await work('src/team.js');
test('readRecord', async () => { assert.deepEqual(await readRecord('u1'), { name: 'Ada', role: 'lead' }); await assert.rejects(readRecord('x'), /not found: x/); });
test('loadUser', async () => assert.equal((await loadUser('u2')).display, 'Linus (dev)'));
test('loadTeam order + parallel', async () => {
  const t0 = Date.now();
  const team = await loadTeam(['u2', 'u1', 'u2', 'u1', 'u2', 'u1', 'u2', 'u1']);
  assert.deepEqual(team.map((u) => u.id).slice(0, 2), ['u2', 'u1']);
  assert.ok(Date.now() - t0 < 30, 'parallel');
});
test('loadTeam error + empty', async () => { await assert.rejects(loadTeam(['u1', 'zz']), /not found: zz/); assert.deepEqual(await loadTeam([]), []); });
test('no callback params', () => { assert.equal(readRecord.length, 1); assert.equal(loadUser.length, 1); assert.equal(loadTeam.length, 1); });
