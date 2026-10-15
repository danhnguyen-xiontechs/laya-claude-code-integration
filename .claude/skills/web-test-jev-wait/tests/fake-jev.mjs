// Test helpers: a fake Jev (OpenRouter Decisions API) on 127.0.0.1 plus a runner that executes a skill script
// against it with an isolated HOME, so tests never touch the real API, the real key or ~/.ess-web-test.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const KEY = 'sk-or-test-secret-123';

/** answerFor(body) → { questionName: { probabilities } } ; null → HTTP 500. Returns { url, calls, close }. */
export async function fakeJev(answerFor) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      calls.push({ auth: req.headers.authorization, body });
      const answers = answerFor(body);
      if (!answers) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 500, message: 'boom' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'typesafe/jev-1.13-test', answers, usage: { input_tokens: 40, output_tokens: 3, cost: 0.00001 } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((r) => server.close(r)) };
}

export const tmpDir = (p = 'jev-test-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

/**
 * Runs `node <script> ...args` with the fake endpoint and an isolated HOME. Returns Promise<{ code, out, err, home }>.
 * Must be async (not spawnSync): the fake server lives in this process and has to keep answering while the child runs.
 */
export function run(script, args, { url, enabled = '1', key = KEY, home = tmpDir('jev-home-'), env = {} } = {}) {
  const e = { ...process.env, USERPROFILE: home, HOME: home, JEV_ENABLED: enabled, OPENROUTER_API_KEY: key, ...env };
  if (url) e.JEV_URL_OVERRIDE = url;
  if (!key) delete e.OPENROUTER_API_KEY;
  if (enabled === null) delete e.JEV_ENABLED; // null = the user was never asked
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 30000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim(), home }); });
  });
}

export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
