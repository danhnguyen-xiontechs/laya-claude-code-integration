import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionMessage } from 'claude-code';
import { ARM_TTL_MS, MARK, isArmed, planCompaction, register } from '../hooks/fast-compact.ts';

const big = (n: number, c = 'x') => c.repeat(n);

/** user prompt, then `calls` as assistant tool_use + user tool_result pairs, then `tail` plain turns. */
function convo(calls: { tool: string; input: Record<string, unknown>; out: string; isError?: boolean }[], tail = 6): SessionMessage[] {
  const m: SessionMessage[] = [{ role: 'user', text: 'Fix the bug. Never edit src/generated.', toolUses: [] }];
  calls.forEach((c, i) => {
    const id = `toolu_${i}`;
    m.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: id, tool: c.tool, input: c.input }] });
    m.push({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text: c.out, isError: c.isError ?? false }] });
  });
  for (let i = 0; i < tail; i++) m.push({ role: i % 2 ? 'assistant' : 'user', text: `turn ${i}`, toolUses: [] });
  return m;
}

const resultOf = (msgs: SessionMessage[], id: string) =>
  msgs.flatMap((m) => m.toolResults ?? []).find((r) => r.tool_use_id === id)!.text;
const inputOf = (msgs: SessionMessage[], id: string) =>
  msgs.flatMap((m) => m.toolUses).find((u) => u.tool_use_id === id)!.input;

test('never removes a message, call or result, and keeps untouched messages as the same objects', () => {
  const msgs = convo([
    { tool: 'Read', input: { file_path: 'a.ts' }, out: big(5000) },
    { tool: 'Bash', input: { command: 'ls' }, out: 'a.ts' },
  ]);
  const plan = planCompaction(msgs);
  assert.equal(plan.messages.length, msgs.length);
  assert.equal(plan.messages.flatMap((m) => m.toolUses).length, 2);
  assert.equal(plan.messages.flatMap((m) => m.toolResults ?? []).length, 2);
  assert.equal(plan.messages[0], msgs[0]);
  assert.equal(plan.messages[3], msgs[3]); // short Bash call: untouched
  assert.equal(plan.messages[4], msgs[4]);
  assert.notEqual(plan.messages[2], msgs[2]); // the trimmed Read result
});

test('the newest messages are pinned', () => {
  const msgs = convo([{ tool: 'Read', input: { file_path: 'a.ts' }, out: big(5000) }], 0);
  const plan = planCompaction(msgs, { preserveRecentMessages: 6 });
  assert.equal(plan.decisions[0]!.result, 'pinned');
  assert.equal(plan.stats.charsAfter, plan.stats.charsBefore);
});

test('a read superseded by a later read or edit of the same file becomes a note', () => {
  const plan = planCompaction(convo([
    { tool: 'Read', input: { file_path: 'src\\A.ts' }, out: big(3000) },
    { tool: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' }, out: 'updated' },
    { tool: 'Read', input: { file_path: 'b.ts' }, out: big(3000) },
  ]));
  assert.equal(plan.decisions[0]!.result, 'stale');
  assert.match(resultOf(plan.messages, 'toolu_0'), /stale read/);
  assert.equal(plan.decisions[2]!.result, 'trimmed');
  assert.ok(resultOf(plan.messages, 'toolu_2').startsWith(big(300)));
});

test('edits keep their result; a Write superseded by a later Write loses its content; long inputs are cut', () => {
  const plan = planCompaction(convo([
    { tool: 'Write', input: { file_path: 'a.ts', content: big(5000) }, out: 'File created' },
    { tool: 'Edit', input: { file_path: 'b.ts', old_string: big(1000), new_string: 'y' }, out: 'updated' },
    { tool: 'Write', input: { file_path: 'a.ts', content: big(5000, 'z') }, out: 'File updated' },
  ]));
  assert.match(String(inputOf(plan.messages, 'toolu_0')['content']), /superseded/);
  assert.equal(resultOf(plan.messages, 'toolu_0'), 'File created');
  assert.ok(String(inputOf(plan.messages, 'toolu_1')['old_string']).length < 400);
  assert.equal(inputOf(plan.messages, 'toolu_1')['new_string'], 'y');
  const last = String(inputOf(plan.messages, 'toolu_2')['content']);
  assert.ok(last.startsWith(big(300, 'z')) && last.includes(MARK));
});

test('shell outputs: errors and short outputs stay whole, long ones keep head and tail', () => {
  const long = `HEAD${big(3000)}TAIL`;
  const plan = planCompaction(convo([
    { tool: 'Bash', input: { command: 'a' }, out: big(1100) },
    { tool: 'Bash', input: { command: 'b' }, out: big(5000), isError: true },
    { tool: 'mcp__x__y', input: {}, out: long },
  ]));
  assert.equal(resultOf(plan.messages, 'toolu_0').length, 1100);
  assert.equal(resultOf(plan.messages, 'toolu_1').length, 5000);
  const cut = resultOf(plan.messages, 'toolu_2');
  assert.ok(cut.startsWith('HEAD') && cut.endsWith('TAIL') && cut.includes(MARK));
});

test('a second compaction changes nothing more', () => {
  const msgs = convo([
    { tool: 'Bash', input: { command: big(2000) }, out: big(5000) },
    { tool: 'Grep', input: { pattern: 'x' }, out: big(5000) },
  ]);
  const once = planCompaction(msgs).messages;
  const twice = planCompaction(once);
  assert.equal(twice.stats.charsAfter, twice.stats.charsBefore);
});

test('results carried on toolUses[].text are trimmed too', () => {
  const msgs: SessionMessage[] = [
    { role: 'user', text: 'go', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't', tool: 'Grep', input: {}, text: big(4000) }] },
    ...convo([], 6).slice(1),
  ];
  const plan = planCompaction(msgs);
  assert.ok(plan.messages[1]!.toolUses[0]!.text!.length < 400);
});

