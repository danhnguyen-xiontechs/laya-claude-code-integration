import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, buildJevRequest, decideAndBuild, parseJevResponse, planTrim, redact, splitLines } from '../hooks/trim-core.ts';
import type { Fetcher } from '../hooks/trim-core.ts';
import { FIXTURES } from './fixtures.ts';

const opt = { ...DEFAULTS, useJev: true };
const status = (isError: boolean) => (isError ? 'Command FAILED.' : 'Command succeeded (exit code 0).');
const okJev = (askCount: number, strategy = 'errors_only', p = 0.9, need = 0.2): Fetcher => async () => ({
  ok: true, status: 200,
  text: JSON.stringify({ answers: { strategy: { choice: strategy, probabilities: { [strategy]: p, [strategy === 'errors_only' ? 'keep_full_output' : 'errors_only']: 1 - p } }, ...Object.fromEntries(Array.from({ length: askCount }, (_, i) => [`need_${i}`, { noul: need }])) } }),
});
const jevWith = (fetcher: Fetcher, sleepMs = 1e9) => ({ key: 'test-key', fetcher, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, sleepMs))), now: () => Date.now() });

for (const f of FIXTURES) {
  test(`fixture ${f.name}: ${f.expect}, criticals kept (rules only)`, async () => {
    const out = await decideAndBuild({ command: f.command, text: f.text, opt: { ...opt, useJev: false }, statusLine: status(f.isError), rawPath: '/raw/x.log' });
    assert.equal(out.plan.action === 'trim' && out.built ? 'trim' : 'pass', f.expect, out.plan.reason);
    const seen = out.built?.text ?? f.text;
    for (const c of f.critical) assert.ok(seen.includes(c), `${f.name} lost: ${c}`);
    if (out.built) {
      assert.ok(out.built.text.startsWith('[smart-trim] Output trimmed'));
      assert.ok(out.built.text.includes('/raw/x.log'));
      // every non-marker line is an original line, verbatim
      const orig = new Set(splitLines(f.text));
      for (const l of splitLines(out.built.text)) if (!l.startsWith('[smart-trim]')) assert.ok(orig.has(l), `invented line: ${l}`);
    }
  });
}

const trimmable = FIXTURES.filter((f) => f.expect === 'trim');
const failures: [string, Fetcher, number?][] = [
  ['timeout', () => new Promise(() => {}), 20],
  ['invalid_json', async () => ({ ok: true, status: 200, text: '{"answers": {strategy' })],
  ['http_500', async () => ({ ok: false, status: 500, text: 'boom' })],
  ['transport', async () => { throw new Error('ECONNRESET'); }],
  ['unknown_strategy', async () => ({ ok: true, status: 200, text: JSON.stringify({ answers: { strategy: { probabilities: { rewrite_log: 1 } } } }) })],
];

for (const [name, fetcher, sleepMs] of failures) {
  test(`jev ${name}: falls back to rules, criticals kept, no stall`, async () => {
    for (const f of trimmable) {
      const t0 = Date.now();
      const out = await decideAndBuild({ command: f.command, text: f.text, opt: { ...opt, maxJevLatencyMs: 50 }, statusLine: status(f.isError), rawPath: null, jev: jevWith(fetcher, sleepMs) });
      assert.ok(Date.now() - t0 < 2000);
      const seen = out.built?.text ?? f.text;
      for (const c of f.critical) assert.ok(seen.includes(c), `${f.name}/${name} lost: ${c}`);
      if (out.jev.called) assert.ok(out.plan.reason.startsWith('rule_fallback:'), out.plan.reason);
    }
  });
}

test('jev low confidence → rule plan kept', async () => {
  const f = FIXTURES.find((x) => x.name === 'warnings_then_fatal')!;
  const plan = planTrim(f.command, f.text, opt);
  const out = await decideAndBuild({ command: f.command, text: f.text, opt, statusLine: 'x', rawPath: null, jev: jevWith(okJev(plan.ask.length, 'errors_only', 0.4)) });
  assert.equal(out.plan.reason, 'jev_low_confidence');
});

test('jev "drop everything" cannot drop mandatory evidence', async () => {
  for (const f of trimmable) {
    const plan = planTrim(f.command, f.text, opt);
    const out = await decideAndBuild({ command: f.command, text: f.text, opt, statusLine: 'x', rawPath: null, jev: jevWith(okJev(plan.ask.length, 'errors_only', 0.99, 0)) });
    for (const c of f.critical) assert.ok((out.built?.text ?? f.text).includes(c), `${f.name} lost: ${c}`);
  }
});

test('jev keep_full_output → original passes through', async () => {
  const f = FIXTURES.find((x) => x.name === 'exception_stack_trace')!;
  const plan = planTrim(f.command, f.text, opt);
  const out = await decideAndBuild({ command: f.command, text: f.text, opt, statusLine: 'x', rawPath: null, jev: jevWith(okJev(plan.ask.length, 'keep_full_output', 0.9)) });
  assert.equal(out.built, null);
});

test('validator rejects out-of-range / extra / missing answers', () => {
  const base = { strategy: { probabilities: { errors_only: 0.9 } } };
  assert.equal(parseJevResponse(JSON.stringify({ answers: { ...base, need_0: { noul: 0.1 }, need_5: { noul: 1 } } }), 1).ok, false);
  assert.equal(parseJevResponse(JSON.stringify({ answers: { ...base, text: 'rm -rf /' } }), 0).ok, false);
  assert.equal(parseJevResponse(JSON.stringify({ answers: base }), 2).ok, false);
  assert.equal(parseJevResponse(JSON.stringify({ answers: { strategy: { probabilities: { errors_only: 2 } } } }), 0).ok, false);
  assert.equal(parseJevResponse(JSON.stringify({ answers: base }), 0).ok, true);
});

test('redaction: secrets never reach the Jev request', () => {
  const f = FIXTURES.find((x) => x.name === 'secret_like_strings')!;
  const plan = planTrim(f.command, f.text, opt);
  assert.ok(plan.ask.length >= 3, 'secret lines are optional candidates sent to Jev');
  const body = JSON.stringify(buildJevRequest(plan, splitLines(f.text), 'x', opt.maxJevInputBytes));
  for (const s of f.secrets!) assert.ok(!body.includes(s), `leaked ${s}`);
  assert.ok(body.includes('[REDACTED]'));
  assert.equal(redact('ghp_abcdefghijklmnopqrstuvwxyz12'), '[REDACTED]');
});

test('Jev request stays under maxJevInputBytes', () => {
  for (const f of trimmable) {
    const plan = planTrim(f.command, f.text, opt);
    const body = JSON.stringify(buildJevRequest(plan, splitLines(f.text), 'x', 4000).state);
    assert.ok(Buffer.byteLength(body) <= 4000 || plan.ask.length > 10, `${f.name}: ${Buffer.byteLength(body)}`);
  }
});
