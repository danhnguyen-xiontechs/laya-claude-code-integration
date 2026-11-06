// task-router.mjs — picks haiku or sonnet for one Implement/Fix task at dispatch (not per tool call).
// Self-contained (Node >= 18, no imports outside node:): xt-factory ships a byte copy at
// plugins/xt-factory/skills/factory-run/scripts/task-router.mjs; edit here, then copy.
//
// Hybrid: local rules decide the clear cases at no cost; TypeSafe Jev is asked only when the rules
// are unsure, with four narrow nouls (fully_specified, cross_file, open_design, unknown_cause) whose
// answers code turns into a tier. Goal: total time and cost of the task, retries included, so a task
// likely to fail on haiku starts on sonnet (no wasted rung), and haiku is chosen only for low-risk work
// with an executable check. Never opus; never below `floor`; any provider error keeps `current`.
// Decisions are cached per key (run + task + phase + worker) and the hash of what was routed, so a
// retry or a resumed run makes no new provider call unless the task text or facts changed.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const TIERS = ['haiku', 'sonnet'];
export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';
export const DEFAULTS = Object.freeze({ provider: 'jev', timeoutMs: 3000, threshold: 0.6, maxTextChars: 6000 });

const RISKY = /\b(migrat\w*|schema change|security|auth\w*|permission\w*|concurren\w*|race condition|deadlock|payment\w*|encrypt\w*|breaking change|public api|contract change)\b/i;

export const NOULS = {
  fully_specified: {
    instructions: 'Does the task spell out the exact change: which files or functions, and what they must do?',
    criteria: { true: 'The files or symbols and the behaviour are named; the builder mostly carries out the given steps.', false: 'The builder must work out where the change goes or what exactly it should be.' },
  },
  cross_file: {
    instructions: 'Does doing the task well need understanding how several files, modules or services fit together, beyond the files it names?',
    criteria: { true: 'Shared contracts, call chains across modules, data flowing through several layers, a change that ripples to other code.', false: 'The work stays inside the named files or one small area.' },
  },
  open_design: {
    instructions: 'Must the builder make a design decision the task leaves open: an approach, an API or data shape, a trade-off?',
    criteria: { true: 'Choosing between approaches, defining a new interface, schema or structure.', false: 'The approach is given or obvious; only the implementation remains.' },
  },
  unknown_cause: {
    instructions: 'Is the task to find and fix a failure whose cause is not known yet?',
    criteria: { true: 'A failing or wrong behaviour to diagnose, with no cause named in the task.', false: 'No diagnosis needed, or the task names the cause.' },
  },
};

const rank = (t) => TIERS.indexOf(t);
const clampTier = (t, floor) => (rank(t) < rank(floor) ? floor : t);

/**
 * Rules only. facts: { kind, files (count), hasCheck (an executable check: a cli done-check or test
 * command), haikuAllowed (the caller's own haiku rule), fix (a fix task), chars }. Returns
 * { tier, reason } when the rules are sure, or { tier: null, reason } when Jev should be asked.
 */
export function ruleRoute(text, facts) {
  const f = facts ?? {};
  if (!f.hasCheck) return { tier: 'sonnet', reason: 'no executable check' };
  if (f.haikuAllowed === false) return { tier: 'sonnet', reason: 'haiku not allowed for this task' };
  if (RISKY.test(String(text ?? ''))) return { tier: 'sonnet', reason: 'risky area' };
  if ((f.files ?? 0) >= 4) return { tier: 'sonnet', reason: `files:${f.files}` };
  if (['docs', 'tests'].includes(f.kind) && (f.files ?? 0) <= 2) return { tier: 'haiku', reason: `${f.kind} task` };
  return { tier: null, reason: 'ambiguous' };
}

/** Nouls → tier. Any hard signal → sonnet; a fully specified one-area change → haiku; unsure → null. */
export function signalTier(n, t = DEFAULTS.threshold) {
  if (!n || Object.keys(NOULS).some((k) => typeof n[k] !== 'number')) return null;
  if (n.cross_file >= t || n.open_design >= t || n.unknown_cause >= t) return 'sonnet';
  if (n.fully_specified >= t && n.cross_file <= 1 - t && n.open_design <= 1 - t && n.unknown_cause <= 1 - t) return 'haiku';
  return null;
}

export function routeKey({ runId, taskId, phase, worker = 'main' }) {
  return [runId, taskId, phase, worker].map((x) => String(x ?? '')).join('|');
}

