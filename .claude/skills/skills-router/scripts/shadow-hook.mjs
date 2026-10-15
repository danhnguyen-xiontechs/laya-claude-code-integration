#!/usr/bin/env node
// shadow-hook.mjs — UserPromptSubmit hook, shadow mode: routes each prompt locally and logs what the
// router would suggest. It prints nothing (the prompt is never changed), never blocks and always exits 0.
//
// stdin: the hook payload { session_id, transcript_path, cwd, prompt, ... }
// log:   ~/.skills-router/shadow.jsonl (override with SKILLS_ROUTER_SHADOW_LOG)
// provider: `none` (BM25, ~10 ms) by default; SKILLS_ROUTER_SHADOW_PROVIDER=laya uses laya-serve when
//           its /health answers within 300 ms, else falls back to none. `jev` is never used here.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_DIR } from './catalog.mjs';
import { loadConfig } from './decision-provider.mjs';
import { route } from './route.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHADOW_LOG = path.join(STATE_DIR, 'shadow.jsonl');
export const LOCAL_PROVIDERS = ['none', 'laya', 'kev'];

/** Whitespace-normalized prompt hash: the join key with the transcript. */
export const promptHash = (text) => crypto.createHash('sha1').update(String(text || '').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);

/** Local provider to use: requested one if it is local and its server is up, else none. */
export async function pickLocalProvider({ env = process.env, cfg = {}, fetchImpl = fetch } = {}) {
  const want = String(env.SKILLS_ROUTER_SHADOW_PROVIDER || 'none').toLowerCase();
  if (!LOCAL_PROVIDERS.includes(want) || want === 'none') return 'none';
  const url = String(cfg[want]?.url || (want === 'laya' ? 'http://localhost:8000' : 'http://localhost:8001')).replace(/\/$/, '');
  try {
    const r = await fetchImpl(`${url}/health`, { signal: AbortSignal.timeout(300) });
    return r.ok ? want : 'none';
  } catch { return 'none'; }
}

/** One shadow log line from the hook payload and a route result. */
export function shadowEntry(payload, r, provider) {
  const prompt = String(payload.prompt || '');
  return {
    t: new Date().toISOString(),
    session: payload.session_id || null,
    transcript: payload.transcript_path || null,
    cwd: payload.cwd || null,
    hash: promptHash(prompt),
    prompt: prompt.slice(0, 300),
    suggestion: r.suggestion?.id ?? null,
    confidence: r.suggestion?.confidence ?? null,
    abstain: r.abstain,
    reasons: r.abstainReasons,
    alternatives: (r.alternatives || []).map((a) => a.id),
    provider,
    latencyMs: r.latencyMs,
    error: r.error ?? null,
  };
}

/** The whole hook. Never throws; returns the entry written (or null). */
export async function runHook({ stdin, env = process.env, fetchImpl, logFile = env.SKILLS_ROUTER_SHADOW_LOG || SHADOW_LOG, catalog } = {}) {
  try {
    const payload = JSON.parse(stdin || '{}');
    if (!String(payload.prompt || '').trim()) return null;
    const cfg = loadConfig(SKILL_DIR);
    const provider = await pickLocalProvider({ env, cfg, fetchImpl });
    const r = await route({ query: payload.prompt, root: payload.cwd || process.cwd(), provider, cfg, fetchImpl, catalog, env: {} });
    const entry = shadowEntry(payload, r, provider);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
    return entry;
  } catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let buf = '';
  const done = () => runHook({ stdin: buf }).finally(() => process.exit(0));
  const guard = setTimeout(() => process.exit(0), 20000);
  guard.unref();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { buf += d; });
  process.stdin.on('end', done);
  process.stdin.on('error', () => process.exit(0));
}
