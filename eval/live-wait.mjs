// Live A/B of wait.mjs: the Laya skill and the Jev skill run against the SAME pages in a real (headless Edge) browser.
// Own CDP port (9334) and a throwaway profile; never touches port 9222 or the user's role browser.
//   node eval/live-wait.mjs        → eval/results/live-wait.json
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = 9334, WEB = 8099;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error('no Edge/Chrome found');
const NAV = 'ESS System Skills & performance My work Remuneration My organisation Home Attendance Attendance My attendance Team attendance Attendance shortage Overtime Request attendance regularization';

const page = (title, body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}<script>${script}</script></body></html>`;
const PAGES = {
  '/slow': page('ESS - Time off', '<div id="x" class="skeleton">Leave requests loading...</div>', "setTimeout(()=>{document.getElementById('x').className='';document.getElementById('x').textContent='Leave requests Annual leave Pending Leave request submitted';},3000)"),
  '/wrongpage': page('ESS', '<main>Team view Direct reports 0 No team members to display</main>'),
  '/login-code': page('Sign in', '<main>Enter code We texted your phone +65 •••• 12. Please enter the code to sign in. Resend code</main>'),
  '/login-authenticator': page('Sign in', "<main>Approve a request on your phone Open your Authenticator app and approve the request. Don't see it?</main>"),
  '/error-load': page('ESS', "<main>We couldn't load your data. Check your connection and try again. Retry</main>"),
  '/error-503': page('ESS', '<main>Oops! Service temporarily unavailable (503) Please come back in a few minutes</main>'),
  '/app-nav': page('ESS', `<nav>${NAV}</nav><main>Team view Direct reports 0 No team members to display</main>`),
  '/app-nav-attendance': page('ESS', `<nav>${NAV}</nav><main>My attendance Week 5 - 11 Oct Mon 05/10 8h Tue 06/10 8h Scheduled hours 40 Total hours 16</main>`),
};
// scenario = [id, path, expect, what a good wait does]
const SCENARIOS = [
  ['slow-with-expect', '/slow', 'Leave request submitted', 'ready after ~3 s (rules only)'],
  ['wrong-page', '/wrongpage', 'Attendance shortage', 'not ready: expected text never shows (timeout or early wrong-page)'],
  ['login-code', '/login-code', 'Attendance', 'status=login (unusual MFA wording the regex misses)'],
  ['login-authenticator', '/login-authenticator', 'Attendance', 'status=login'],
  ['error-load', '/error-load', 'Attendance', 'status=error (unusual wording)'],
  ['error-503', '/error-503', 'Attendance', 'status=error'],
  ['app-nav-wrong', '/app-nav', 'Payroll summary', 'NOT login (a normal app page with nav text; expected text absent)'],
  ['app-nav-found', '/app-nav-attendance', 'Total hours 16', 'ready (rules)'],
];
const SKILLS = [['laya', 'web-test-laya-wait', 'laya'], ['jev', 'web-test-jev-wait', 'jev']];
const TIMEOUT = 12;

const server = http.createServer((req, res) => { const p = PAGES[req.url.split('?')[0]]; res.writeHead(p ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(p || 'nope'); });
await new Promise((r) => server.listen(WEB, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-wait-'));

async function portFree() { try { await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) }); return false; } catch { return true; } }
if (!(await portFree())) throw new Error(`port ${PORT} is in use; refusing to run`);


// async on purpose: the page server lives in this process and must keep answering while wait.mjs runs
function runNode(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => (stdout += d)); c.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => c.kill(), 60000);
    c.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
  });
}

const results = [];
for (const [id, p, expect, ideal] of SCENARIOS) {
  const row = { id, path: p, expect, ideal, runs: {} };
  for (const [key, skill, tag] of SKILLS) {
    // a fresh browser per (scenario, skill): every skill sees the page from its first paint
    const profile = fs.mkdtempSync(path.join(tmp, 'profile-'));
    const browser = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', `http://127.0.0.1:${WEB}${p}`], { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { if (!(await portFree())) break; await new Promise((r) => setTimeout(r, 250)); }
    const home = fs.mkdtempSync(path.join(tmp, 'home-'));
    const env = { ...process.env, USERPROFILE: home, HOME: home, JEV_ENABLED: '1', LAYA_URL: process.env.LAYA_URL || 'http://localhost:8000' };
    const t0 = Date.now();
    const r = await runNode([path.join(root, '.claude', 'skills', skill, 'scripts', 'wait.mjs'), '--expect', expect, '--timeout', String(TIMEOUT), '--cdp', `http://127.0.0.1:${PORT}`, '--json', '--log', path.join(home, 'wait.jsonl')], env);
    const lines = (s) => s.split(/\r?\n/).filter(Boolean);
    let out = null; try { out = JSON.parse(lines(r.stdout).pop()); } catch { out = { parseError: (r.stdout + r.stderr).slice(0, 200) }; }
    const polls = fs.existsSync(path.join(home, 'wait.jsonl')) ? lines(fs.readFileSync(path.join(home, 'wait.jsonl'), 'utf8')).length : 0;
    let cost = 0, calls = 0;
    const usage = path.join(home, '.ess-web-test', 'jev-usage.jsonl');
    if (key === 'jev' && fs.existsSync(usage)) for (const l of lines(fs.readFileSync(usage, 'utf8'))) { const u = JSON.parse(l); calls++; cost += u.cost || 0; }
    row.runs[key] = { status: out.status, screen: out.screen, login: out.login, expect: out.expect, waitedS: out.waited, engine: out[tag], p: out[`${tag}_p`], polls, modelCalls: key === 'jev' ? calls : undefined, costUsd: key === 'jev' ? Number(cost.toFixed(6)) : 0, wallMs: Date.now() - t0, parseError: out.parseError };
    browser.kill();
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1200));
  }
  results.push(row);
  console.log(id.padEnd(22), SKILLS.map(([k]) => `${k}: ${row.runs[k].status}/${row.runs[k].screen} ${row.runs[k].waitedS}s engine=${row.runs[k].engine}${row.runs[k].parseError ? ' ERR ' + row.runs[k].parseError : ''}`).join('  |  '));
}
server.close();
fs.writeFileSync(path.join(here, 'results', 'live-wait.json'), JSON.stringify({ at: new Date().toISOString(), timeoutS: TIMEOUT, browser: path.basename(EDGE), results }, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