export const routeHash = (text, facts) => crypto.createHash('sha1').update(JSON.stringify([String(text ?? ''), facts ?? {}])).digest('hex').slice(0, 12);

function readCache(file) {
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function writeCache(file, key, rec) {
  if (!file) return;
  try { const all = readCache(file); all[key] = rec; fs.writeFileSync(file, JSON.stringify(all, null, 2)); } catch { /* a cache write never fails a route */ }
}

/** One Jev call with the four nouls: { ok, nouls, ms, cost } or { ok: false, error, ms }. */
export async function askJev({ text, facts, env = process.env, fetchImpl = fetch, timeoutMs = DEFAULTS.timeoutMs, maxTextChars = DEFAULTS.maxTextChars }) {
  const t0 = Date.now();
  const key = env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, error: 'no_key', ms: 0 };
  const s = String(text ?? '');
  const body = {
    model: JEV_MODEL,
    state: { task: s.length > maxTextChars ? `${s.slice(0, maxTextChars)} …[truncated]` : s, facts },
    questions: Object.fromEntries(Object.entries(NOULS).map(([k, v]) => [k, { type: 'noul', ...v }])),
  };
  try {
    const r = await fetchImpl(JEV_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const json = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, error: `http_${r.status}`, ms: Date.now() - t0 };
    const nouls = Object.fromEntries(Object.keys(NOULS).map((k) => [k, json?.answers?.[k]?.noul]));
    if (Object.values(nouls).some((v) => typeof v !== 'number')) return { ok: false, error: 'invalid_answer', ms: Date.now() - t0 };
    return { ok: true, nouls, ms: Date.now() - t0, cost: typeof json?.usage?.cost === 'number' ? json.usage.cost : null };
  } catch (e) {
    return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : 'network', ms: Date.now() - t0 };
  }
}

/**
 * Routes one task. Never throws. Returns { tier, current, source: 'rule'|'jev'|'cache'|'fallback',
 * reason, routingMs, providerMs, cost, nouls?, key, hash }. `current` is the existing assignment and the
 * answer on any failure; `floor` is the lowest tier allowed (sonnet keeps a sonnet-only task there).
 */
export async function routeTask({ runId, taskId, phase = 'implement', worker = 'main', text = '', facts = {}, current = 'sonnet', floor = 'haiku', provider = DEFAULTS.provider, threshold = DEFAULTS.threshold, timeoutMs = DEFAULTS.timeoutMs, cacheFile = null, env = process.env, fetchImpl = fetch, ask = askJev }) {
  const t0 = Date.now();
  const cur = TIERS.includes(current) ? current : 'sonnet';
  const low = TIERS.includes(floor) ? floor : 'haiku';
  const key = routeKey({ runId, taskId, phase, worker });
  const hash = routeHash(text, facts);
  const done = (tier, source, reason, extra = {}) => ({ tier: clampTier(tier, low), current: cur, source, reason, routingMs: Date.now() - t0, providerMs: 0, cost: null, key, hash, ...extra });
  try {
    const hit = readCache(cacheFile)[key];
    if (hit && hit.hash === hash && TIERS.includes(hit.tier)) return { ...hit, source: 'cache', cachedSource: hit.source, routingMs: Date.now() - t0, providerMs: 0, cost: null };
    const rule = ruleRoute(text, facts);
    let out;
    if (rule.tier) out = done(rule.tier, 'rule', rule.reason);
    else if (provider !== 'jev') out = done(cur, 'fallback', 'ambiguous, no provider');
    else {
      const a = await ask({ text, facts, env, fetchImpl, timeoutMs });
      if (!a.ok) out = done(cur, 'fallback', `provider ${a.error}`, { providerMs: a.ms ?? 0 });
      else {
        const s = signalTier(a.nouls, threshold);
        out = done(s ?? cur, 'jev', s ? `signals → ${s}` : 'signals unsure → current', { providerMs: a.ms, cost: a.cost, nouls: a.nouls });
      }
    }
    // Only real decisions are cached: a provider failure is asked again on the next dispatch.
    if (out.source !== 'fallback' || out.reason.startsWith('ambiguous')) writeCache(cacheFile, key, { tier: out.tier, source: out.source, reason: out.reason, hash, nouls: out.nouls ?? null, at: new Date().toISOString() });
    return out;
  } catch (e) {
    return done(cur, 'fallback', `router error: ${String(e?.message ?? e).slice(0, 80)}`);
  }
}
