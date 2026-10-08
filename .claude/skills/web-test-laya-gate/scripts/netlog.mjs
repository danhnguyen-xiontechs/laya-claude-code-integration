// Records every data-changing API request (non-GET to /api/) made by the port-9222 browser during a run,
// so `gate.mjs --audit` can check that no step wrote data the gate called read-only.
// Method, path (query stripped), status and time only — never headers or bodies (they carry the bearer token).
//
// Usage:
//   node netlog.mjs start <runDir>   detach a recorder → <runDir>/api/netlog.jsonl (pid in api/netlog.pid)
//   node netlog.mjs stop  <runDir>   stop it
// The recorder reconnects on its own when the browser restarts (role switch), until stopped.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [cmd, runDir] = process.argv.slice(2);
const CDP = process.env.NETLOG_CDP || 'http://127.0.0.1:9222';
if (!['start', 'stop', 'run'].includes(cmd) || !runDir) { console.error('Usage: node netlog.mjs start|stop <runDir>'); process.exit(2); }
const apiDir = path.join(runDir, 'api');
const pidFile = path.join(apiDir, 'netlog.pid');
const logFile = path.join(apiDir, 'netlog.jsonl');

if (cmd === 'start') {
  fs.mkdirSync(apiDir, { recursive: true });
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    try { process.kill(pid, 0); console.log(`netlog: already running pid=${pid}`); process.exit(0); } catch { /* stale */ }
  }
  fs.writeFileSync(logFile, ''); // exists from the start: an empty log = recorder ran and saw no writes
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', runDir], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  console.log(`netlog: recording pid=${child.pid} → ${logFile}`);
} else if (cmd === 'stop') {
  if (!fs.existsSync(pidFile)) { console.log('netlog: not running'); process.exit(0); }
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  try { process.kill(pid); } catch { /* already gone */ }
  fs.rmSync(pidFile, { force: true });
  const n = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0;
  console.log(`netlog: stopped, ${n} write request(s) recorded`);
} else {
  await record();
}

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const appdata = process.env.APPDATA || '';
  for (const c of ['playwright-core', 'playwright', path.join(appdata, 'npm', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(appdata, 'npm', 'node_modules', 'playwright-core')]) { try { return req(c); } catch { /* next */ } }
  throw new Error('playwright-core not found');
}

async function record() {
  const pw = loadPlaywright();
  const seen = new WeakSet();
  const watch = (page) => {
    if (seen.has(page)) return; seen.add(page);
    page.on('response', (res) => {
      const req = res.request();
      const m = req.method();
      if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return;
      let u; try { u = new URL(req.url()); } catch { return; }
      if (!u.pathname.includes('/api/')) return;
      fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), method: m, path: u.pathname, status: res.status(), page: new URL(page.url()).pathname }) + '\n');
    });
  };
  for (;;) {
    try {
      const browser = await pw.chromium.connectOverCDP(CDP, { timeout: 5000 });
      for (const ctx of browser.contexts()) { ctx.pages().forEach(watch); ctx.on('page', watch); }
      await new Promise((resolve) => browser.on('disconnected', resolve));
    } catch { /* browser not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
