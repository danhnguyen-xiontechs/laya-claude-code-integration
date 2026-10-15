// Shared helpers for the optional Laya decision engine (plan 1–3).
// Laya is never required: every caller must work when ask() returns null.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// laya.json is committed (shared defaults); laya.local.json is per machine (gitignored) and holds the
// user's answer to "use Laya?" plus any url override, so one person's choice never lands in the repo.
export const CONFIG_PATH = path.join(SKILL_DIR, 'laya.json');
export const LOCAL_PATH = path.join(SKILL_DIR, 'laya.local.json');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; } };

export function loadConfig() {
  const cfg = { url: 'http://localhost:8000', enabled: null, model: 'english', ...readJson(CONFIG_PATH), ...readJson(LOCAL_PATH) };
  if (process.env.LAYA_URL) cfg.url = process.env.LAYA_URL;
  return cfg;
}

export function saveConfig(patch) {
  const local = { ...readJson(LOCAL_PATH), ...patch };
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(local, null, 2) + '\n');
  return loadConfig();
}

/** true when laya-serve answers /health within timeoutMs. */
export async function alive(url, timeoutMs = 1500) {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

/** Installed = the laya-serve exe exists (uv tool install laya). */
export function installed() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return ['laya-serve.exe', 'laya-serve'].some((f) => fs.existsSync(path.join(home, '.local', 'bin', f)));
}

const STATE_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.ess-web-test');
export const PID_PATH = path.join(STATE_DIR, 'laya-serve.pid');
export const SERVE_LOG = path.join(STATE_DIR, 'laya-serve.log');

function serveExe() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return ['laya-serve.exe', 'laya-serve'].map((f) => path.join(home, '.local', 'bin', f)).find((p) => fs.existsSync(p));
}

/**
 * Start laya-serve in the background and wait until /health answers. The pid goes to PID_PATH so
 * stop() only ever kills a server this skill started. Returns { ok, pid, waited } or { ok: false, reason }.
 */
export async function start(cfg, timeoutMs = 120000) {
  const exe = serveExe();
  if (!exe) return { ok: false, reason: 'not-installed' };
  const { spawn } = await import('node:child_process');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const log = fs.openSync(SERVE_LOG, 'a');
  const env = { ...process.env };
  if (!env.LAYA_MODELS) env.LAYA_MODELS = cfg.model || 'english'; // load only the model the scripts use: faster start, less RAM
  const port = new URL(cfg.url).port;
  if (port && !env.LAYA_PORT) env.LAYA_PORT = port;
  const child = spawn(exe, [], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env });
  child.unref();
  fs.writeFileSync(PID_PATH, String(child.pid));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await alive(cfg.url)) return { ok: true, pid: child.pid, waited: Math.round((Date.now() - t0) / 1000) };
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, reason: 'start-failed', pid: child.pid };
}

/** Stop the server start() launched (whole process tree). No-op when this skill did not start it. */
export async function stop() {
  let pid;
  try { pid = Number(fs.readFileSync(PID_PATH, 'utf8').trim()); } catch { return { stopped: false, reason: 'not-started-by-skill' }; }
  try {
    if (process.platform === 'win32') {
      const { execFileSync } = await import('node:child_process');
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else process.kill(-pid);
  } catch { /* already gone */ }
  fs.rmSync(PID_PATH, { force: true });
  return { stopped: true, pid };
}

/**
 * One Laya call. questions: { name: { type: 'choice', instructions, criteria: {label: desc} } }.
 * Returns { name: { label, p, probabilities } } or null on any error (caller falls back to rules).
 */
export async function ask(cfg, state, questions, { maxLen = 512, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(`${cfg.url.replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions, model: cfg.model || 'english', max_len: maxLen }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const { answers } = await r.json();
    const out = {};
    for (const [name, a] of Object.entries(answers || {})) {
      const probs = a.probabilities || {};
      const label = Object.keys(probs).sort((x, y) => probs[y] - probs[x])[0];
      out[name] = { label, p: probs[label] ?? null, probabilities: probs };
    }
    return out;
  } catch { return null; }
}
