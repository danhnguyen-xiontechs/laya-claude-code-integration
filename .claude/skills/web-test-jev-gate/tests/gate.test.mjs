// gate.mjs with Jev: never lowers the agent's flag, disputes go back to the agent, Jev off = rules only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { fakeJev, run, tmpDir, readJsonl } from './fake-jev.mjs';

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

describe('gate.mjs --check-action (per click)', () => {
  const GATE_LOG = (home) => path.join(home, '.ess-web-test', 'gate-jev-log.jsonl');
  const twoSteps = () => plan([{ action: 'Open the attendance calendar', writes: false }, { action: 'Submit the leave request', writes: true }]);
  const writey = jevSays((t) => (/submit|approve/i.test(t) ? 0.96 : 0.03));

  it('write-looking click on a read step → stop, exit 3, recorded on the step and in the gate log', async () => {
    const dir = twoSteps();
    const fake = await fakeJev(writey);
    const r = await run(GATE, [dir, '--check-action', 'button "Approve" (POST /api/approvals)', '--step', 'TC01-S01'], { url: fake.url });
    await fake.close();
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /^gate-action=stop step=TC01-S01 marked=read rule=true p=0\.96 jev=on/m);
    assert.match(r.out, /STOP: .*--confirm-read/);
    const a = saved(dir)[0].gate.actions;
    assert.equal(a.length, 1);
    assert.equal(a[0].verdict, 'stop');
    assert.equal(a[0].action, 'button "Approve" (POST /api/approvals)');
    const logged = readJsonl(GATE_LOG(r.home));
    assert.equal(logged.length, 1);
    assert.equal(logged[0].kind, 'action');
    assert.equal(logged[0].step, 'TC01-S01');
    assert.equal(logged[0].verdict, 'stop');
  });
  it('Jev alone (no keyword) is enough to stop', async () => {
    const dir = twoSteps();
    const fake = await fakeJev(jevSays((t) => (/OK the claim/.test(t) ? 0.9 : 0.02)));
    const r = await run(GATE, [dir, '--check-action', 'button "OK the claim"', '--step', 'TC01-S1'], { url: fake.url });
    await fake.close();
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /gate-action=stop .*rule=false p=0\.9 /);
  });
  it('--confirm-read lets the agent go on as read, exit 0, reason kept', async () => {
    const dir = twoSteps();
    const fake = await fakeJev(writey);
    const r = await run(GATE, [dir, '--check-action', 'button "Submit filter"', '--step', 'TC01-S01', '--confirm-read', 'only applies a list filter'], { url: fake.url });
    await fake.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /gate-action=confirmed-read/);
    assert.equal(saved(dir)[0].gate.actions[0].reason, 'only applies a list filter');
  });
  it('read-looking click on a read step → allow, exit 0', async () => {
    const dir = twoSteps();
    const fake = await fakeJev(writey);
    const r = await run(GATE, [dir, '--check-action', 'tab "Team attendance" /attendance/team', '--step', 'TC01-S01'], { url: fake.url });
    await fake.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /gate-action=allow step=TC01-S01 marked=read rule=false p=0\.03/);
  });
  it('write click on a step marked write (already OKed) → allow-write, exit 0', async () => {
    const dir = twoSteps();
    const fake = await fakeJev(writey);
    const r = await run(GATE, [dir, '--check-action', 'button "Submit"', '--step', 'TC01-S02'], { url: fake.url });
    await fake.close();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /gate-action=allow-write step=TC01-S02 marked=write/);
  });
  it('Jev off → keyword rule only, still stops on an obvious write', async () => {
    const dir = twoSteps();
    const r = await run(GATE, [dir, '--check-action', 'button "Delete"', '--step', 'TC01-S01'], { enabled: '0' });
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /gate-action=stop .*rule=true p=- jev=off/);
  });
  it('unknown or missing step → usage error, exit 2, nothing written', async () => {
    const dir = twoSteps();
    const r1 = await run(GATE, [dir, '--check-action', 'button "Submit"', '--step', 'TC09-S01'], { enabled: '0' });
    const r2 = await run(GATE, [dir, '--check-action', 'button "Submit"'], { enabled: '0' });
    assert.equal(r1.code, 2);
    assert.match(r1.err, /no step TC09-S01/);
    assert.equal(r2.code, 2);
    assert.equal(saved(dir)[0].gate, undefined);
  });
  it('re-running the plan check keeps the recorded action checks', async () => {
    const dir = twoSteps();
    await run(GATE, [dir, '--check-action', 'button "Delete"', '--step', 'TC01-S01'], { enabled: '0' });
    const r = await run(GATE, [dir], { enabled: '0' });
    assert.equal(r.code, 0, r.out);
    const g = saved(dir)[0].gate;
    assert.equal(g.writes, 'read');
    assert.equal(g.actions.length, 1);
  });
});
