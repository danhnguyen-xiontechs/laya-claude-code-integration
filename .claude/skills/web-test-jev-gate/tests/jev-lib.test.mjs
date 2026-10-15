// Run: node --test .claude/skills/web-test-jev-<skill>/tests/
// jev-lib / jev-check / decision-provider contract, against a fake Jev on 127.0.0.1 (no network, no real key).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { fakeJev, run, readJsonl, KEY, tmpDir } from './fake-jev.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const CHECK = path.join(SCRIPTS, 'jev-check.mjs');
const LIB = pathToFileURL(path.join(SCRIPTS, 'jev-lib.mjs')).href;
const PROV = pathToFileURL(path.join(SCRIPTS, 'decision-provider.mjs')).href;

describe('jev-check (one line, consent first)', () => {
  it('enabled + key → on with the model id', async () => {
    assert.match((await run(CHECK, [])).out, /^jev=on model=typesafe\/jev-1\.13$/);
  });
  it('enabled without key → no-openrouter-key', async () => {
    assert.equal((await run(CHECK, [], { key: '' })).out, 'jev=off reason=no-openrouter-key');
  });
  it('user said never → disabled, even with a key', async () => {
    assert.equal((await run(CHECK, [], { enabled: '0' })).out, 'jev=off reason=disabled');
  });
  it('never asked → ask (hosted API: no silent use)', async (t) => {
    if (fs.existsSync(path.join(SCRIPTS, '..', 'jev.local.json'))) return t.skip('this machine already answered');
    assert.equal((await run(CHECK, [], { enabled: null })).out, 'jev=off reason=ask');
  });
});

describe('decision-provider: endpoint override is loopback-only', () => {
  it('honours 127.0.0.1 / localhost, ignores anything else so the key cannot be redirected', async () => {
    const { jevUrl, JEV_URL } = await import(PROV);
    assert.equal(jevUrl({ JEV_URL_OVERRIDE: 'http://127.0.0.1:9999' }), 'http://127.0.0.1:9999');
    assert.equal(jevUrl({ JEV_URL_OVERRIDE: 'http://localhost:1' }), 'http://localhost:1');
    assert.equal(jevUrl({ JEV_URL_OVERRIDE: 'https://evil.example/decisions' }), JEV_URL);
    assert.equal(jevUrl({ JEV_URL_OVERRIDE: 'not a url' }), JEV_URL);
    assert.equal(jevUrl({}), JEV_URL);
  });
});

describe('jev-lib.ask', () => {
  it('maps answers to {label,p,probabilities}, sends the bearer key, logs usage without text or key', async () => {
    const home = tmpDir();
    const fake = await fakeJev(() => ({ q: { probabilities: { a: 0.2, b: 0.8 }, confidence: 0.77 } }));
    const script = path.join(home, 'probe.mjs');
    fs.writeFileSync(script, `import { loadConfig, ask } from ${JSON.stringify(LIB)};
      const r = await ask(loadConfig(), { secret_state: 'EMPLOYEE-SALARY-123' }, { q: { type: 'choice', instructions: 'x', criteria: { a: 'A', b: 'B' } } });
      console.log(JSON.stringify(r));`);
    const out = (await run(script, [], { url: fake.url, home }));
    await fake.close();
    const r = JSON.parse(out.out);
    assert.equal(r.q.label, 'b');
    assert.equal(r.q.p, 0.8);
    assert.equal(r.q.confidence, 0.77);
    assert.equal(fake.calls[0].auth, `Bearer ${KEY}`);
    assert.equal(fake.calls[0].body.model, 'typesafe/jev-1.13');
    const usage = fs.readFileSync(path.join(home, '.ess-web-test', 'jev-usage.jsonl'), 'utf8');
    assert.match(usage, /"cost":0.00001/);
    assert.ok(!usage.includes(KEY) && !usage.includes('EMPLOYEE-SALARY'), 'usage log must not hold the key or request text');
  });
  it('HTTP error, bad endpoint or consent missing → null (callers fall back to rules)', async () => {
    const home = tmpDir();
    const script = path.join(home, 'probe.mjs');
    fs.writeFileSync(script, `import { loadConfig, ask, ready } from ${JSON.stringify(LIB)};
      const cfg = loadConfig();
      const r = ready(cfg) ? await ask(cfg, { s: 1 }, { q: { type: 'choice', instructions: 'x', criteria: { a: 'A', b: 'B' } } }) : null;
      console.log(JSON.stringify({ ready: ready(cfg), r }));`);
    const fake = await fakeJev(() => null);
    const bad = JSON.parse((await run(script, [], { url: fake.url, home })).out);
    await fake.close();
    assert.deepEqual(bad, { ready: true, r: null });
    const off = JSON.parse((await run(script, [], { enabled: '0', home })).out);
    assert.equal(off.ready, false);
  });
});

describe('usage log', () => {
  it('readJsonl helper tolerates a missing file', async () => assert.deepEqual(readJsonl(path.join(tmpDir(), 'nope.jsonl')), []));
});
