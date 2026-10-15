// gate.mjs --check-action (per click) with Laya: same contract as the Jev copy. A fake laya-serve on 127.0.0.1
// answers /health and /v1/systemone; HOME is isolated so ~/.ess-web-test is never touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const GATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gate.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function fakeLaya(writeP) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/health') return res.end('{"ok":true}');
      const p = writeP(JSON.parse(raw).state.step_action);
      res.end(JSON.stringify({ answers: { writes: { probabilities: { write: p, read: 1 - p } } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function run(args, layaUrl = 'http://127.0.0.1:9') {
  const home = tmp('laya-gate-home-');
  const env = { ...process.env, USERPROFILE: home, HOME: home, LAYA_URL: layaUrl };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GATE, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim(), home }));
  });
}

const plan = () => {
  const dir = tmp('laya-gate-');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ cases: [{ id: 'TC01', steps: [
    { n: 1, action: 'Open the attendance calendar', writes: false },
    { n: 2, action: 'Submit the leave request', writes: true },
  ] }] }));
  return dir;
};
const steps = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')).cases[0].steps;

describe('laya gate.mjs --check-action', () => {
  it('Laya says write on a read step → stop, exit 3, logged to gate-log.jsonl', async () => {
    const dir = plan();
    const laya = await fakeLaya((t) => (/OK the claim/.test(t) ? 0.88 : 0.05));
    const r = await run([dir, '--check-action', 'button "OK the claim"', '--step', 'TC01-S01'], laya.url);
    await laya.close();
    assert.equal(r.code, 3, r.out + r.err);
    assert.match(r.out, /^gate-action=stop step=TC01-S01 marked=read rule=false p=0\.88 laya=on/m);
    assert.equal(steps(dir)[0].gate.actions[0].verdict, 'stop');
    const log = fs.readFileSync(path.join(r.home, '.ess-web-test', 'gate-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log[0].kind, 'action');
    assert.equal(log[0].verdict, 'stop');
  });
  it('--confirm-read → exit 0; write step → allow-write; read click → allow', async () => {
    const dir = plan();
    const laya = await fakeLaya(() => 0.05);
    const a = await run([dir, '--check-action', 'button "Delete"', '--step', 'TC01-S01', '--confirm-read', 'deletes a draft filter only'], laya.url);
    const b = await run([dir, '--check-action', 'button "Submit"', '--step', 'TC01-S02'], laya.url);
    const c = await run([dir, '--check-action', 'tab "My attendance"', '--step', 'TC01-S01'], laya.url);
    await laya.close();
    assert.equal(a.code, 0); assert.match(a.out, /gate-action=confirmed-read/);
    assert.equal(b.code, 0); assert.match(b.out, /gate-action=allow-write/);
    assert.equal(c.code, 0); assert.match(c.out, /gate-action=allow .*laya=on/);
  });
  it('Laya down → keyword rule only', async () => {
    const r = await run([plan(), '--check-action', 'button "Approve"', '--step', 'TC01-S01']);
    assert.equal(r.code, 3);
    assert.match(r.out, /rule=true p=- laya=off/);
  });
});