test('an arm is valid once and for a limited time', () => {
  const now = 1_000_000;
  assert.equal(isArmed({ armedAt: now - 1000 }, now), true);
  assert.equal(isArmed({ armedAt: now - ARM_TTL_MS - 1 }, now), false);
  assert.equal(isArmed({ armedAt: now - 1000, usedAt: now - 10 }, now), false);
  assert.equal(isArmed(undefined, now), false);
});

// ---- the hook, with a fake engine
function harness(arm: unknown) {
  const files = new Map<string, string>();
  const armPath = 'C:/Users/me/.claude/fast-compact/arm.json';
  if (arm !== undefined) files.set(armPath, JSON.stringify(arm));
  const toasts: string[] = [];
  let hook: any;
  register(((pattern: string, fn: any) => { if (pattern === 'session.compact') hook = fn; return { catch: () => {} }; }) as any, {});
  const $ = {
    env: { get: async (n: string) => (n === 'USERPROFILE' ? 'C:\\Users\\me' : undefined) },
    fs: {
      read: async (p: string) => { const t = files.get(p); if (t === undefined) throw new Error('ENOENT'); return t; },
      write: async (p: string, t: string) => { files.set(p, t); },
    },
    ui: { log: () => {}, toast: (t: string) => toasts.push(t) },
    session: { id: async () => 'sess-1' },
  };
  const next = async () => ({ messages: [], summary: 'built-in' });
  const run = (event: any) => hook($, event, next);
  return { run, files, armPath, toasts };
}

const bulky = convo([{ tool: 'Bash', input: { command: 'x' }, out: big(20000) }]);

test('hook: not armed → built-in summary', async () => {
  const h = harness(undefined);
  assert.deepEqual(await h.run({ trigger: 'manual', messages: bulky }), { messages: [], summary: 'built-in' });
});

test('hook: armed manual /compact → verbatim once, then built-in again', async () => {
  const h = harness({ armedAt: Date.now() });
  const first = await h.run({ trigger: 'manual', messages: bulky });
  assert.equal(first.messages.length, bulky.length);
  assert.match(h.toasts[0]!, /verbatim, no summary/);
  assert.ok(JSON.parse(h.files.get(h.armPath)!).usedAt);
  const second = await h.run({ trigger: 'manual', messages: bulky });
  assert.equal(second.summary, 'built-in');
});

test('hook: auto-compaction and subagents are never touched, even when armed', async () => {
  const h = harness({ armedAt: Date.now() });
  assert.equal((await h.run({ trigger: 'auto', messages: bulky })).summary, 'built-in');
  assert.equal((await h.run({ trigger: 'manual', agentId: 'a1', messages: bulky })).summary, 'built-in');
  assert.equal(JSON.parse(h.files.get(h.armPath)!).usedAt, undefined);
});

test('hook: too little to cut → falls back and says so', async () => {
  const h = harness({ armedAt: Date.now() });
  const small = convo([{ tool: 'Bash', input: { command: 'x' }, out: 'ok' }]);
  assert.equal((await h.run({ trigger: 'manual', messages: small })).summary, 'built-in');
  assert.match(h.toasts[0]!, /fallback/);
});

test('hook: every compaction leaves a log line', async () => {
  const h = harness({ armedAt: Date.now() });
  await h.run({ trigger: 'auto', messages: bulky });
  await h.run({ trigger: 'manual', messages: bulky });
  await h.run({ trigger: 'manual', messages: bulky });
  const lines = h.files.get('C:/Users/me/.claude/fast-compact/log.jsonl')!.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.outcome, l.reason]), [['builtin', 'trigger auto'], ['verbatim', undefined], ['builtin', 'arm already used']]);
  assert.equal(lines[1].session, 'sess-1');
  assert.ok(lines[1].stats.reduction > 0.25);
});
