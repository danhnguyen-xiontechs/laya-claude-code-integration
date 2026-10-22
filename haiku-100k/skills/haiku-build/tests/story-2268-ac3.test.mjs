// Story 2268 AC3: JEV is advisory. Off makes no call; an error, a timeout or confidence below 0.8 use the
// baseline; JEV never changes the final status. No real network call: `ask` is always injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jevMode, advise, MAX_CALLS, TIMEOUT_MS, MIN_CONFIDENCE } from '../scripts/jev_advice.mjs';
import { finalStatus } from '../scripts/status.mjs';

const CHOICES = ['opus', 'sonnet'];
const APPLY = { HAIKU_BUILD_JEV: 'apply' };
const answer = (label, confidence) => async () => ({ label, confidence });

test('2268 AC3 fallback: mode defaults to apply, off only when set; limits are 3000 ms, 0.8, 3 calls', () => {
  assert.equal(jevMode({}), 'apply');
  assert.equal(jevMode({ HAIKU_BUILD_JEV: 'apply' }), 'apply');
  assert.equal(jevMode({ HAIKU_BUILD_JEV: 'OFF' }), 'off');
  assert.equal(TIMEOUT_MS, 3000);
  assert.equal(MIN_CONFIDENCE, 0.8);
  assert.equal(MAX_CALLS, 3);
});

test('2268 AC3 fallback: off makes no call and uses the baseline', async () => {
  let calls = 0;
  const ask = async () => { calls++; return { label: 'sonnet', confidence: 1 }; };
  const r = await advise({ point: 'intake', baseline: 'opus', choices: CHOICES, env: { HAIKU_BUILD_JEV: 'off' }, ask });
  assert.equal(calls, 0);
  assert.equal(r.choice, 'opus');
  assert.equal(r.source, 'baseline');
  assert.equal(r.called, false);
  assert.equal(r.reason, 'off');
});

test('2268 AC3 fallback: error uses the baseline and logs the reason', async () => {
  const r = await advise({ point: 'recovery', baseline: 'retry', choices: ['retry', 'rewrite'], env: APPLY, ask: async () => { throw new Error('boom'); } });
  assert.equal(r.choice, 'retry');
  assert.equal(r.source, 'baseline');
  assert.match(r.reason, /error: boom/);
});

test('2268 AC3 fallback: timeout uses the baseline', async () => {
  const slow = () => new Promise((res) => setTimeout(() => res({ label: 'sonnet', confidence: 0.99 }), 200));
  const r = await advise({ point: 'intake', baseline: 'opus', choices: CHOICES, env: APPLY, ask: slow, timeoutMs: 20 });
  assert.equal(r.choice, 'opus');
  assert.match(r.reason, /timeout/);
});

test('2268 AC3 fallback: confidence 0.7 uses the baseline, 0.8 is applied', async () => {
  const low = await advise({ point: 'intake', baseline: 'opus', choices: CHOICES, env: APPLY, ask: answer('sonnet', 0.7) });
  assert.equal(low.choice, 'opus');
  assert.match(low.reason, /low confidence 0.7/);
  const ok = await advise({ point: 'intake', baseline: 'opus', choices: CHOICES, env: APPLY, ask: answer('sonnet', 0.8) });
  assert.equal(ok.choice, 'sonnet');
  assert.equal(ok.source, 'jev');
});

test('2268 AC3 fallback: at most 3 calls, only at intake, recovery, triage', async () => {
  let calls = 0;
  const ask = async () => { calls++; return { label: 'sonnet', confidence: 0.9 }; };
  const capped = await advise({ point: 'intake', baseline: 'opus', choices: CHOICES, env: APPLY, ask, used: MAX_CALLS });
  assert.equal(capped.choice, 'opus');
  const wrong = await advise({ point: 'present', baseline: 'opus', choices: CHOICES, env: APPLY, ask });
  assert.equal(wrong.choice, 'opus');
  assert.equal(calls, 0);
});

test('2268 AC3 fallback: triage never lowers a severity', async () => {
  const down = await advise({ point: 'triage', baseline: 'Major', choices: ['Minor', 'Major'], env: APPLY, ask: answer('Minor', 0.99) });
  assert.equal(down.choice, 'Major');
  assert.match(down.reason, /lower severity/);
  const up = await advise({ point: 'triage', baseline: 'Minor', choices: ['Minor', 'Major'], env: APPLY, ask: answer('Major', 0.99) });
  assert.equal(up.choice, 'Major');
});

test('2268 AC3 status unchanged: whatever JEV advises, the final status is the same', async () => {
  const inputs = [
    { missing: [], tests: { failed: 0 }, attempts: [{ attempt: 'T1', ok: true }], findings: [] },
    { missing: [], tests: { failed: 0 }, attempts: [{ attempt: 'T1', ok: true }], findings: [{ resolution: 'open' }] },
    { missing: ['evidence/review.json'], tests: { failed: 0 }, attempts: [] },
    { missing: [], tests: { failed: 1 }, attempts: [{ attempt: 'T1', ok: false }] },
  ];
  for (const input of inputs) {
    const advice = await advise({ point: 'triage', baseline: 'Minor', choices: ['Minor', 'Major', 'done'], env: APPLY, ask: answer('done', 1) });
    assert.equal('status' in advice, false);
    const withJev = finalStatus({ ...input, jev: advice, status: 'done', finalStatus: 'done' });
    assert.deepEqual(withJev, finalStatus(input));
  }
});
