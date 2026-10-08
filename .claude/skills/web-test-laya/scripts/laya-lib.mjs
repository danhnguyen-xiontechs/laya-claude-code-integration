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

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };

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
