// Story 2269 AC3: Major findings still open after 3 fix rounds block the run with
// "review repair loop exceeded 3 iterations"; open Minor findings only give done_with_findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAuto, reviewRound, replaceOpen, LOOP_EXCEEDED, MAX_FIX_ROUNDS } from '../scripts/auto.mjs';
import { AUTO_CLI, MAJOR, MINOR, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

const majorReview = (req) => (req.lens === 'blind-hunter' ? JSON.stringify([MAJOR]) : '[]');

test('2269 AC3 loop text and limit', () => {
  assert.equal(MAX_FIX_ROUNDS, 3);
  assert.equal(LOOP_EXCEEDED, 'review repair loop exceeded 3 iterations');
});

test('2269 AC3 reviewRound: fix while a Major is open, halt after round 3, finish otherwise', () => {
  const open = [{ ...MAJOR, resolution: 'open' }];
  assert.deepEqual([0, 1, 2].map((round) => reviewRound({ round, findings: open }).action), ['fix', 'fix', 'fix']);
  assert.equal(reviewRound({ round: 2, findings: open }).round, 3);
  const h = reviewRound({ round: 3, findings: open });
  assert.equal(h.action, 'halt');
  assert.equal(h.condition, LOOP_EXCEEDED);
  assert.equal(reviewRound({ round: 3, findings: [{ ...MINOR, resolution: 'open' }] }).action, 'finish');
  assert.equal(reviewRound({ round: 0, findings: [{ ...MAJOR, resolution: 'fixed' }] }).action, 'finish');
  assert.equal(reviewRound({ round: 0, findings: [{ ...MAJOR, resolution: 'rejected' }] }).action, 'finish');
});

test('2269 AC3 re-review findings replace the open list', () => {
  const next = replaceOpen([{ ...MAJOR, resolution: 'open' }, { ...MINOR, resolution: 'rejected' }], [MINOR], 1);
  assert.deepEqual(next.map((f) => [f.severity, f.resolution]), [['Major', 'fixed'], ['Minor', 'rejected'], ['Minor', 'open']]);
});

test('2269 AC3 Major still open after 3 fix rounds -> blocked, review repair loop exceeded 3 iterations', async () => {
  const a = fakeAgent({ review: majorReview, 're-review': JSON.stringify([MAJOR]) });
  const deps = baseDeps({ agent: a.agent, ...fakeTests([true]) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, 'review repair loop exceeded 3 iterations');
  assert.equal(res.exitCode, 1);
  assert.equal(a.count('fix'), 3);
  assert.equal(a.count('re-review'), 3);
  assert.equal(readJson(path.join(deps.runDir, 'manifest.json')).auto.fixRounds, 3);
});

test('2269 AC3 a Major fixed in round 1 with a clean re-review -> done', async () => {
  const a = fakeAgent({ review: majorReview });
  const res = await runAuto(baseDeps({ agent: a.agent, ...fakeTests([true]) }));
  assert.equal(res.status, 'done');
  assert.equal(a.count('fix'), 1);
});

test('2269 AC3 a re-review leaving only a Minor open -> done_with_findings', async () => {
  const a = fakeAgent({ review: majorReview, 're-review': JSON.stringify([MINOR]) });
  const res = await runAuto(baseDeps({ agent: a.agent, ...fakeTests([true]) }));
  assert.equal(res.status, 'done_with_findings');
  assert.equal(res.exitCode, 0);
  assert.equal(a.count('fix'), 1);
});

test('2269 AC3 only Minor findings open -> done_with_findings with no fix round', async () => {
  const a = fakeAgent({ review: (req) => (req.lens === 'verification-gap' ? JSON.stringify([MINOR]) : '[]') });
  const deps = baseDeps({ agent: a.agent, ...fakeTests([true]) });
  const res = await runAuto(deps);
  assert.equal(res.status, 'done_with_findings');
  assert.equal(res.condition, null);
  assert.equal(a.count('fix'), 0);
  assert.equal(readJson(path.join(deps.runDir, 'result.json')).status, 'done_with_findings');
});

test('2269 AC3 CLI round: fix rounds counted, a Major after round 3 exits 1 with the loop text', () => {
  const dir = tmpDir();
  const mf = path.join(dir, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify({ schemaVersion: 1, runId: 'round', tool: 'haiku-build', status: 'REVIEWED', task: 't', opusCalls: [], phases: [], haiku: {}, review: { status: 'done', findings: [{ ...MAJOR, resolution: 'open' }] } }));
  const reFile = path.join(dir, 're.json');
  fs.writeFileSync(reFile, JSON.stringify([MAJOR]));
  const run = (...extra) => {
    const r = spawnSync(process.execPath, [AUTO_CLI, 'round', dir, ...extra], { encoding: 'utf8' });
    return { code: r.status, json: JSON.parse(r.stdout.trim()) };
  };
  const first = run();
  assert.deepEqual([first.code, first.json.action, first.json.round], [0, 'fix', 1]);
  assert.equal(run('--re-review', reFile).json.round, 2);
  assert.equal(run('--re-review', reFile).json.round, 3);
  const last = run('--re-review', reFile);
  assert.equal(last.code, 1);
  assert.equal(last.json.status, 'blocked');
  assert.equal(last.json.condition, LOOP_EXCEEDED);
});
