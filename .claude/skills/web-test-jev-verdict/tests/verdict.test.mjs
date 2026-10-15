// verdict.mjs with Jev: p >= 0.85 decides, 0.60..0.85 decides + flags review, below / off → the agent judges.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { fakeJev, run, tmpDir, readJsonl } from './fake-jev.mjs';

const VERDICT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'verdict.mjs');
const plan = () => {
  const dir = tmpDir('jev-verdict-');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ cases: [{ id: 'TC01', steps: [1, 2, 3, 4].map((n) => ({ n, action: `step ${n}`, expected: 'Total hours is 160' })) }] }));
  return dir;
};
const step = (dir, n) => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).cases[0].steps[n - 1];
// Fake Jev: the label/p come from a marker in `actual`.
const jev = (body) => {
  const a = body.state.actual;
  const [label, p] = a.startsWith('HI') ? ['pass', 0.97] : a.startsWith('MID') ? ['fail', 0.7] : ['pass', 0.4];
  const rest = (1 - p) / 2;
  return { verdict: { probabilities: { pass: label === 'pass' ? p : rest, fail: label === 'fail' ? p : rest, blocked: rest } } };
};

describe('verdict.mjs with Jev', () => {
  it('confident → status is Jev\'s, review false; mid → Jev\'s + review; low → status review for the agent', async () => {
    const dir = plan();
    const fake = await fakeJev(jev);
    const hi = (await run(VERDICT, [dir, 'TC01', '1', '--actual', 'HI Total hours: 160'], { url: fake.url }));
    const mid = (await run(VERDICT, [dir, 'TC01', '2', '--actual', 'MID shows 0'], { url: fake.url }));
    const low = (await run(VERDICT, [dir, 'TC01', '3', '--actual', 'LOW unclear'], { url: fake.url }));
    await fake.close();
    assert.match(hi.out, /^verdict=pass by=jev p=0\.97 review=false case=TC01:[\w-]+ remaining-not-run=3 jev=on/);
    assert.match(mid.out, /^verdict=fail by=jev p=0\.7 review=true/);
    assert.match(low.out, /^verdict=review by=model p=0\.4 review=true/);
    assert.match(low.out, /judge it yourself/);
    assert.equal(step(dir, 1).verdict.jev.label, 'pass');
    assert.equal(step(dir, 3).status, 'review');
  });
  it('agent resolves a review step, and overriding a Jev verdict needs --reason', async () => {
    const dir = plan();
    const fake = await fakeJev(jev);
    (await run(VERDICT, [dir, 'TC01', '1', '--actual', 'HI ok'], { url: fake.url }));
    await fake.close();
    const noReason = (await run(VERDICT, [dir, 'TC01', '1', '--status', 'fail']));
    assert.equal(noReason.code, 2);
    assert.match(noReason.err, /overriding Jev needs --reason/);
    const over = (await run(VERDICT, [dir, 'TC01', '1', '--status', 'fail', '--reason', 'value is 0 not 160']));
    assert.match(over.out, /^verdict=fail by=model .*override=true/);
    assert.equal(step(dir, 1).verdict.override, true);
  });
  it('Jev off → review (the agent judges, exactly as in plain web-test); the decision log keeps text + probabilities only', async () => {
    const dir = plan();
    const off = (await run(VERDICT, [dir, 'TC01', '4', '--actual', 'HI whatever'], { enabled: '0' }));
    assert.match(off.out, /^verdict=review by=model p=- review=true .* jev=off/);
    const home = tmpDir();
    const fake = await fakeJev(jev);
    (await run(VERDICT, [dir, 'TC01', '2', '--actual', 'HI again'], { url: fake.url, home }));
    await fake.close();
    const [log] = readJsonl(path.join(home, '.ess-web-test', 'verdict-jev-log.jsonl'));
    assert.equal(log.step, 'TC01-S2');
    assert.ok(log.jev.pass > 0.9);
  });
});
