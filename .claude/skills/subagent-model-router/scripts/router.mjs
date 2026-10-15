// router.mjs — picks the model tier (haiku | sonnet | opus) for one subagent before it is spawned.
// Zero dependencies, Node >= 18.
//
// Two independent signals:
//   rules — local features of the subagent prompt and type (verbs, files, ACs, tests, length);
//   jev   — a typed decision (one choice over the tiers + three nouls) from TypeSafe Jev or Laya.
// Combined by two policies instead of probability thresholds (Jev is over-confident, Laya is flat):
//   agreement gating  — the final tier is max(rule, provider): a cheaper tier only when both agree;
//   self-consistency  — ask k times with the option order rotated; if the k top labels are not all
//                       the same, take the highest of them.
// Policies (pick with `policy`): rules | jev | gate | sc | gate+sc (default when a provider is set).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decide, top, appendJsonl } from './decision-provider.mjs';

export const TIERS = ['haiku', 'sonnet', 'opus'];
export const MODES = ['off', 'shadow', 'apply'];
export const ROUTER_PROVIDERS = ['none', 'jev', 'laya'];
export const POLICIES = ['rules', 'jev', 'gate', 'sc', 'gate+sc'];
export const DEFAULT_LOG = path.join(os.homedir(), '.subagent-model-router', 'log.jsonl');

const rank = (t) => TIERS.indexOf(t);
export const maxTier = (...ts) => ts.filter((t) => rank(t) >= 0).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'haiku');
/** Next tier up for the escalate-on-failure cascade, or null at the top. */
export const nextTier = (t) => TIERS[rank(t) + 1] ?? null;

// ---------------------------------------------------------------------------
// Config: defaults ← config.json next to SKILL.md ← env ← explicit options
// ---------------------------------------------------------------------------

export const DEFAULTS = { mode: 'shadow', provider: 'none', policy: null, k: 3, timeoutMs: 8000, log: DEFAULT_LOG, laya: {}, jev: {} };

export function loadConfig({ env = process.env, file, overrides = {} } = {}) {
  let cfg = {};
  const f = file ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* optional */ }
  const fromEnv = {
    mode: env.SUBAGENT_ROUTER_MODE,
    provider: env.SUBAGENT_ROUTER_PROVIDER,
    policy: env.SUBAGENT_ROUTER_POLICY,
    k: env.SUBAGENT_ROUTER_K ? Number(env.SUBAGENT_ROUTER_K) : undefined,
    log: env.SUBAGENT_ROUTER_LOG,
  };
  const out = { ...DEFAULTS };
  for (const src of [cfg, fromEnv, overrides]) for (const [k, v] of Object.entries(src)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  out.mode = String(out.mode).toLowerCase();
  out.provider = String(out.provider).toLowerCase();
  if (!MODES.includes(out.mode)) throw new Error(`mode must be one of ${MODES.join(', ')} (got "${out.mode}")`);
  if (!ROUTER_PROVIDERS.includes(out.provider)) throw new Error(`provider must be one of ${ROUTER_PROVIDERS.join(', ')} (got "${out.provider}")`);
  out.policy = out.policy ?? (out.provider === 'none' ? 'rules' : 'gate+sc');
  if (!POLICIES.includes(out.policy)) throw new Error(`policy must be one of ${POLICIES.join(', ')} (got "${out.policy}")`);
  if (out.provider === 'none' && out.policy !== 'rules') out.policy = 'rules';
  out.k = Math.max(1, Math.min(9, Math.floor(Number(out.k) || 1)));
  return out;
}

// ---------------------------------------------------------------------------
// Rules: local features → tier
// ---------------------------------------------------------------------------

// Read-only / lookup subagent types. Plan designs, so it never starts below sonnet.
const CHEAP_TYPES = /^(explore|claude-code-guide|statusline-setup|search|.*-?(explore|search|lookup|finder)-?.*)$/i;
const DESIGN_TYPES = /^(plan|architect|.*-?(plan|architect|design)-?.*)$/i;

