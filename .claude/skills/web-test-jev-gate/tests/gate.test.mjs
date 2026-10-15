// gate.mjs with Jev: never lowers the agent's flag, disputes go back to the agent, Jev off = rules only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { fakeJev, run, tmpDir } from './fake-jev.mjs';

const GATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gate.mjs');
const plan = (steps) => {
  const dir = tmpDir('jev-gate-');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ cases: [{ id: 'TC01', steps: steps.map((s, i) => ({ n: i + 1, ...s })) }] }));
  return dir;
};
const saved = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).cases[0].steps;
// Fake Jev: "write" probability from the step text.
const jevSays = (map) => (body) => ({ writes: { probabilities: { write: map(body.state.step_action), read: 1 - map(body.state.step_action) } } });

describe('gate.mjs with Jev', () => {
  it('Jev catches a write the keyword rule misses → disputed (exit 3), step stays listed', async () => {
    const dir = plan([{ action: 'As the line manager, OK the overtime claim', writes: false }, { action: 'Look at the leave balance card', writes: false }]);
    const fake = await fakeJev(jevSays((t) => (/OK the overtime/.test(t) ? 0.97 : 0.02)));
    const r = (await run(GATE, [dir], { url: fake.url }));
    await fake.close();
    assert.equal(r.code, 3);
    assert.match(r.out, /gate: steps=2 write=0 disputed=1 read=1 overruled=0 jev=on/);
    const [s1, s2] = saved(dir);
    assert.equal(s1.gate.writes, 'disputed');
    assert.equal(s1.gate.jev, 0.97);
    assert.equal(s1.gate.rule, false);
    assert.equal(s2.gate.writes, 'read');
  });
  it('agent keeps read with a reason → overruled, exit 0; agent write is never lowered', async () => {
    const dir = plan([
      { action: 'Hit Done on the checklist', writes: false, writesReason: 'only toggles a local filter' },
      { action: 'Press Send', writes: true },
    ]);
    const fake = await fakeJev(jevSays(() => 0.1));
    const r = (await run(GATE, [dir], { url: fake.url }));
    await fake.close();
    assert.equal(r.code, 0, r.out);
    const [s1, s2] = saved(dir);
    assert.equal(s1.gate.writes, 'read'); // rule/jev below 0.5 here → plain read
    assert.equal(s2.gate.writes, 'write'); // agent said write, Jev said read → still write
    assert.equal(s2.gate.why, 'agent');
  });
  it('rule + agent reason → overruled line is printed', async () => {
    const dir = plan([{ action: 'Navigate to the next month and submit nothing', writes: false, writesReason: 'view change only' }]);
    const fake = await fakeJev(jevSays(() => 0.1));
    const r = (await run(GATE, [dir], { url: fake.url }));
    await fake.close();
    assert.equal(r.code, 0);
    assert.match(r.out, /overruled TC01-S01/);
    assert.match(r.out, /overruled=1 jev=on/);
  });
  it('Jev off or failing → rules only, never blocks the run', async () => {
    const dir = plan([{ action: 'Look at the leave balance card', writes: false }]);
    const off = (await run(GATE, [dir], { enabled: '0' }));
    assert.equal(off.code, 0);
    assert.match(off.out, /jev=off/);
    const fake = await fakeJev(() => null); // HTTP 500
    const bad = (await run(GATE, [dir], { url: fake.url }));
    await fake.close();
    assert.equal(bad.code, 0);
    assert.match(bad.out, /read=1/);
    assert.equal(saved(dir)[0].gate.jev, null);
  });
});
