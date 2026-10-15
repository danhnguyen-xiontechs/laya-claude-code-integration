#!/usr/bin/env node
// eval.mjs — scores the router on mined cases, for BM25-only and each decision provider.
//
//   node eval.mjs [--cases ~/.skills-router/eval/cases.jsonl] [--providers none,laya,laya:multilingual,kev,jev]
//                 [--project-root <fallback root>] [--dev-frac 0.6] [--salt skills-router-v1]
//                 [--limit N] [--reuse] [--allow-hosted] [--out ~/.skills-router/eval/report.json]
//
// Each case runs once per provider with the raw signals kept (BM25 scores, choice probabilities,
// gate, fits); thresholds are then chosen on the dev split (max balanced accuracy) and reported on
// the held-out split. The split is a fixed hash of the query, so it never changes between runs.
// Each case is routed against the catalog of its own project (`cwd`, when that folder still exists).
//
// PRIVACY: `jev` sends every mined prompt to OpenRouter. It refuses to run without --allow-hosted,
// which must only be passed after the user agreed. none / laya / kev stay on this machine.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareName, loadCatalog, STATE_DIR } from './catalog.mjs';
import { hasPrUrl } from './context.mjs';
import { loadConfig, parseArgs } from './decision-provider.mjs';
import { DEFAULT_THRESHOLDS, finalize, route } from './route.mjs';
import { readJsonl } from './mine-history.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = path.join(STATE_DIR, 'eval');

/** 'dev' or 'test' from a salted hash of the query: stable across runs and machines. */
export function splitOf(query, { salt = 'skills-router-v1', devFrac = 0.6 } = {}) {
  const h = crypto.createHash('sha1').update(`${salt}\u0000${query}`).digest();
  return h.readUInt32BE(0) / 2 ** 32 < devFrac ? 'dev' : 'test';
}

/** Whether a routed id is the expected label (exact id, or the same bare name). */
export const matches = (id, expected) => Boolean(id && expected) && (id === expected || bareName(id) === bareName(expected));

/** Whether the expected label exists in a catalog (by id, bare name or a shadowed copy). */
export function covered(expected, entries) {
  if (!expected) return true;
  return entries.some((e) => matches(e.id, expected) || (e.shadowed || []).some((s) => matches(s.name, expected)));
}

const pctl = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r3 = (x) => (x === null || Number.isNaN(x) ? null : Number(x.toFixed(3)));
const div = (a, b) => (b ? a / b : null);

/**
 * Metrics for rows = [{ expected, raw, latencyMs, cost, error, covered }] under thresholds `th`.
 *   top1 / top3     — expected skill ranked 1st / in top 3 (abstain ignored), over skill cases
 *   wrongRate       — suggested a different skill, over skill cases
 *   missRate        — abstained although a skill was expected, over skill cases
 *   needlessRate    — suggested a skill when none was expected, over none cases
 *   abstainPrecision— abstentions where none was expected, over all abstentions
 *   accuracy        — final answer right (right skill, or abstain on none), over all cases
 *   balanced        — mean of (right-skill rate on skill cases, abstain rate on none cases)
 */
export function metrics(rows, th = {}) {
  const m = { n: 0, skill: 0, none: 0, uncovered: 0, errors: 0, top1: 0, top3: 0, correct: 0, wrong: 0, missed: 0, needless: 0, correctNone: 0, abstains: 0, abstainsOnNone: 0 };
  const lat = [];
  let cost = 0, costed = 0;
  for (const r of rows) {
    if (!r.covered) { m.uncovered++; continue; }
    m.n++;
    if (r.error || !r.raw) m.errors++;
    if (typeof r.latencyMs === 'number') lat.push(r.latencyMs);
    if (typeof r.cost === 'number') { cost += r.cost; costed++; }
    const f = r.raw && !r.error ? finalize(r.raw, th) : { primaryId: null, ranked: [], abstain: true };
    if (f.abstain) { m.abstains++; if (!r.expected) m.abstainsOnNone++; }
    if (r.expected) {
      m.skill++;
      if (matches(f.ranked[0], r.expected)) m.top1++;
      if (f.ranked.slice(0, 3).some((id) => matches(id, r.expected))) m.top3++;
      if (f.abstain) m.missed++;
      else if (matches(f.primaryId, r.expected)) m.correct++;
      else m.wrong++;
    } else {
      m.none++;
      if (f.abstain) m.correctNone++;
      else m.needless++;
    }
  }
  return {
    ...m,
    top1Acc: r3(div(m.top1, m.skill)), top3Acc: r3(div(m.top3, m.skill)),
    wrongRate: r3(div(m.wrong, m.skill)), missRate: r3(div(m.missed, m.skill)), needlessRate: r3(div(m.needless, m.none)),
    abstainPrecision: r3(div(m.abstainsOnNone, m.abstains)), accuracy: r3(div(m.correct + m.correctNone, m.n)),
    balanced: r3(((div(m.correct, m.skill) ?? 0) + (div(m.correctNone, m.none) ?? 0)) / ((m.skill ? 1 : 0) + (m.none ? 1 : 0) || 1)),
    latencyMs: { p50: pctl(lat, 0.5), p95: pctl(lat, 0.95), mean: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null },
    cost: costed ? { total: Number(cost.toFixed(6)), perCase: Number((cost / costed).toFixed(6)) } : null,
  };
}

const grid = (from, to, step) => { const out = []; for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(3))); return out; };

/** Threshold sets to try: BM25 score floor for bm25-only; gate × fit × none-first for providers. */
export function thresholdGrid(mode) {
  if (mode === 'bm25') return grid(0, 20, 0.5).map((bm25Min) => ({ bm25Min }));
  const out = [];
  for (const gateMin of grid(0, 0.95, 0.05)) for (const fitMin of grid(0, 0.95, 0.05)) for (const noneAbstain of [true, false]) out.push({ gateMin, fitMin, noneAbstain });
  return out;
}

