import test from 'node:test';
import assert from 'node:assert/strict';
import { optimize } from './optimize.js';

const turn = (i, size) => [
  { role: 'user', content: `question ${i} ` + 'lorem data '.repeat(size) },
  { role: 'assistant', content: `answer ${i} ` + 'ipsum data '.repeat(size) },
];
const opts = { apiKey: '', limit: 5_000 }; // offline estimate, small limit

test('passthrough leaves payload untouched', async () => {
  const input = { system: 'sys', messages: [{ role: 'user', content: 'hi' }] };
  const r = await optimize(input, opts);
  assert.equal(r.status, 'passthrough');
  assert.deepEqual(r.payload, input);
});

test('prunes oldest turns, keeps last 3, adds summary + cache_control', async () => {
  const messages = Array.from({ length: 12 }, (_, i) => turn(i, 150)).flat();
  const r = await optimize({ system: 'You are helpful.', messages }, opts);
  assert.equal(r.status, 'optimized');
  assert.ok(r.final_tokens <= 5_000, `final ${r.final_tokens}`);
  const msgs = r.payload.messages;
  assert.equal(msgs[0].role, 'user');
  assert.match(JSON.stringify(msgs[0]), /Summary of past context/);
  assert.match(JSON.stringify(msgs.at(-1)), /answer 11/);
  assert.match(JSON.stringify(msgs), /question 9/); // 3rd-last turn kept
  assert.deepEqual(r.payload.system.at(-1).cache_control, { type: 'ephemeral' });
  msgs.slice(1).forEach((m, i) => assert.notEqual(m.role, msgs[i].role)); // roles alternate
});

test('tier A collapses repeated log lines without dropping turns', async () => {
  const log = 'ERROR retry failed\n'.repeat(3_000);
  const r = await optimize({ messages: [{ role: 'user', content: log + '\nwhat now?' }] }, opts);
  assert.equal(r.dropped_messages ?? 0, 0);
  assert.match(JSON.stringify(r.payload.messages), /repeated 2999 more times/);
});

test('keeps tools/max_tokens and survives an empty system array', async () => {
  const messages = Array.from({ length: 8 }, (_, i) => turn(i, 150)).flat();
  const input = { model: 'claude-haiku-5-5', max_tokens: 123, tools: [{ name: 't', input_schema: { type: 'object' } }], system: [], messages };
  const r = await optimize(input, opts);
  assert.equal(r.status, 'optimized');
  assert.equal(r.payload.max_tokens, 123);
  assert.deepEqual(r.payload.tools, input.tools);
  assert.equal(r.payload.model, 'claude-haiku-5-5');
});

test('tier A leaves the ** operator and short repeated code lines alone', async () => {
  const text = 'Use 2 ** 10 and 3 ** 4\n```\n}\n}\n}\n}\n```\n' + 'x '.repeat(20_000);
  const r = await optimize({ messages: [{ role: 'user', content: text }] }, opts);
  const out = JSON.stringify(r.payload.messages);
  assert.match(out, /2 \*\* 10 and 3 \*\* 4/);
  assert.doesNotMatch(out, /repeated/);
});
