#!/usr/bin/env node
// route.mjs — suggests which installed skill / command / subagent / BMad workflow fits a request, or
// says none is needed. A hint layer: Claude makes the final call.
//
//   node route.mjs --query "<request>" [--project-root <dir>] [--provider jev|laya|kev|none] [--k 8] [--json]
//
// Stage 1: BM25 shortlist (top k ≤ 8) over name + description + head of every catalog entry.
// Stage 2: one decision request: Choice over the shortlist + `none`, a gate Noul ("does this need a
//          skill at all?") and a fit Noul for each of the top 3. `--provider none` stops after stage 1.
// Output (stdout, JSON): { suggestion, alternatives, gate, abstain, overlaps, ... }. Never fails: on
// any error it prints { suggestion: null, error } and exits 0.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, STATE_DIR, bareName } from './catalog.mjs';
import { repoContext } from './context.mjs';
import { appendJsonl, decide, loadConfig, parseArgs, pYes, resolveProvider } from './decision-provider.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOG_FILE = path.join(STATE_DIR, 'log.jsonl');
export const MAX_K = 8;
const SELF = 'skills-router'; // never suggest the router itself
export const FIT_TOP = 3;
export const DEFAULT_THRESHOLDS = { gateMin: 0.3, fitMin: 0.3, choiceMin: 0, noneAbstain: true, bm25Min: 3, maxAlternatives: 2 };

// ---------------------------------------------------------------- text

const STOP = new Set(('a an and are as at be by can do does for from has have how i if in into is it its me my of on or our '
  + 'so that the their them then there these this those to us use used uses using was we what when where which who why will '
  + 'with you your should would could please want need help make get one any all also not no only than via skill skills').split(' '));

/** Crude English stemmer: enough to match "reviews"/"reviewing"/"reviewed" to "review". */
export function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && /(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length >= 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lower-cased, stop-word-free, stemmed tokens (any script: Vietnamese words survive as-is). */
export function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(stem);
}

const nameTokens = (name) => tokenize(String(name).replace(/[:_-]+/g, ' '));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** Description split into clauses (sentences, dash and bracket pieces). */
export function clauses(text) {
  return String(text || '').split(/(?<=[.;!?])\s+|\s+[—–]\s+|\s*\(\s*|\s*\)\s*/).map((s) => s.trim().replace(/[.;]$/, '')).filter((s) => s.length > 3);
}

/** The description clause that shares most stems with the query (first clause on a tie or no match). */
export function whyPhrase(entry, query) {
  const q = new Set(tokenize(query));
  let best = null, bestN = -1;
  for (const c of clauses(entry.description)) {
    const n = new Set(tokenize(c).filter((t) => q.has(t))).size;
    if (n > bestN) { best = c; bestN = n; }
  }
  return clip(best || entry.description || entry.name, 160);
}

// ---------------------------------------------------------------- stage 1: BM25

/** BM25 index over name (×3), description (×2) and head (×1). */
export function buildIndex(entries) {
  const docs = entries.map((e) => {
    const toks = [...nameTokens(e.name), ...nameTokens(e.name), ...nameTokens(e.name), ...tokenize(e.description), ...tokenize(e.description), ...tokenize(e.head)];
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { entry: e, tf, len: toks.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  return { docs, df, avg, n: docs.length };
}

const DEPRECATED = /\bdeprecated\b|\bwill be removed\b/i;

/** BM25 scores, highest first. Entries whose description says they are deprecated score half. */
export function bm25(index, query, { k1 = 1.2, b = 0.75 } = {}) {
  const q = [...new Set(tokenize(query))];
  return index.docs.map((d) => {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const df = index.df.get(t);
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avg)));
    }
    if (DEPRECATED.test(d.entry.description)) s *= 0.5;
    return { entry: d.entry, score: Number(s.toFixed(4)) };
  }).sort((x, y) => y.score - x.score);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The query names the entry: `/name`, `/bare`, or the full hyphenated / namespaced name. */
export function mentions(query, entry) {
  const q = String(query || '').toLowerCase();
  const names = [entry.name.toLowerCase(), bareName(entry.name)];
  for (const n of names) {
    if (new RegExp(`(^|[\\s(\`'"])/${escapeRe(n)}(?![\\w-])`).test(q)) return true;
    if (/[-:]/.test(n) && new RegExp(`(^|[^\\w-])${escapeRe(n)}(?![\\w-])`).test(q)) return true;
  }
  return false;
}

