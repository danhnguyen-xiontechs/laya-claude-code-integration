// design §4 engine.test.ts: the hook against the engine's own turn.complete chain
// (`claude plugin test .`), same pattern as smart-context-trimming. The harness gives the test
// $ no fs or session.id, so metrics-file checks are left to the real headless run (see manifest).
import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const HOME = 'C:/Users/ADMIN/AppData/Local/Temp/context-governor-engine-test';

function core(on: On, home = HOME) {
  mock.env(on, { USERPROFILE: home });
  on('turn.complete', () => ({ text: '' }));
}

const usage = (input: number, cacheRead: number, cacheCreation: number) => ({
  input_tokens: input, output_tokens: 4, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation, model: 'claude-haiku-5-5',
});
const turn = (u: ReturnType<typeof usage> | undefined, extra: Record<string, unknown> = {}) => ({
  answer: 'ok', durationMs: 5, isAborted: false, turnId: 't-1', reason: 'answer' as const, ...(u ? { usage: u } : {}), ...extra,
});

test('turn.complete at 210k returns a text with 200k', { options: { mode: 'warn' } }, async ($, on) => {
  core(on);
  const r = await $.turn.complete(turn(usage(2, 200_000, 10_000)));
  expect(r.text.includes('200k')).toBe(true);
});

test('below the soft threshold there is no text', async ($, on) => {
  core(on);
  const r = await $.turn.complete(turn(usage(2, 50_000, 0)));
  expect(r.text).toBe('');
});

test('a metrics write failure keeps the note and the turn completes', async ($, on) => {
  core(on, 'Z:/no-such-drive/context-governor');
  const r = await $.turn.complete(turn(usage(2, 210_000, 0)));
  expect(r.text.includes('200k')).toBe(true); // notes survive a write failure; only metrics are lost
});

test('missing usage: no crash, no note at zero context', async ($, on) => {
  core(on);
  const r = await $.turn.complete(turn(undefined));
  expect(r.text).toBe('');
});

test('an event with agentId returns no text', async ($, on) => {
  core(on);
  const r = await $.turn.complete(turn(usage(2, 250_000, 0), { agentId: 'a1' }));
  expect(r.text).toBe('');
});

test('latency: 100 synthetic turns each under 200 ms', async ($, on) => {
  core(on);
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const t0 = Date.now();
    await $.turn.complete(turn(usage(2, 50_000 + i, 0)));
    worst = Math.max(worst, Date.now() - t0);
  }
  expect(worst < 200).toBe(true);
});