/** Best thresholds on rows: max balanced accuracy, then fewer wrong + needless, then the first (loosest) one. */
export function pickThresholds(rows, mode) {
  let best = null;
  for (const th of thresholdGrid(mode)) {
    const m = metrics(rows, th);
    const bad = (m.wrong + m.needless);
    if (!best || m.balanced > best.m.balanced || (m.balanced === best.m.balanced && bad < best.bad)) best = { th, m, bad };
  }
  return best?.th ?? {};
}

/** `spec` is a provider, optionally with a model: none | laya | laya:multilingual | kev | jev:<model>. */
async function runProvider({ spec, cases, cfg: baseCfg, fallbackRoot, reuse }) {
  const [provider, model] = spec.split(':');
  const cfg = !model ? baseCfg : provider === 'jev' ? { ...baseCfg, jevModel: model } : { ...baseCfg, [provider]: { ...baseCfg[provider], model } };
  const file = path.join(EVAL_DIR, `run-${spec.replace(/[^\w.-]+/g, '_')}.jsonl`);
  const prior = new Map();
  if (reuse) for (const r of readJsonl(file)) if (!r.error) prior.set(r.key, r);
  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const partial = `${file}.partial`;
  fs.writeFileSync(partial, '');
  const catalogs = new Map();
  const catalogFor = (cwd) => {
    const root = cwd && fs.existsSync(cwd) ? cwd : fallbackRoot;
    if (!catalogs.has(root)) catalogs.set(root, loadCatalog({ root }));
    return catalogs.get(root);
  };
  const rows = [];
  const lines = [];
  let i = 0;
  for (const c of cases) {
    i++;
    const key = crypto.createHash('sha1').update(`${c.query}\u0000${c.cwd}`).digest('hex').slice(0, 16);
    const cat = catalogFor(c.cwd);
    let r = prior.get(key);
    if (!r) {
      // Historical repo state is unknown; send only what the query itself shows.
      const context = { git_branch: null, working_tree_dirty: null, changed_extensions: [], bmad_output_artifacts: null, pr_url_in_query: hasPrUrl(c.query) };
      const out = await route({ query: c.query, root: cat.root, provider, cfg, catalog: cat, context });
      r = { key, raw: out.raw ?? null, latencyMs: out.latencyMs, cost: out.cost, error: out.error ?? null };
      if (provider !== 'none' && i % 25 === 0) process.stderr.write(`  ${spec}: ${i}/${cases.length}\n`);
    }
    lines.push(JSON.stringify(r));
    fs.appendFileSync(partial, `${lines.at(-1)}\n`);
    rows.push({ ...r, expected: c.expected, split: c.split, covered: covered(c.expected, cat.entries), via: c.via });
  }
  fs.renameSync(partial, file);
  return rows;
}

async function main(argv) {
  const a = parseArgs(argv);
  const casesFile = typeof a.cases === 'string' ? a.cases : path.join(EVAL_DIR, 'cases.jsonl');
  const providers = String(typeof a.providers === 'string' ? a.providers : 'none').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (providers.some((p) => p.split(':')[0] === 'jev') && !a['allow-hosted']) {
    console.log(JSON.stringify({ error: 'provider jev sends every mined prompt to OpenRouter: ask the user first, then pass --allow-hosted' }));
    return;
  }
  const cfg = loadConfig(SKILL_DIR);
  const salt = typeof a.salt === 'string' ? a.salt : 'skills-router-v1';
  const devFrac = Number(a['dev-frac']) || 0.6;
  let cases = readJsonl(casesFile).map((c) => ({ ...c, split: splitOf(c.query, { salt, devFrac }) }));
  if (a.limit) cases = cases.slice(0, Number(a.limit));
  const fallbackRoot = path.resolve(typeof a['project-root'] === 'string' ? a['project-root'] : process.cwd());
  const report = { cases: casesFile, n: cases.length, salt, devFrac, providers: {} };
  for (const provider of providers) {
    const rows = await runProvider({ spec: provider, cases, cfg, fallbackRoot, reuse: Boolean(a.reuse) });
    const mode = provider === 'none' ? 'bm25' : 'provider';
    const dev = rows.filter((r) => r.split === 'dev'), test = rows.filter((r) => r.split === 'test');
    const th = pickThresholds(dev, mode);
    report.providers[provider] = {
      thresholds: th,
      dev: metrics(dev, th),
      test: metrics(test, th),
      testAtDefaults: metrics(test, mode === 'bm25' ? { bm25Min: DEFAULT_THRESHOLDS.bm25Min } : { gateMin: 0.3, fitMin: 0.3, noneAbstain: true }),
    };
  }
  const out = typeof a.out === 'string' ? a.out : path.join(EVAL_DIR, 'report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const pick = ['n', 'skill', 'none', 'uncovered', 'errors', 'top1Acc', 'top3Acc', 'wrongRate', 'missRate', 'needlessRate', 'abstainPrecision', 'accuracy', 'balanced'];
  const table = {};
  for (const [p, r] of Object.entries(report.providers)) {
    for (const s of ['dev', 'test']) table[`${p}/${s}`] = { ...Object.fromEntries(pick.map((k) => [k, r[s][k]])), p50ms: r[s].latencyMs.p50, cost: r[s].cost?.total ?? 0 };
  }
  console.log(JSON.stringify({ report: out, thresholds: Object.fromEntries(Object.entries(report.providers).map(([p, r]) => [p, r.thresholds])) }, null, 2));
  console.table(table);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.log(JSON.stringify({ error: String(e?.message ?? e) })); process.exitCode = 1; });
}
