// Shared helpers for the optional Jev decision engine (TypeSafe Jev via the OpenRouter Decisions API).
// Drop-in replacement for laya-lib.mjs in the web-test-laya-* skills: same ask() contract, so every caller
// keeps working when ask() returns null (rules only). Jev is a HOSTED service: compact step/page text leaves
// the machine, so it is used only after the user said yes once (jev.local.json `enabled: true`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, jevReady, appendJsonl, JEV_MODEL } from './decision-provider.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_NAME = path.basename(SKILL_DIR);
// jev.json is committed (shared defaults); jev.local.json is per machine (gitignored) and holds the user's
// answer to "send compact text to Jev?", so one person's consent never lands in the repo.
export const CONFIG_PATH = path.join(SKILL_DIR, 'jev.json');
export const LOCAL_PATH = path.join(SKILL_DIR, 'jev.local.json');
export const STATE_DIR = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.ess-web-test');
// One line per Jev call: latency, tokens, cost. Never the key, headers or the request text.
export const USAGE_LOG = path.join(STATE_DIR, 'jev-usage.jsonl');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; } };

export function loadConfig() {
  const cfg = { enabled: null, model: JEV_MODEL, ...readJson(CONFIG_PATH), ...readJson(LOCAL_PATH) };
  if (process.env.JEV_MODEL) cfg.model = process.env.JEV_MODEL;
  // Headless / automated runs (tests, CI): JEV_ENABLED=1|0 stands in for the interactive yes/no. Never set by the skill itself.
  if (process.env.JEV_ENABLED) cfg.enabled = /^(1|true|yes)$/i.test(process.env.JEV_ENABLED);
  return cfg;
}

export function saveConfig(patch) {
  const local = { ...readJson(LOCAL_PATH), ...patch };
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(local, null, 2) + '\n');
  return loadConfig();
}

/** Jev is usable when the user consented (enabled === true) AND the OpenRouter key is in the environment. */
export function ready(cfg = loadConfig(), env = process.env) {
  return cfg.enabled === true && jevReady(env);
}

/**
 * One Jev call. questions: { name: { type: 'choice', instructions, criteria: {label: desc} } }.
 * Returns { name: { label, p, probabilities, confidence } } or null on any error (caller falls back to rules).
 * `maxLen` / `timeoutMs` are accepted for call-site compatibility with laya-lib (Jev has no max_len).
 */
export async function ask(cfg, state, questions, { timeoutMs = 10000, fetchImpl, env = process.env } = {}) {
  const r = await decide({ provider: 'jev', state, questions, jev: { model: cfg.model }, env, timeoutMs, ...(fetchImpl ? { fetchImpl } : {}) });
  appendJsonl(USAGE_LOG, { skill: SKILL_NAME, ok: r.ok, model: r.meta.model, latencyMs: r.meta.latencyMs, tokens: r.meta.usage, cost: r.meta.cost, ...(r.ok ? {} : { error: r.error }) });
  if (!r.ok) return null;
  const out = {};
  for (const [name, a] of Object.entries(r.answers)) {
    const probs = a.probabilities || {};
    const label = Object.keys(probs).sort((x, y) => probs[y] - probs[x])[0];
    out[name] = { label, p: probs[label] ?? null, probabilities: probs, ...(a.confidence !== undefined ? { confidence: a.confidence } : {}) };
  }
  return out;
}