/**
 * An explicit-only entry may be suggested when the query names it, or clearly asks for that variant:
 * every name token appears in the query, or all but one common token do and a rare one is among them
 * (rare = in at most max(2, 10%) of the catalog's names: "jev", "laya", "classify", not "review").
 * So "A/B jev vs laya on PR severity classify" may reach review-pr-jev-classify; "review this PR" may
 * not reach ess-review-pr.
 */
export function explicitAllowed(query, entry, catalog) {
  if (mentions(query, entry)) return true;
  const q = new Set(tokenize(query));
  const toks = [...new Set(nameTokens(entry.name))];
  const missing = toks.filter((t) => !q.has(t));
  if (!toks.length) return false;
  if (!missing.length) return true;
  if (missing.length > 1) return false;
  const limit = Math.max(2, 0.1 * catalog.length);
  const rare = (t) => catalog.filter((e) => nameTokens(e.name).includes(t)).length <= limit;
  return !rare(missing[0]) && toks.some((t) => q.has(t) && rare(t));
}

/**
 * Stage 1. Returns [{ entry, score, mentioned }] — at most k, score > 0, explicit-only entries removed
 * unless allowed, entries the query names moved to the front.
 */
export function shortlist(entries, query, k = MAX_K, index = buildIndex(entries)) {
  k = Math.max(1, Math.min(MAX_K, Number(k) || MAX_K));
  const scored = bm25(index, query).map((r) => ({ ...r, mentioned: mentions(query, r.entry) }));
  return scored
    .filter((r) => !r.entry.explicitOnly || explicitAllowed(query, r.entry, entries))
    .filter((r) => r.score > 0 || r.mentioned)
    .sort((x, y) => Number(y.mentioned) - Number(x.mentioned) || y.score - x.score)
    .slice(0, k);
}

// ---------------------------------------------------------------- stage 2: one decision request

export function decisionRequest(query, short, context) {
  const criteria = {};
  for (const r of short) criteria[r.entry.id] = clip(`${r.entry.name} (${r.entry.kind}): ${r.entry.description} ${r.entry.head}`, 500);
  criteria.none = 'None of these: the request is a question, a quick edit, chit-chat or ordinary coding work that needs no packaged skill or workflow.';
  const questions = {
    which: { type: 'choice', instructions: 'Which installed skill, command or workflow should handle `request`? Pick `none` when no candidate does what it asks.', criteria },
    gate: { type: 'noul', instructions: 'Does `request` need a dedicated skill or workflow (a packaged multi-step procedure such as a review, a test run, a document workflow or a setup guide), rather than a direct answer, a quick edit or an ordinary command?' },
  };
  short.slice(0, FIT_TOP).forEach((r, i) => {
    questions[`fit_${i}`] = { type: 'noul', instructions: `Does the skill in \`candidates[${i}]\` do the specific thing \`request\` asks for?` };
  });
  return {
    state: {
      request: query,
      repo: context,
      candidates: short.slice(0, FIT_TOP).map((r) => ({ id: r.entry.id, kind: r.entry.kind, description: clip(r.entry.description, 400) })),
    },
    questions,
  };
}

/** Raw stage-2 signals from a decision answer: { ranking:[{id,p}], gate, fits:{id:p} }. */
export function readAnswers(answers, short) {
  const probs = answers.which?.probabilities || {};
  const ids = new Set([...short.map((r) => r.entry.id), 'none']);
  const ranking = Object.entries(probs).filter(([id]) => ids.has(id)).sort((a, b) => b[1] - a[1]).map(([id, p]) => ({ id, p }));
  const fits = {};
  short.slice(0, FIT_TOP).forEach((r, i) => { fits[r.entry.id] = pYes(answers[`fit_${i}`]); });
  return { ranking, gate: pYes(answers.gate), fits };
}

// ---------------------------------------------------------------- final decision (pure)

/**
 * Applies thresholds to raw signals. raw = { mode: 'provider'|'bm25', shortlist:[{id,score,mentioned}],
 * ranking?, gate?, fits? }. Returns { primaryId, alternativeIds, ranked, abstain, reasons, confidence, fit }.
 */
