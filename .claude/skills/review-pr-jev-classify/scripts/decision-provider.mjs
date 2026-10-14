// decision-provider.mjs — one typed-decision call to either Laya (local laya-serve) or TypeSafe Jev
// (OpenRouter Decisions API), for the Laya-vs-Jev A/B experiment. Zero dependencies, Node >= 18.
//
// Both providers take the same System One request: { state, questions } with choice/noul/score
// questions, and answer with typed probabilities. The caller builds ONE request and sends it to
// whichever provider is selected, so both see exactly the same input.
//
//   laya → POST <laya url>/v1/systemone            { state, questions, model, max_len }
//   jev  → POST https://openrouter.ai/api/alpha/decisions   { model, state, questions }
//          Authorization: Bearer $OPENROUTER_API_KEY   (response adds usage.input_tokens/output_tokens/cost)
//
// Provider switch (first match wins): explicit flag → env DECISION_PROVIDER → config `provider` → 'laya'.
// The key is read from the environment on each call and never logged, returned or put in an error.
import fs from 'node:fs';
import path from 'node:path';

export const PROVIDERS = ['laya', 'jev'];
export const DEFAULT_PROVIDER = 'laya';
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
 * One decisions call. `laya` = { url, model, maxLen } (used only for provider laya);
 * `jev` = { model } (used only for provider jev).
 * Returns { ok: true, answers, meta } or { ok: false, error, meta }, never throws.
 *   answers[name] = { probabilities, confidence? }   (confidence = Jev's native value; Laya has none)
 *   meta = { provider, model, latencyMs, usage: { input_tokens, output_tokens } | null, cost | null, status }
 */
export async function decide({ provider, state, questions, laya = {}, jev = {}, env = process.env, fetchImpl = fetch, timeoutMs = 10000 }) {
  const t0 = Date.now();
  const meta = { provider, model: null, latencyMs: 0, usage: null, cost: null, status: null };
  let url, headers = { 'content-type': 'application/json' }, body;
  if (provider === 'jev') {
    if (!jevReady(env)) return { ok: false, error: 'OPENROUTER_API_KEY not set', meta };
    url = JEV_URL;
    headers = { ...headers, authorization: `Bearer ${env.OPENROUTER_API_KEY}` };
    meta.model = jev.model || JEV_MODEL;
    body = { model: meta.model, state, questions };
  } else if (provider === 'laya') {
    url = `${String(laya.url || 'http://localhost:8000').replace(/\/$/, '')}/v1/systemone`;
    meta.model = laya.model || 'english';
    body = { state, questions, model: meta.model, max_len: laya.maxLen ?? 512 };
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
      // OpenRouter errors: { error: { code, message } }. Keep only the code and a short message.
      const e = json?.error;
      return { ok: false, error: `http ${meta.status ?? '?'}${e?.code ? ` ${e.code}` : ''}${e?.message ? ` ${String(e.message).slice(0, 120)}` : ''}`, meta };
    }
    if (json?.model) meta.model = json.model; // Jev returns the dated snapshot that served the call
    if (json?.usage) {
      meta.usage = { input_tokens: json.usage.input_tokens ?? null, output_tokens: json.usage.output_tokens ?? null };
      meta.cost = json.usage.cost ?? null;
    }
    const answers = {};
    for (const [name, a] of Object.entries(json?.answers || {})) {
      if (!a || typeof a !== 'object') continue;
      const probabilities = {};
      for (const [k, v] of Object.entries(a.probabilities || {})) if (typeof v === 'number') probabilities[k] = r4(v);
      answers[name] = { probabilities, ...(typeof a.confidence === 'number' ? { confidence: r4(a.confidence) } : {}), ...(typeof a.noul === 'number' ? { noul: r4(a.noul) } : {}) };
    }
    return { ok: true, answers, meta };
  } catch (err) {
    meta.latencyMs = Date.now() - t0;
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timeout' : String(err?.message ?? err).split('\n')[0].slice(0, 120), meta };
  }
}

/** Top label and top probability of a probabilities map, plus the runner-up probability. */
export function top(probabilities = {}) {
  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  return { label: sorted[0]?.[0] ?? null, p: sorted[0]?.[1] ?? null, second: sorted[1]?.[1] ?? 0 };
}

/** Appends one JSON line (best-effort). Callers pass only decision data, never the key or headers. */
export function appendJsonl(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* best-effort */ }
}
