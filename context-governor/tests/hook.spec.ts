// hooks/context-governor.ts against a fake $ (node --test "tests/*.spec.ts"). The engine's testing
// kit has no fs or toast spy, so this checks the toast text and the jsonl line directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../hooks/context-governor.ts';

type Files = Map<string, string>;

function harness(opts: { sid?: string | Error; usage?: number | Error; writeFails?: boolean; delayMs?: number } = {}) {
  const files: Files = new Map();
  const toasts: string[] = [];
  const logs: string[] = [];
  const handlers: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
  const $ = {
    env: {
      get: async (k: string) => {
        if (opts.delayMs && k === 'USERPROFILE') await new Promise((r) => setTimeout(r, opts.delayMs));
        return k === 'USERPROFILE' ? 'C:/fake-home' : undefined;
      },
    },
    fs: {
      read: async (p: string) => { if (!files.has(p)) throw new Error(`ENOENT ${p}`); return files.get(p)!; },
      write: async (p: string, c: string) => {
        if (opts.writeFails && p.endsWith('.state.json')) throw new Error('EACCES');
        files.set(p, c);
      },
      list: async () => { throw new Error('no artifact dir'); },
    },
    session: {
      id: async () => { if (opts.sid instanceof Error) throw opts.sid; return opts.sid ?? 'sess-a'; },
      usage: async () => {
        if (opts.usage instanceof Error) throw opts.usage;
        return { context: { tokens: opts.usage ?? 0 } };
      },
    },
    ui: { toast: (t: string) => toasts.push(t), log: (t: string) => logs.push(t), status: () => {} },
  };
  register(((name: string, fn: (...a: unknown[]) => Promise<unknown>) => { handlers[name] = fn; }) as never, {} as never);
  const fire = async (usage: object | undefined, extra: Record<string, unknown> = {}) => {
    const e = { answer: 'ok', durationMs: 5, isAborted: false, turnId: 't', reason: 'answer', ...(usage ? { usage } : {}), ...extra };
    return (await handlers['turn.complete']!(
      $ as never, e, async () => ({}),
    )) as { text?: string };
  };
  return { files, toasts, logs, fire };
}

const usage = (input: number, cacheRead: number, cacheCreation: number) => ({
  input_tokens: input, output_tokens: 4, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreation, model: 'claude-haiku-5-5',
});

test('toast and text carry the strong note at 210k', async () => {
  const h = harness();
  const r = await h.fire(usage(2, 200_000, 10_000));
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0]!, /context 210k ≥ 200k/);
  assert.match(r.text ?? '', /\/fast-compact/);
});

test('the metrics line holds the context sum input + cache_read + cache_creation', async () => {
  const h = harness();
  await h.fire(usage(2, 200_000, 10_000));
  const line = h.files.get('C:/fake-home/.claude/context-governor/sess-a.jsonl')!.trim();
  const rec = JSON.parse(line);
  assert.equal(rec.context, 210_002);
  assert.equal(rec.cacheRead, 200_000);
  assert.equal(rec.cacheCreation, 10_000);
  assert.equal(rec.slow, false);
});

test('a failed state write does not repeat the strong note on the next turn', async () => {
  const h = harness({ sid: 'sess-wf', writeFails: true });
  await h.fire(usage(2, 210_000, 0));
  const second = await h.fire(usage(2, 215_000, 0));
  assert.equal(h.toasts.length, 1);
  assert.equal(second.text, undefined);
});

test('an unknown session id writes no state or metrics, and the note is decided from a fresh state', async () => {
  const h = harness({ sid: new Error('no session') });
  const r = await h.fire(usage(2, 250_000, 0));
  assert.equal(h.files.size, 0);
  assert.equal(h.toasts.length, 1);
  assert.match(r.text ?? '', /\/fast-compact/);
});

test('unknown context (no usage, session usage unreadable) decides nothing', async () => {
  const h = harness({ usage: new Error('no usage') });
  const r = await h.fire(undefined);
  assert.equal(h.files.size, 0);
  assert.equal(h.toasts.length, 0);
  assert.equal(r.text, undefined);
});

test('a slow hook shows no toast and no text, and the metrics line says slow', async () => {
  const h = harness({ sid: 'sess-slow', delayMs: 230 });
  const r = await h.fire(usage(2, 210_000, 0));
  assert.equal(h.toasts.length, 0);
  assert.equal(r.text, undefined);
  assert.equal(JSON.parse(h.files.get('C:/fake-home/.claude/context-governor/sess-slow.jsonl')!.trim()).slow, true);
});
