// oracle.mjs with Jev: rules first (all quoted strings found = pass), Jev second (pass >= 0.95, fail >= 0.85), agent last.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { fakeJev, run, tmpDir } from './fake-jev.mjs';

const ORACLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'oracle.mjs');
const plan = (expecteds) => {
  const dir = tmpDir('jev-oracle-');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ cases: [{ id: 'TC01', steps: expecteds.map((e, i) => ({ n: i + 1, action: `step ${i + 1}`, expected: e })) }] }));
  return dir;
};
const step = (dir, n) => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).cases[0].steps[n - 1];
const says = (label, p) => () => ({ verdict: { probabilities: { pass: 0, fail: 0, not_ready: 0, ambiguous: 0, [label]: p, ...(label === 'pass' ? { fail: 1 - p } : { pass: 1 - p }) } } });

describe('oracle.mjs with Jev', () => {
  it('quoted strings all found → rule PASS, Jev is not called', async () => {
    const dir = plan(["Toast reads 'Leave request submitted'"]);
    const fake = await fakeJev(says('fail', 0.99));
    const r = (await run(ORACLE, [dir, 'TC01', '1', '--observed', 'Leave request submitted successfully'], { url: fake.url }));
    await fake.close();
    assert.match(r.out, /^oracle=pass by=rule p=- review=false/);
    assert.equal(fake.calls.length, 0);
  });
  it('no quoted strings → Jev decides: pass needs >= 0.95, anything less goes to the agent', async () => {
    const dir = plan(['The request is Pending', 'The request is Pending']);
    const hi = await fakeJev(says('pass', 0.97));
    const a = (await run(ORACLE, [dir, 'TC01', '1', '--observed', 'Status: Pending'], { url: hi.url }));
    await hi.close();
    assert.match(a.out, /^oracle=pass by=jev p=0\.97 review=false/);
    assert.equal(hi.calls[0].body.state.expected, 'The request is Pending');
    const mid = await fakeJev(says('pass', 0.9));
    const b = (await run(ORACLE, [dir, 'TC01', '2', '--observed', 'Status: Pending'], { url: mid.url }));
    await mid.close();
    assert.match(b.out, /^oracle=review by=model p=0\.9 review=true/);
    assert.match(b.out, /judge it yourself/);
    assert.equal(step(dir, 2).status, 'review');
  });
  it('fail is accepted from 0.85; not_ready never becomes a final status', async () => {
    const dir = plan(['Hours is 160', 'Hours is 160']);
    const f = await fakeJev(says('fail', 0.88));
    const a = (await run(ORACLE, [dir, 'TC01', '1', '--observed', 'Hours: 0'], { url: f.url }));
    await f.close();
    assert.match(a.out, /^oracle=fail by=jev/);
    const n = await fakeJev(() => ({ verdict: { probabilities: { pass: 0, fail: 0, not_ready: 0.99, ambiguous: 0.01 } } }));
    const b = (await run(ORACLE, [dir, 'TC01', '2', '--observed', 'loading'], { url: n.url }));
    await n.close();
    assert.match(b.out, /oracle=review|oracle=not_ready/);
    assert.notEqual(step(dir, 2).status, 'pass');
  });
  it('Jev off → review; overriding a Jev verdict needs --reason', async () => {
    const dir = plan(['Hours is 160']);
    assert.match((await run(ORACLE, [dir, 'TC01', '1', '--observed', 'Hours: 0'], { enabled: '0' })).out, /^oracle=review by=model .* jev=off/);
    const f = await fakeJev(says('fail', 0.99));
    (await run(ORACLE, [dir, 'TC01', '1', '--observed', 'Hours: 0'], { url: f.url }));
    await f.close();
    assert.equal((await run(ORACLE, [dir, 'TC01', '1', '--status', 'pass'])).code, 2);
    assert.match((await run(ORACLE, [dir, 'TC01', '1', '--status', 'pass', '--reason', 'stale text'])).out, /override=true/);
  });
});
