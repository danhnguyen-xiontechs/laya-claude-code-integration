#!/usr/bin/env node
// explore.mjs — broad candidate pool for a codebase task, ranked by rules and (optionally) Jev in batches.
// Zero dependencies, Node >= 18.
//
//   node explore.mjs --task "<what the user asked>" --mode bug|feature|refactor|new-feature
//        --queries "term a|term b|ErrorText|SymbolName"   (several distinct vocabularies, | separated)
//        [--root <repo>] [--provider none|jev|laya|kev] [--engine auto|codemap|fallback]
//        [--batch 24] [--keep 4] [--top 10] [--per-query 30] [--max-pool 96] [--max-calls 6]
//        [--max-payload 24000] [--exact] [--json]
//
// Stage 2  retrieval : `codemap find --json` once per query (lexical over paths + symbols), or, when codemap is
//                      missing, a clearly labelled deterministic fallback (git ls-files path match + rg content match).
// Stage 3a cleanup   : normalize, dedupe, drop vendor/generated/build/binary paths. Nothing semantic.
// Stage 3b rules     : deterministic score (per-query normalized score, multi-query bonus, mode priors) = baseline C.
// Stage 3c Jev       : choice batches (~20-30 options + none_of_these), keep top-K per batch by LOCAL rank,
//                      then one global rerank of the survivors. Probabilities are never compared across batches.
// Guards             : max calls, max payload chars per request; any failure → rules ranking (fallback), logged.
// Output             : ranked candidates with provenance + coverage + jev block. Claude verifies by reading source.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, resolveProvider, appendJsonl, parseArgs } from './decision-provider.mjs';

export const MODES = ['bug', 'feature', 'refactor', 'new-feature'];
export const NONE_ID = 'none_of_these';
export const DEFAULTS = { batch: 24, keep: 4, top: 10, perQuery: 30, maxPool: 96, maxCalls: 6, maxPayload: 24000 };
export const LOG_FILE = path.join(os.homedir(), '.claude', 'codebase-task-explorer', 'runs.jsonl');

// ------------------------------------------------------------------ engine discovery

export function findCodemap(env = process.env) {
  const cands = [env.CODEMAP_BIN, 'codemap', path.join(os.homedir(), 'tools', 'codemap', process.platform === 'win32' ? 'codemap.exe' : 'codemap')].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return { bin: c, version: r.stdout.trim() };
  }
  return null;
}