export function finalize(raw, thresholds = {}) {
  const th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const reasons = [];
  let ranked, confidence = null, fit = null;
  if (raw.mode === 'provider') {
    ranked = raw.ranking.filter((r) => r.id !== 'none');
    const top = ranked[0];
    confidence = top?.p ?? null;
    fit = top ? (raw.fits?.[top.id] ?? null) : null;
    if (raw.gate !== null && raw.gate !== undefined && raw.gate < th.gateMin) reasons.push('gate');
    if (fit !== null && fit < th.fitMin) reasons.push('fit');
    if (th.noneAbstain && raw.ranking[0]?.id === 'none') reasons.push('none-first');
    if (top && top.p < th.choiceMin) reasons.push('choice');
  } else {
    ranked = raw.shortlist.map((r) => ({ id: r.id, p: r.score }));
    const [a, b] = raw.shortlist;
    if (a) confidence = Number((a.score / (a.score + (b?.score || 0) || 1)).toFixed(4));
    if (a && !a.mentioned && a.score < th.bm25Min) reasons.push('bm25');
  }
  // A query that names an entry outranks the model's ranking.
  const named = raw.shortlist.find((r) => r.mentioned);
  if (named) {
    ranked = [{ id: named.id, p: ranked.find((r) => r.id === named.id)?.p ?? null }, ...ranked.filter((r) => r.id !== named.id)];
    reasons.length = 0;
  }
  if (!ranked.length) reasons.push('empty');
  const abstain = reasons.length > 0;
  return {
    primaryId: abstain ? null : ranked[0].id,
    alternativeIds: abstain ? [] : ranked.slice(1, 1 + th.maxAlternatives).map((r) => r.id),
    ranked: ranked.map((r) => r.id),
    abstain, reasons, confidence, fit,
  };
}

// ---------------------------------------------------------------- overlaps

const descSet = (e) => new Set(tokenize(e.description));
const jaccard = (a, b) => { let i = 0; for (const t of a) if (b.has(t)) i++; return i / Math.max(1, a.size + b.size - i); };

/** Two entries do the same job: one name contains the other's tokens, or their descriptions overlap. */
export function sameJob(a, b) {
  const ta = nameTokens(bareName(a.name)), tb = nameTokens(bareName(b.name));
  const contains = (x, y) => x.length && x.every((t) => y.includes(t));
  if (contains(ta, tb) || contains(tb, ta)) return true;
  const j = jaccard(descSet(a), descSet(b));
  const sharedName = ta.some((t) => tb.includes(t));
  return j >= 0.25 || (sharedName && j >= 0.1);
}

/**
 * When candidates do the same job: one line per member on what sets it apart (the description clause
 * with most words the others' descriptions lack). Returns [] or [{ id, invocation, differs }].
 */
export function overlaps(entries) {
  const group = entries.filter((e, i) => entries.some((o, j) => i !== j && sameJob(e, o)));
  if (group.length < 2) return [];
  return group.map((e) => {
    const others = new Set(group.filter((o) => o !== e).flatMap((o) => [...descSet(o)]));
    let best = null, bestN = -1;
    for (const c of clauses(e.description)) {
      const n = new Set(tokenize(c).filter((t) => !others.has(t))).size;
      if (n > bestN) { best = c; bestN = n; }
    }
    return { id: e.id, invocation: e.invocation, differs: clip(`${e.explicitOnly ? '[explicit only] ' : ''}${best || e.description}`, 160) };
  });
}

// ---------------------------------------------------------------- route

const label = (mode, c, fit) => {
  if (mode !== 'provider') return 'low (bm25-only)';
  const v = Math.min(c ?? 0, fit ?? 1);
  return v >= 0.6 ? 'high' : v >= 0.35 ? 'medium' : 'low';
};

function present(entry, query, extra = {}) {
  return { id: entry.id, name: entry.name, kind: entry.kind, source: entry.source, invocation: entry.invocation, why: whyPhrase(entry, query), ...extra };
}

/**
 * Full route. Never throws. Returns the printed object plus `raw` (signals before thresholds, used by
 * eval.mjs to pick thresholds offline).
 */
