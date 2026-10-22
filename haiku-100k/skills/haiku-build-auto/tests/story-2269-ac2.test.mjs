// Story 2269 AC2: a blocking condition halts the run blocked, names the condition and exits non-zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAuto, handBackGate, CONDITIONS, AUTO_APPROVER } from '../scripts/auto.mjs';
import { LADDER_TEXT } from '../../haiku-build/scripts/status.mjs';
import { AUTO_CLI, STATUS_CLI, SPEC, baseDeps, fakeAgent, fakeTests, readJson, tmpDir } from './fixture.mjs';

const node = (...args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { code: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').at(-1)) : null };
};

async function blocked(deps, condition) {
  const res = await runAuto(deps);
  assert.equal(res.status, 'blocked');
  assert.equal(res.condition, condition);
  assert.equal(res.exitCode, 1);
  assert.equal(readJson(path.join(deps.runDir, 'result.json')).condition, condition);
  return res;
}

test('2269 AC2 dirty working tree: blocked, no subagent started', async () => {
  const a = fakeAgent();
  await blocked(baseDeps({ gitClean: () => false, agent: a.agent, ...fakeTests() }), CONDITIONS.dirtyTree);
  assert.equal(CONDITIONS.dirtyTree, 'dirty working tree');
  assert.equal(a.calls.length, 0);
});

test('2269 AC2 preflight failure: blocked, no subagent started', async () => {
  const a = fakeAgent();
  const res = await blocked(baseDeps({ preflight: () => ({ ok: false, message: 'preflight failed: Node 20' }), agent: a.agent, ...fakeTests() }), CONDITIONS.preflight);
  assert.match(res.reason, /Node 20/);
  assert.equal(a.calls.length, 0);
});

test('2269 AC2 intent gap: no task, no spec folder/id, no resumable run', async () => {
  const a = fakeAgent();
  await blocked(baseDeps({ task: '   ', agent: a.agent, ...fakeTests() }), 'intent gap');
  assert.equal(a.calls.length, 0);
});

test('2269 AC2 no subagents: the Agent tool missing or throwing', async () => {
  await blocked(baseDeps({ agent: undefined, ...fakeTests() }), 'no subagents');
  const res = await blocked(baseDeps({ agent: async () => { throw new Error('Agent tool not allowed'); }, ...fakeTests() }), 'no subagents');
  assert.match(res.reason, /02-plan Agent tool not allowed/);
});

test('2269 AC2 plan failed twice: attempt 2 is automatic, a second failure blocks', async () => {
  const a = fakeAgent({ plan: 'no headings here' });
  const deps = baseDeps({ agent: a.agent, ...fakeTests() });
  await blocked(deps, 'plan failed twice');
  assert.equal(a.count('plan'), 2);
  const calls = readJson(path.join(deps.runDir, 'manifest.json')).opusCalls;
  assert.deepEqual(calls.map((c) => [c.step, c.attempt, c.ok]), [['02-plan', 1, false], ['02-plan', 2, false]]);
  assert.equal(calls[1].retryApprovedBy, AUTO_APPROVER);
});

test('2269 AC2 plan failing once is retried automatically and the run goes on', async () => {
  const a = fakeAgent({ plan: (req, n) => (n === 1 ? '' : SPEC) });
  const deps = baseDeps({ agent: a.agent, ...fakeTests() });
  assert.equal((await runAuto(deps)).status, 'done');
  const calls = readJson(path.join(deps.runDir, 'manifest.json')).opusCalls.filter((c) => c.step === '02-plan');
  assert.deepEqual(calls.map((c) => [c.attempt, c.ok, c.retryApprovedBy ?? null]), [[1, false, null], [2, true, AUTO_APPROVER]]);
});

test('2269 AC2 review failed twice: two failed review hand-backs block', async () => {
  const a = fakeAgent({ review: 'Looks fine to me.' });
  await blocked(baseDeps({ agent: a.agent, ...fakeTests() }), 'review failed twice');
  assert.equal(a.count('review'), 6);
  assert.deepEqual([handBackGate('review', 0).action, handBackGate('review', 1).action, handBackGate('review', 2).condition], ['continue', 'retry', 'review failed twice']);
});

test('2269 AC2 CLI halt and gate: blocked, condition named, exit 1', () => {
  const runDir = path.join(tmpDir(), 'run');
  const h = node(AUTO_CLI, 'halt', runDir, 'dirty working tree');
  assert.equal(h.code, 1);
  assert.equal(h.json.status, 'blocked');
  assert.equal(h.json.condition, 'dirty working tree');

  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'cli', tool: 'haiku-build', status: 'INTAKE', task: 't', opusCalls: [], phases: [], haiku: {} }));
  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(bad, 'no headings');
  const g1 = node(AUTO_CLI, 'gate', 'plan', dir, bad);
  assert.equal(g1.code, 0);
  assert.equal(g1.json.action, 'retry');
  const g2 = node(AUTO_CLI, 'gate', 'plan', dir, bad);
  assert.equal(g2.code, 1);
  assert.equal(g2.json.condition, 'plan failed twice');
  assert.equal(readJson(path.join(dir, 'manifest.json')).opusCalls[1].retryApprovedBy, AUTO_APPROVER);
});

test('2269 AC2 ladder: T1, T2, sonnet-retry and T3 all fail -> blocked with the ladder reason', async () => {
  const a = fakeAgent();
  const t = fakeTests([false]);
  const deps = baseDeps({ agent: a.agent, runTests: t.runTests });
  const res = await blocked(deps, CONDITIONS.ladder);
  assert.ok(res.reason.includes(LADDER_TEXT), res.reason);
  assert.deepEqual(t.runs.map((r) => r.attempt), ['T1', 'T2', 'sonnet-retry', 'T3']);
  assert.equal(a.calls.filter((c) => c.role === 'sonnet-retry' && c.model === 'sonnet').length, 1);
  assert.equal(a.count('review'), 0);
});

test('2269 AC2 ladder: status.mjs record fail on T3 exits 1, earlier rungs exit 0', () => {
  const dir = tmpDir();
  const mf = path.join(dir, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify({ schemaVersion: 1, runId: 'ladder', attempts: [] }));
  const codes = ['fail', 'fail', 'fail', 'fail'].map((r) => node(STATUS_CLI, dir, 'record', r));
  assert.deepEqual(codes.map((c) => c.code), [0, 0, 0, 1]);
  assert.equal(codes[3].json.recorded, 'T3');
  assert.equal(codes[3].json.next.refused, true);
  assert.deepEqual(readJson(mf).attempts.map((x) => x.attempt), ['T1', 'T2', 'sonnet-retry', 'T3']);
  assert.equal(node(STATUS_CLI, dir, 'next').code, 1);
  const passDir = tmpDir();
  fs.writeFileSync(path.join(passDir, 'manifest.json'), JSON.stringify({ attempts: [{ attempt: 'T1', ok: false }, { attempt: 'T2', ok: false }, { attempt: 'sonnet-retry', ok: false }] }));
  assert.equal(node(STATUS_CLI, passDir, 'record', 'pass').code, 0);
});