const HARD = [
  // the verb ("Design a…", "re-architect the…"), not the noun ("the design you must build")
  /(^|[.:;!?]\s+|\n\s*(?:[-*]\s*)?|\b(?:to|and|then|please)\s+)(design|architect|re-?architect)\s+(a|an|the|how|our|its|this|new)\b/i,
  /\brefactor\w*\b[^.\n]{0,60}\b(across|all|every|multiple|modules?|packages?|services?|codebase)\b/i,
  /\bmigrat(e|ion|ing)\b/i,
  /\b(debug|diagnose)\b[^.\n]{0,60}\b(fail\w*|flaky|crash\w*|hang\w*|race|deadlock|leak|intermittent)\b/i,
  /\b(find the root[- ]cause|root[- ]cause (it|this|the)|investigate why)\b/i,
  // Topic words alone (auth, security, performance) appear in plain reviews too, so they count only
  // next to a doing-verb.
  /\b(fix|find|debug|implement|make|ensure)\b[^.\n]{0,40}\b(race condition|deadlock|concurren\w*|thread[- ]safe\w*|memory leak|vulnerab\w*|performance regression)\b/i,
  /\b(trade-?offs?|alternatives|propose (a|an) (plan|approach|design))\b/i,
];
const MEDIUM = [
  /\b(implement|fix|add|update|change|modify|write|create|rename|refactor|extract|convert|port|handle|support|validate)\b/i,
  /\b(test|tests|unit test|spec)\b/i,
];
const LIGHT = [
  /\b(find|search|locate|list|grep|look ?up|where is|which files?|count|read|summari[sz]e|show|check whether|report (back|the))\b/i,
];
const FILE_RE = /(?:[\w.-]+[\\/])*[\w.-]+\.(?:m?[jt]sx?|py|cs|java|go|rs|rb|php|kt|swift|c|cc|cpp|h|hpp|json|ya?ml|toml|md|sql|html|css|scss|sh|ps1)\b/gi;
// Explicit acceptance criteria only (AC1…, Given/Scenario); plain bullets are context, not ACs.
const AC_RE = /^\s*(?:[-*]\s*)?(?:AC\s*-?\d+\b|Given\b|Scenario\b)/gim;
const CHECK_RE = /\b(run (the )?tests?|pytest|npm (run )?test|node --test|go test|cargo test|dotnet test|jest|vitest|acceptance (criteria|check|test)s?|must pass|expected output|exit code 0)\b/i;
const READ_ONLY_RE = /\b(do not (edit|modify|change|write)|read[- ]only|don'?t (edit|modify|change)|no (edits|changes))\b/gi;
// A "do not change …" clause makes a task read-only only when nothing else asks for an edit:
// "Ignore those 17 tests and do not change them" in a coding brief guards other files.
function isReadOnly(text) {
  if (!text.match(READ_ONLY_RE)) return false;
  return !MEDIUM[0].test(text.replace(READ_ONLY_RE, ' '));
}

export function ruleFeatures(task = '', type = '') {
  const text = String(task);
  const files = new Set((text.match(FILE_RE) || []).map((f) => f.toLowerCase()));
  const acs = (text.match(AC_RE) || []).length;
  return {
    type: String(type || ''),
    cheapType: CHEAP_TYPES.test(String(type || '')),
    designType: DESIGN_TYPES.test(String(type || '')),
    hard: HARD.filter((r) => r.test(text)).length,
    medium: MEDIUM.filter((r) => r.test(text)).length,
    light: LIGHT.filter((r) => r.test(text)).length,
    files: files.size,
    acs,
    hasCheck: CHECK_RE.test(text),
    readOnly: isReadOnly(text),
    chars: text.length,
  };
}

/**
 * Points → tier. Hard verbs dominate; many files / ACs / a long prompt add complexity; a read-only
 * lookup or a cheap subagent type subtracts. An automatic check (tests/acceptance) lowers the risk
 * of trying a cheaper tier, because the cascade will catch a failure.
 */
export function ruleTier(f) {
  let s = 1; // sonnet by default
  const why = [];
  if (f.hard) { s += 1 + Math.min(f.hard - 1, 1); why.push(`hard:${f.hard}`); }
  if (!f.hard && f.light && (!f.medium || f.readOnly)) { s -= 1; why.push('lookup'); }
  if (f.cheapType) { s -= 1; why.push('cheap-type'); }
  if (f.designType) { s += 1; why.push('design-type'); }
  // Many files, many ACs and a long prompt go together in orchestrator briefs: at most +1 between them.
  const size = [f.files >= 6 && `files:${f.files}`, f.acs >= 4 && `acs:${f.acs}`, f.chars > 4000 && 'long'].filter(Boolean);
  if (size.length) { s += 1; why.push(...size); }
  if (f.hasCheck && !f.hard && f.files <= 2) { s -= 1; why.push('checked'); }
  if (f.designType) s = Math.max(s, 1);
  if (why.includes('lookup') && !f.hard) s = Math.min(s, 1); // a big lookup is still a lookup
  const tier = TIERS[Math.max(0, Math.min(2, s))];
  return { tier, score: s, why };
}

// ---------------------------------------------------------------------------
// Provider (Jev / Laya): one choice + three nouls
// ---------------------------------------------------------------------------

export const TIER_CRITERIA = {
  haiku: 'Mechanical or read-only work with a clear, narrow scope: searching, listing, reading and summarising code, a one-line or single-function change spelled out in the task, or running a given command. Little judgement needed.',
  sonnet: 'Ordinary, well-specified coding in one area: implementing or fixing a function or a few related files, writing tests for given behaviour, a local refactor. Needs some reasoning but the approach is clear.',
  opus: 'Hard or open-ended work: design or architecture decisions, refactors or migrations across many modules, debugging a failure with an unknown cause, concurrency, security or performance work, or anything where a subtle mistake is costly.',
};
export const NOULS = {
  multi_file_design: 'Doing this task well needs reasoning across several files or making design decisions.',
  mechanical: 'This task is mechanical or fully specified: the steps or the exact change are given.',
  costly_failure: 'A wrong or subtly broken result from this task would be costly or hard to notice.',
};

/** k orderings of the tiers: rotations first (each tier in each position), then reversals. */
export function orderings(k) {
  const rots = TIERS.map((_, i) => [...TIERS.slice(i), ...TIERS.slice(0, i)]);
  const all = [...rots, ...rots.map((r) => [...r].reverse())];
  return Array.from({ length: k }, (_, i) => all[i % all.length]);
}

export function buildRequest(task, type, order = TIERS) {
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)} …[truncated]` : s);
  const state = { text: `Subagent type: ${type || 'general-purpose'}\nSubagent task:\n${clip(String(task), 6000)}` };
  const criteria = Object.fromEntries(order.map((t) => [t, TIER_CRITERIA[t]]));
  const questions = {
    tier: { type: 'choice', instructions: 'Which is the cheapest model tier that will reliably complete this subagent task?', criteria },
    ...Object.fromEntries(Object.entries(NOULS).map(([k, v]) => [k, { type: 'noul', instructions: v }])),
  };
  return { state, questions };
}

/** One provider call → { tier, p, probabilities, nouls } or { error }. */
export async function askOnce({ task, type, order, cfg, decideImpl = decide, env = process.env }) {
  const { state, questions } = buildRequest(task, type, order);
  const r = await decideImpl({ provider: cfg.provider, state, questions, laya: cfg.laya, jev: cfg.jev, env, timeoutMs: cfg.timeoutMs });
  if (!r.ok) return { error: r.error, latencyMs: r.meta?.latencyMs ?? null };
  const probs = r.answers?.tier?.probabilities ?? {};
  const t = top(probs);
  if (!TIERS.includes(t.label)) return { error: 'no tier answer', latencyMs: r.meta?.latencyMs ?? null };
  const nouls = Object.fromEntries(Object.keys(NOULS).map((k) => [k, r.answers?.[k]?.noul ?? null]));
  return { tier: t.label, p: t.p, probabilities: probs, nouls, latencyMs: r.meta?.latencyMs ?? null, cost: r.meta?.cost ?? null };
}

/** Self-consistency over k answers: stable → the shared label; unstable → the highest label. */
export function consistency(answers) {
  const ok = answers.filter((a) => a && !a.error);
  if (!ok.length) return { tier: null, stable: false, votes: {} };
  const votes = {};
  for (const a of ok) votes[a.tier] = (votes[a.tier] || 0) + 1;
  const stable = Object.keys(votes).length === 1;
  return { tier: stable ? ok[0].tier : maxTier(...ok.map((a) => a.tier)), stable, votes, n: ok.length };
}

/**
 * Combine rule and provider answers under a policy. Pure (used by route() and by offline scoring).
 *   rules   → rule tier
 *   jev     → first provider answer
 *   sc      → self-consistency tier
 *   gate    → max(rule, first provider answer)
 *   gate+sc → max(rule, self-consistency tier)
 * Provider unavailable → null (the caller keeps its default model).
 */
export function combine(policy, ruleT, answers = []) {
  if (policy === 'rules') return ruleT;
  const first = answers.find((a) => a && !a.error);
  if (!first) return null;
  if (policy === 'jev') return first.tier;
  if (policy === 'gate') return maxTier(ruleT, first.tier);
  const sc = consistency(answers).tier;
  if (policy === 'sc') return sc;
  return maxTier(ruleT, sc);
}

/**
 * Route one subagent. Returns the decision record (also logged unless log === false):
 *   { tier | null, policy, mode, provider, rule, answers, consistency, latencyMs, ... }
 * mode off → { tier: null } without any provider call.
 */
export async function route({ task, type = '', cfg = loadConfig(), decideImpl, env = process.env, log = true, source = 'cli', extra = {} } = {}) {
  const t0 = Date.now();
  const rec = { source, mode: cfg.mode, provider: cfg.provider, policy: cfg.policy, k: cfg.k, type, chars: String(task ?? '').length, taskHash: crypto.createHash('sha1').update(String(task ?? '')).digest('hex').slice(0, 12) };
  if (cfg.mode === 'off') return { ...rec, tier: null, reason: 'mode off' };
  const features = ruleFeatures(task, type);
  const rule = ruleTier(features);
  let answers = [];
  if (cfg.provider !== 'none') {
    const n = cfg.policy === 'jev' || cfg.policy === 'gate' ? 1 : cfg.k;
    answers = await Promise.all(orderings(n).map((order) => askOnce({ task, type, order, cfg, decideImpl, env })));
  }
  const tier = combine(cfg.policy, rule.tier, answers);
  const out = {
    ...rec,
    tier,
    reason: tier ? undefined : 'provider unavailable: keep the default model',
    rule: { tier: rule.tier, score: rule.score, why: rule.why },
    features,
    answers: answers.map((a) => (a.error ? { error: a.error } : { tier: a.tier, p: a.p, nouls: a.nouls, latencyMs: a.latencyMs })),
    consistency: answers.length ? consistency(answers) : undefined,
    latencyMs: Date.now() - t0,
    ...extra,
  };
  if (log && cfg.log) appendJsonl(cfg.log, out);
  return out;
}
