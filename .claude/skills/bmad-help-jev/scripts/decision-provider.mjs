// decision-provider.mjs — one typed-decision (System One) call to TypeSafe Jev, local Laya or local Kev.
// Zero dependencies, Node >= 18. Shared copy: bmad-help-jev and bmad-code-review-jev carry the same file.
//
// All three take the same request { state, questions } with choice / noul / score questions:
//   jev  → POST https://openrouter.ai/api/alpha/decisions   { model, state, questions }
//          Authorization: Bearer $OPENROUTER_API_KEY   (response adds usage.cost)
//   laya → POST <laya.url>/v1/systemone                     { state, questions, model, max_len }
//   kev  → POST <kev.url>/v1/systemone                      { model, state, questions }   (TypeSafe-compatible)
//
// Provider switch (first match wins): --provider flag → env DECISION_PROVIDER → config `provider` → 'jev'.
// The key is read from the environment on each call and never logged, returned or put in an error.
import fs from 'node:fs';
import path from 'node:path';

export const PROVIDERS = ['jev', 'laya', 'kev'];
export const DEFAULT_PROVIDER = 'jev';
export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';

export function resolveProvider({ flag, env = process.env, cfg = {} } = {}) {
  const p = String(flag ?? env.DECISION_PROVIDER ?? cfg.provider ?? DEFAULT_PROVIDER).trim().toLowerCase();
  if (!PROVIDERS.includes(p)) throw new Error(`provider must be one of ${PROVIDERS.join(', ')} (got "${p}")`);
  return p;
}

/** Jev is usable when the OpenRouter key is set (no network check: it is a hosted service). */
export const jevReady = (env = process.env) => Boolean(env.OPENROUTER_API_KEY);

const r4 = (v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v);

/**
 * One decisions call. cfg = { jevModel, laya: { url, model, maxLen }, kev: { url, model } }.
 * Returns { ok: true, answers, meta } or { ok: false, error, meta }; never throws.
 *   answers[name] = { noul? , choice?, probabilities, confidence? }
 *   meta = { provider, model, latencyMs, usage, cost, status }
 */
export async function decide({ provider, state, questions, cfg = {}, env = process.env, fetchImpl = fetch, timeoutMs = 30000 }) {
  const t0 = Date.now();
  const meta = { provider, model: null, latencyMs: 0, usage: null, cost: null, status: null };
  let url, headers = { 'content-type': 'application/json' }, body;
  if (provider === 'jev') {
    if (!jevReady(env)) return { ok: false, error: 'OPENROUTER_API_KEY not set', meta };
    url = JEV_URL;
    headers = { ...headers, authorization: `Bearer ${env.OPENROUTER_API_KEY}` };
    meta.model = cfg.jevModel || JEV_MODEL;
    body = { model: meta.model, state, questions };
  } else if (provider === 'laya') {
    const l = cfg.laya || {};
    url = `${String(l.url || 'http://localhost:8000').replace(/\/$/, '')}/v1/systemone`;
    meta.model = l.model || 'english';
    body = { state, questions, model: meta.model, max_len: l.maxLen ?? 1024 };
  } else if (provider === 'kev') {
    const k = cfg.kev || {};
    url = `${String(k.url || 'http://localhost:8001').replace(/\/$/, '')}/v1/systemone`;
    meta.model = k.model || 'kev-latest';
    body = { model: meta.model, state, questions };
  } else {
    return { ok: false, error: `unknown provider "${provider}"`, meta };
  }
  try {
    const r = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    meta.status = r.status ?? (r.ok ? 200 : null);
    let json = null;
    try { json = await r.json(); } catch { /* non-JSON body */ }
    meta.latencyMs = Date.now() - t0;
    if (!r.ok) {
      const e = json?.error;
      const msg = typeof e === 'string' ? e : e?.message;
      return { ok: false, error: `http ${meta.status ?? '?'}${e?.code ? ` ${e.code}` : ''}${msg ? ` ${String(msg).slice(0, 120)}` : ''}`, meta };
    }
    if (json?.model) meta.model = json.model;
    if (json?.usage) {
      meta.usage = { input_tokens: json.usage.input_tokens ?? null, output_tokens: json.usage.output_tokens ?? null };
      meta.cost = json.usage.cost ?? null;
    }
    const answers = {};
    for (const [name, a] of Object.entries(json?.answers || {})) {
      if (!a || typeof a !== 'object') continue;
      const probabilities = {};
      for (const [k, v] of Object.entries(a.probabilities || {})) if (typeof v === 'number') probabilities[k] = r4(v);
      answers[name] = {
        probabilities,
        ...(typeof a.choice === 'string' ? { choice: a.choice } : {}),
        ...(typeof a.confidence === 'number' ? { confidence: r4(a.confidence) } : {}),
        ...(typeof a.noul === 'number' ? { noul: r4(a.noul) } : {}),
      };
    }
    return { ok: true, answers, meta };
  } catch (err) {
    meta.latencyMs = Date.now() - t0;
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timeout' : String(err?.message ?? err).split('\n')[0].slice(0, 120), meta };
  }
}

/** P(yes) of a noul answer, whichever shape the provider used; null when absent. */
export function pYes(answer) {
  if (!answer) return null;
  if (typeof answer.noul === 'number') return answer.noul;
  const p = answer.probabilities || {};
  for (const k of ['yes', 'Yes', 'true', 'True']) if (typeof p[k] === 'number') return p[k];
  return null;
}

/** Labels of a probabilities map, highest first: [{ label, p }]. */
export function ranked(probabilities = {}) {
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1]).map(([label, p]) => ({ label, p }));
}

/** Runs async tasks with at most `limit` in flight; keeps input order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/** Reads <skillDir>/jev.json, then jev.local.json (gitignored) over it. */
export function loadConfig(skillDir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(skillDir, f), 'utf8')); } catch { return {}; } };
  const base = read('jev.json'), local = read('jev.local.json');
  return { ...base, ...local, laya: { ...base.laya, ...local.laya }, kev: { ...base.kev, ...local.kev }, thresholds: { ...base.thresholds, ...local.thresholds } };
}

/** Appends one JSON line (best-effort). Callers pass only decision data, never the key or headers. */
export function appendJsonl(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* best-effort */ }
}

/** Parses `--name value` / `--flag` arguments into an object. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) out[key] = true;
    else { out[key] = val; i++; }
  }
  return out;
}