export async function route({ query, root = process.cwd(), provider = 'none', cfg = {}, k = MAX_K, catalog, context, fetchImpl, env, thresholds }) {
  const t0 = Date.now();
  const th = { ...DEFAULT_THRESHOLDS, ...cfg.thresholds, ...thresholds };
  const out = { suggestion: null, alternatives: [], gate: null, abstain: true, abstainReasons: [], overlaps: [], mode: provider === 'none' ? 'bm25-only' : 'provider', provider, confidenceLabel: null, shortlist: [], catalogSize: 0, cost: null, latencyMs: 0 };
  try {
    if (!String(query || '').trim()) return { ...out, error: 'empty query' };
    const cat = catalog || loadCatalog({ root });
    const entries = cat.entries.filter((e) => bareName(e.name) !== SELF);
    out.catalogSize = entries.length;
    const byId = new Map(entries.map((e) => [e.id, e]));
    const short = shortlist(entries, query, k);
    out.shortlist = short.map((r) => ({ id: r.entry.id, bm25: r.score, ...(r.mentioned ? { mentioned: true } : {}) }));
    const raw = { mode: 'bm25', shortlist: short.map((r) => ({ id: r.entry.id, score: r.score, mentioned: r.mentioned })) };
    if (provider !== 'none' && short.length) {
      const ctx = context || repoContext(root, query);
      const res = await decide({ provider, cfg, fetchImpl, env, ...decisionRequest(query, short, ctx) });
      out.cost = res.meta.cost;
      out.model = res.meta.model;
      if (!res.ok) { out.latencyMs = Date.now() - t0; return { ...out, error: res.error, raw }; }
      Object.assign(raw, { mode: 'provider', ...readAnswers(res.answers, short) });
      if (!raw.ranking.length) { out.latencyMs = Date.now() - t0; return { ...out, error: 'choice answer missing', raw }; }
      out.gate = raw.gate;
    }
    const f = finalize(raw, th);
    out.abstain = f.abstain;
    out.abstainReasons = f.reasons;
    out.confidenceLabel = label(raw.mode === 'provider' ? 'provider' : 'bm25', f.confidence, f.fit);
    const p = (id) => raw.ranking?.find((r) => r.id === id)?.p ?? null;
    const conf = (id) => (raw.mode === 'provider' ? p(id) : raw.shortlist.find((r) => r.id === id)?.score ?? null);
    if (!f.abstain) {
      out.suggestion = present(byId.get(f.primaryId), query, { confidence: f.confidence, fit: f.fit });
      out.alternatives = f.alternativeIds.map((id) => present(byId.get(id), query, { confidence: conf(id), fit: raw.fits?.[id] ?? null }));
    } else {
      out.closest = f.ranked.slice(0, 3).map((id) => ({ id, invocation: byId.get(id).invocation, confidence: conf(id) }));
    }
    if (!f.abstain) out.overlaps = overlaps([f.primaryId, ...f.alternativeIds].map((id) => byId.get(id)));
    out.latencyMs = Date.now() - t0;
    return { ...out, raw };
  } catch (e) {
    out.latencyMs = Date.now() - t0;
    return { ...out, suggestion: null, error: String(e?.message ?? e).split('\n')[0].slice(0, 200) };
  }
}

/** --provider flag → env DECISION_PROVIDER → jev.json; `none` means BM25 only. */
export function pickProvider(flag, cfg, env = process.env) {
  const p = String(flag ?? env.DECISION_PROVIDER ?? cfg.provider ?? 'none').trim().toLowerCase();
  return p === 'none' ? 'none' : resolveProvider({ flag: p, env, cfg });
}

async function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(typeof args['project-root'] === 'string' ? args['project-root'] : process.cwd());
  const cfg = loadConfig(SKILL_DIR);
  const query = typeof args.query === 'string' ? args.query : args._.join(' ');
  let provider;
  try { provider = pickProvider(typeof args.provider === 'string' ? args.provider : undefined, cfg); }
  catch (e) { console.log(JSON.stringify({ suggestion: null, error: e.message })); return; }
  const r = await route({ query, root, provider, cfg, k: args.k });
  const { raw, ...shown } = r;
  appendJsonl(LOG_FILE, {
    project: path.basename(root), query, provider, mode: r.mode, suggestion: r.suggestion?.id ?? null,
    alternatives: r.alternatives.map((a) => a.id), gate: r.gate, fit: r.suggestion?.fit ?? null, abstain: r.abstain,
    reasons: r.abstainReasons, shortlist: r.shortlist.map((s) => s.id), latencyMs: r.latencyMs, cost: r.cost, error: r.error ?? null,
  });
  console.log(JSON.stringify(shown, null, args.json ? 2 : 0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.log(JSON.stringify({ suggestion: null, error: String(e?.message ?? e) })); });
}