function run(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

// ------------------------------------------------------------------ stage 2: retrieval

/** codemap find per query → [{ path, score, matched[], importers, hub, query, rank }], coverage. */
export function codemapFind(cm, root, queries, perQuery) {
  const hits = [];
  let coverage = null;
  for (const q of queries) {
    const r = run(cm.bin, ['find', '-json', '-limit', String(perQuery), q], root);
    let j = null;
    try { j = JSON.parse(r.out); } catch { continue; }
    coverage = coverage || j.coverage || null;
    (j.hits || []).forEach((h, i) => hits.push({ path: h.path, score: h.score, matched: h.matched || [], importers: h.importers ?? null, hub: !!h.hub, query: q, rank: i }));
  }
  return { hits, coverage: summarizeCoverage(coverage) };
}

export function summarizeCoverage(c) {
  if (!c) return { status: 'unknown', notes: [] };
  return { status: c.status || 'unknown', notes: (c.sources || []).filter((s) => s.status !== 'authoritative').map((s) => `${s.name}: ${s.status}${s.detail ? ` — ${String(s.detail).slice(0, 160)}` : ''}`) };
}

/** Deterministic FALLBACK (no codemap): path-token match over git ls-files + rg content hits. Labelled as such. */
export function fallbackFind(root, queries, perQuery) {
  const files = run('git', ['ls-files'], root).out.split('\n').filter(Boolean);
  const hits = [];
  for (const q of queries) {
    const words = tokens(q);
    if (!words.length) continue;
    const scored = new Map();
    for (const f of files) {
      const p = f.toLowerCase();
      const s = words.filter((w) => p.includes(w)).length * 2;
      if (s) scored.set(f, { s, matched: words.filter((w) => p.includes(w)) });
    }
    const rg = run('rg', ['-c', '-i', '-F', '--no-messages', ...words.flatMap((w) => ['-e', w])], root);
    for (const line of rg.out.split('\n')) {
      const m = line.match(/^(.*):(\d+)$/);
      if (!m) continue;
      const f = m[1].replace(/\\/g, '/');
      const prev = scored.get(f) || { s: 0, matched: [] };
      scored.set(f, { s: prev.s + Math.min(3, Math.log2(1 + Number(m[2]))), matched: [...prev.matched, 'content'] });
    }
    [...scored.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, perQuery)
      .forEach(([f, v], i) => hits.push({ path: f, score: v.s, matched: [...new Set(v.matched)], importers: null, hub: false, query: q, rank: i }));
  }
  return { hits, coverage: { status: 'fallback', notes: ['codemap unavailable: deterministic path/content fallback, no dependency/importer evidence'] } };
}

export const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

// ------------------------------------------------------------------ stage 3a: mechanical cleanup

const JUNK = /(^|\/)(node_modules|vendor|dist|build|out|bin|obj|target|\.git|\.next|coverage|__pycache__|\.venv|venv|packages)\/|\.min\.(js|css)$|\.(png|jpe?g|gif|ico|svg|woff2?|ttf|zip|exe|dll|pdb|lock)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.designer\.cs$|\.g\.cs$/i;

/** Merges hits per path; keeps every reason it matched. */
export function cleanup(hits) {
  const by = new Map();
  for (const h of hits) {
    const p = h.path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (JUNK.test(p)) continue;
    const c = by.get(p) || { path: p, queries: [], matched: new Set(), importers: h.importers, hub: h.hub, perQuery: [] };
    if (!c.queries.includes(h.query)) c.queries.push(h.query);
    h.matched.forEach((m) => c.matched.add(m));
    c.perQuery.push({ q: h.query, score: h.score, rank: h.rank });
    by.set(p, c);
  }
  return [...by.values()].map((c) => ({ ...c, matched: [...c.matched] }));
}

export function category(p) {
  const s = p.toLowerCase();
  if (/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.|tests?\.cs$/.test(s)) return 'test';
  if (/\.(md|txt|html|rst)$/.test(s)) return 'doc';
  if (/\.(json|ya?ml|toml|ini|config|csproj|sln)$/.test(s)) return 'config';
  if (/(^|\/)(eval|bench|fixtures?|runs?|results?)\//.test(s)) return 'data';
  return 'source';
}

// ------------------------------------------------------------------ stage 3b: rules (baseline C)

const PRIORS = {
  bug: { source: 0.3, test: 0.05, config: 0, doc: -0.3, data: -0.4 },
  feature: { source: 0.3, test: 0, config: 0, doc: -0.1, data: -0.4 },
  refactor: { source: 0.3, test: 0.15, config: 0, doc: -0.3, data: -0.4 },
  'new-feature': { source: 0.3, test: 0.05, config: 0.05, doc: -0.1, data: -0.4 },
};

export function rulesRank(pool, hits, mode) {
  const maxBy = {};
  for (const h of hits) maxBy[h.query] = Math.max(maxBy[h.query] || 0, h.score || 0);
  return pool.map((c) => {
    const base = c.perQuery.reduce((s, x) => s + (maxBy[x.q] ? x.score / maxBy[x.q] : 0), 0);
    const multi = 0.5 * (c.queries.length - 1);
    const prior = (PRIORS[mode] || PRIORS.bug)[category(c.path)] ?? 0;
    const hub = mode === 'refactor' && c.hub ? 0.2 : 0;
    return { ...c, category: category(c.path), rules: Number((base + multi + prior + hub).toFixed(4)) };
  }).sort((a, b) => b.rules - a.rules || a.path.localeCompare(b.path));
}

// ------------------------------------------------------------------ stage 3c: Jev batches + global rerank

/** First header comment line of the file: real text from the repo, never a generated summary. */
export function headLine(root, p) {
  try {
    const fd = fs.openSync(path.join(root, p), 'r');
    const buf = Buffer.alloc(800);
    const n = fs.readSync(fd, buf, 0, 800, 0);
    fs.closeSync(fd);
    const lines = buf.toString('utf8', 0, n).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#!'));
    const c = lines.find((l) => /^(\/\/|#|\/\*|\*|"""|<!--|--)/.test(l));
    return c ? c.replace(/^(\/\/+|#+|\/\*+|\*+|"""|<!--|--)\s*/, '').slice(0, 140) : '';
  } catch { return ''; }
}

export const candId = (i) => `c${String(i).padStart(3, '0')}`;

export function optionText(c) {
  const parts = [`${c.path} [${c.category}]`];
  if (c.head) parts.push(`header: ${c.head}`);
  if (c.matched.length) parts.push(`matched: ${c.matched.slice(0, 6).join(', ')}`);
  parts.push(`queries: ${c.queries.length}`);
  if (c.importers != null) parts.push(`importers: ${c.importers}${c.hub ? ' (hub)' : ''}`);
  return parts.join(' | ').slice(0, 360);
}

const MODE_GOAL = {
  bug: 'the best places to start investigating the root cause of the reported bug',
  feature: 'the files that implement the existing feature end-to-end (entry point, core logic)',
  refactor: 'the target module of the refactor and the files most affected by changing it',
  'new-feature': 'the closest analogous existing implementation and the likely extension points for the new feature',
};

export function batchRequest(task, mode, batch, coverage) {
  const criteria = {};
  for (const c of batch) criteria[c.id] = optionText(c);
  criteria[NONE_ID] = 'None of these: no candidate in this list is a useful starting point for the task.';
  return {
    state: { task, mode, coverage: coverage.status },
    questions: { best: { type: 'choice', instructions: `Which file in this list is among ${MODE_GOAL[mode] || MODE_GOAL.bug} for \`task\`? Pick ${NONE_ID} when none fits.`, criteria } },
  };
}

/** Local ranking inside one batch: ids by probability, none_of_these position reported separately. */
export function readBatch(answer, ids) {
  const probs = answer?.probabilities || {};
  const order = Object.entries(probs).filter(([k]) => ids.includes(k) || k === NONE_ID).sort((a, b) => b[1] - a[1]);
  const noneRank = order.findIndex(([k]) => k === NONE_ID);
  return { order: order.filter(([k]) => k !== NONE_ID).map(([id, p]) => ({ id, p })), noneWon: noneRank === 0, noneP: probs[NONE_ID] ?? null };
}

export function chunk(a, n) { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

/**
 * Batched Jev ranking. ranked = rules order (already capped at maxPool). Returns
 * { order: [ids], jev: { called, calls, batches, survivors, global, fallback, reason, latencyMs, cost } }.
 */
export async function jevRank({ task, mode, ranked, coverage, provider, cfg, opts, decideImpl = decide }) {
  const jev = { provider, called: false, calls: 0, batches: [], survivors: [], global: null, fallback: false, reason: null, latencyMs: 0, cost: 0 };
  const call = async (req) => {
    const size = JSON.stringify(req).length;
    if (size > opts.maxPayload) return { ok: false, error: `payload ${size} > max ${opts.maxPayload}` };
    if (jev.calls >= opts.maxCalls) return { ok: false, error: `call budget ${opts.maxCalls} exhausted` };
    jev.calls++; jev.called = true;
    const r = await decideImpl({ provider, state: req.state, questions: req.questions, cfg });
    jev.latencyMs += r.meta?.latencyMs || 0;
    jev.cost += r.meta?.cost || 0;
    return r;
  };
  const batches = chunk(ranked, opts.batch);
  // one batch → it already is the global comparison
  const survivors = [];
  for (const [bi, b] of batches.entries()) {
    const ids = b.map((c) => c.id);
    const r = await call(batchRequest(task, mode, b, coverage));
    if (!r.ok) { jev.fallback = true; jev.reason = r.error; break; }
    const rb = readBatch(r.answers.best, ids);
    // keep top-K by LOCAL rank; when none_of_these wins we still keep K (enough for fallback) but flag it
    const kept = rb.order.slice(0, batches.length === 1 ? rb.order.length : opts.keep).map((x) => x.id);
    jev.batches.push({ batch: bi, members: ids, kept: kept.slice(0, opts.keep), noneWon: rb.noneWon, noneP: rb.noneP, model: r.meta?.model });
    if (batches.length === 1) { jev.global = { order: rb.order, noneWon: rb.noneWon, noneP: rb.noneP }; break; }
    survivors.push(...kept);
  }
  if (jev.fallback) return { order: ranked.map((c) => c.id), jev };
  if (!jev.global) {
    const uniq = [...new Set(survivors)];
    jev.survivors = uniq;
    const pool = uniq.map((id) => ranked.find((c) => c.id === id));
    const r = await call(batchRequest(task, mode, pool, coverage));
    if (!r.ok) { jev.fallback = true; jev.reason = `global: ${r.error}`; }
    else { const rg = readBatch(r.answers.best, uniq); jev.global = { order: rg.order, noneWon: rg.noneWon, noneP: rg.noneP }; }
  }
  // final order: global Jev order of survivors (or per-batch kept, in batch-local order, on global failure), then rest by rules
  let head;
  if (jev.global) head = jev.global.order.map((x) => x.id);
  else head = jev.batches.flatMap((b) => b.kept);
  const seen = new Set(head);
  return { order: [...head, ...ranked.map((c) => c.id).filter((id) => !seen.has(id))], jev };
}

// ------------------------------------------------------------------ orchestration

export async function explore({ task, mode = 'bug', queries = [], root = process.cwd(), provider = 'none', engine = 'auto', exact = false, cfg = {}, opts = {}, decideImpl, cm } = {}) {
  opts = { ...DEFAULTS, ...opts };
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  const t0 = Date.now();
  const qs = [...new Set([task, ...queries].map((q) => String(q).trim()).filter(Boolean))];
  cm = cm === undefined ? (engine === 'fallback' ? null : findCodemap()) : cm;
  if (engine === 'codemap' && !cm) throw new Error('codemap not found (set CODEMAP_BIN or install it)');
  const { hits, coverage } = cm ? codemapFind(cm, root, qs, opts.perQuery) : fallbackFind(root, qs, opts.perQuery);
  const pool = cleanup(hits);
  const ruled = rulesRank(pool, hits, mode).slice(0, opts.maxPool).map((c, i) => ({ ...c, id: candId(i) }));
  // baseline B: codemap-only = the task-text query alone, codemap's own order
  const codemapOnly = hits.filter((h) => h.query === qs[0]).map((h) => h.path.replace(/\\/g, '/'));
  let order = ruled.map((c) => c.id), jev = { provider, called: false, skipped: null };
  const skip = provider === 'none' ? 'disabled' : exact ? 'exact file/symbol named' : ruled.length < 2 ? 'candidate pool empty/unusable' : null;
  if (skip) jev.skipped = skip;
  else {
    for (const c of ruled) c.head = headLine(root, c.path);
    ({ order, jev } = await jevRank({ task, mode, ranked: ruled, coverage, provider, cfg, opts, decideImpl }));
  }
  const byId = Object.fromEntries(ruled.map((c) => [c.id, c]));
  const ranked = order.map((id) => byId[id]).filter(Boolean);
  const result = {
    task, mode, engine: cm ? `codemap ${cm.version}` : 'fallback (git ls-files + rg)', queries: qs, coverage,
    poolSize: pool.length, considered: ruled.length,
    top: ranked.slice(0, opts.top).map((c, i) => ({ rank: i + 1, id: c.id, path: c.path, category: c.category, rules: c.rules, queries: c.queries, matched: c.matched.slice(0, 8), importers: c.importers, hub: c.hub })),
    rulesTop: ruled.slice(0, opts.top).map((c) => c.path),
    codemapOnlyTop: codemapOnly.slice(0, opts.top),
    jev, elapsedMs: Date.now() - t0,
  };
  appendJsonl(LOG_FILE, { task, mode, engine: result.engine, coverage: coverage.status, pool: pool.length, considered: ruled.length, provider, jev: { called: jev.called, calls: jev.calls, skipped: jev.skipped, fallback: jev.fallback, reason: jev.reason, batches: jev.batches, survivors: jev.survivors, global: jev.global?.order?.slice(0, 10) }, top: result.top.map((c) => c.path), elapsedMs: result.elapsedMs });
  return result;
}

export function toMarkdown(r) {
  const L = [`## Candidate starting points — ${r.mode}`, '', `Engine: ${r.engine} · coverage: **${r.coverage.status}** · pool ${r.poolSize} → considered ${r.considered}`];
  if (r.coverage.notes.length) L.push('', 'Coverage notes (a missing edge is NOT proof of no dependency):', ...r.coverage.notes.map((n) => `- ${n}`));
  L.push('', '| # | path | why it matched | importers |', '|---|---|---|---|');
  for (const c of r.top) L.push(`| ${c.rank} | \`${c.path}\` | ${c.queries.length} quer${c.queries.length > 1 ? 'ies' : 'y'}: ${c.matched.slice(0, 4).join(', ')} | ${c.importers ?? '–'}${c.hub ? ' hub' : ''} |`);
  const j = r.jev;
  L.push('', `Jev: ${j.called ? `${j.calls} call(s), ${j.batches.length} batch(es), survivors ${j.survivors.length || '–'}${j.global?.noneWon ? ', **none_of_these won the final pass → expand the search**' : ''}${j.fallback ? `, FELL BACK to rules (${j.reason})` : ''}` : `not called (${j.skipped})`}. Advisory ranking only — verify by reading source.`);
  return L.join('\n');
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.task) { console.error('usage: explore.mjs --task "..." --mode bug|feature|refactor|new-feature --queries "a|b|c" [--provider none|jev]'); process.exit(2); }
  const off = process.env.CODEBASE_EXPLORER_JEV === 'off';
  const provider = off || a.provider === 'none' || (!a.provider && !process.env.DECISION_PROVIDER) ? 'none' : resolveProvider({ flag: a.provider });
  const num = (k, d) => (a[k] !== undefined ? Number(a[k]) : d);
  const r = await explore({
    task: a.task, mode: a.mode || 'bug', queries: a.queries ? String(a.queries).split('|') : [], root: a.root || process.cwd(),
    provider, engine: a.engine || 'auto', exact: !!a.exact,
    opts: { batch: num('batch', DEFAULTS.batch), keep: num('keep', DEFAULTS.keep), top: num('top', DEFAULTS.top), perQuery: num('per-query', DEFAULTS.perQuery), maxPool: num('max-pool', DEFAULTS.maxPool), maxCalls: num('max-calls', DEFAULTS.maxCalls), maxPayload: num('max-payload', DEFAULTS.maxPayload) },
  });
  console.log(a.json ? JSON.stringify(r, null, 2) : toMarkdown(r));
}
