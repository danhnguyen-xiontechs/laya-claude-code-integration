#!/usr/bin/env node
// suggest.mjs — Jev picks at most one next BMad skill for a request, from the project's own catalog.
// Pattern: TypeSafe "Skill suggestion" cookbook (wide Choice + gate Nouls, then rerank top 3 + fit Nouls).
//
//   node suggest.mjs --project-root <dir> --query "<user request>" [--provider jev|laya|kev] [--json]
//   node suggest.mjs --project-root <dir> --eval cases.jsonl [--provider ...]
//       cases.jsonl: one { "query": "...", "expected": "bmad-prd" | null } per line
//
// Output (stdout, JSON): { suggestion, gate, fit, candidates, catalogSize, provider, error? }.
// Never throws to the caller: on any provider error it prints { suggestion: null, error } and exits 0,
// so the skill continues with plain bmad-help.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendJsonl, decide, loadConfig, parseArgs, pYes, ranked, resolveProvider } from './decision-provider.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOG_FILE = path.join(os.homedir(), '.bmad-jev', 'help-log.jsonl');

/** Minimal RFC-4180 CSV parser (quotes, doubled quotes, newlines inside quotes) → objects keyed by header. */
export function parseCsv(text) {
  const [head, ...body] = parseCsvRows(text);
  return body.map((r) => Object.fromEntries((head || []).map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Same parser → arrays of trimmed fields, header row included. */
export function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

// Current catalog columns. Some installs keep an older header line over rows already in this layout.
const CATALOG_COLS = ['module', 'skill', 'display-name', 'menu-code', 'description', 'action', 'args', 'phase', 'preceded-by', 'followed-by', 'required', 'output-location', 'outputs'];

/** Catalog rows as { skill, action, name, code, phase, description }, whatever header generation the file has. */
export function catalogRows(text) {
  const [head = [], ...body] = parseCsvRows(text);
  const byHeader = (r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']));
  const positional = (r) => Object.fromEntries(CATALOG_COLS.map((h, i) => [h, r[i] ?? '']));
  return body.map((r) => {
    let o;
    if (head.includes('skill')) o = byHeader(r);
    else if (/^[a-z_][a-z0-9_-]*$/.test(r[1] || '') && /^[A-Z0-9]{0,6}$/.test(r[3] || '')) o = positional(r);
    else { const h = byHeader(r); o = { ...h, skill: h.command || h.name, 'display-name': h.name, 'menu-code': h.code, action: '' }; }
    return { skill: o.skill || '', action: o.action || '', name: o['display-name'] || o.skill || '', code: o['menu-code'] || '', phase: o.phase || '', description: o.description || '' };
  });
}

/**
 * The project's skill catalog: `_bmad/_config/bmad-help.csv` (what bmad-help itself reads), else the
 * union of `_bmad/<module>/module-help.csv`. One entry per skill or skill:action; `_meta` rows dropped.
 */
export function loadCatalog(root) {
  const assembled = path.join(root, '_bmad', '_config', 'bmad-help.csv');
  let files = [];
  if (fs.existsSync(assembled)) files = [assembled];
  else {
    const bmad = path.join(root, '_bmad');
    try {
      files = fs.readdirSync(bmad, { withFileTypes: true }).filter((d) => d.isDirectory())
        .map((d) => path.join(bmad, d.name, 'module-help.csv')).filter((f) => fs.existsSync(f));
    } catch { /* no _bmad */ }
  }
  const seen = new Map();
  for (const f of files) {
    for (const r of catalogRows(fs.readFileSync(f, 'utf8'))) {
      if (!r.skill || r.skill === '_meta') continue;
      const key = r.action ? `${r.skill}:${r.action}` : r.skill;
      if (!seen.has(key)) seen.set(key, { key, ...r });
    }
  }
  return { source: files.map((f) => path.relative(root, f)), entries: [...seen.values()] };
}

/** First `n` characters of a skill's SKILL.md body (frontmatter stripped), or ''. */
export function skillExcerpt(root, skill, n = 700) {
  for (const dir of [path.join(root, '.claude', 'skills', skill), path.join(root, '.agents', 'skills', skill)]) {
    try {
      const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?\n---\s*/, '');
      return md.replace(/\s+/g, ' ').trim().slice(0, n);
    } catch { /* try next */ }
  }
  return '';
}

/** Relative paths of existing artifacts under _bmad-output (depth <= 3, at most `max`). */
export function listArtifacts(root, max = 60) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || out.length >= max) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else out.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(path.join(root, '_bmad-output'), 1);
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function wideRequest(query, catalog, artifacts) {
  const criteria = {};
  for (const e of catalog) criteria[e.key] = clip(`${e.name}${e.phase ? ` (${e.phase})` : ''}: ${e.description}`, 300);
  criteria.none = 'No BMad skill fits: the request is a general question, chit-chat, or work outside these workflows.';
  return {
    state: { request: query, existing_artifacts: artifacts },
    questions: {
      which: { type: 'choice', instructions: 'Which BMad skill should the user run to do what `request` asks? `existing_artifacts` lists what the project already has; use it only to judge which step is next.', criteria },
      gate_workflow: { type: 'noul', instructions: 'Does `request` ask for work that a documented BMad workflow carries out: planning, writing or changing a project document, implementing code, reviewing, or testing?' },
      gate_artifact: { type: 'noul', instructions: 'Does `request` ask to create, update, check or act on a project document or code, rather than only to learn or understand something?' },
      gate_prose: { type: 'noul', instructions: 'Would a short plain-language answer fully satisfy `request`, with no workflow run at all?' },
    },
  };
}

export function rerankRequest(query, candidates) {
  const criteria = {};
  candidates.forEach((c) => { criteria[c.key] = clip(`${c.name}: ${c.description} ${c.excerpt}`, 1000); });
  const questions = { best: { type: 'choice', instructions: 'Which of these BMad skills does exactly what `request` asks?', criteria } };
  candidates.forEach((c, i) => {
    questions[`fit_${i}`] = { type: 'noul', instructions: `Does the BMad skill in \`candidates[${i}]\` do the specific thing \`request\` asks for?` };
  });
  return { state: { request: query, candidates: candidates.map((c) => ({ skill: c.key, name: c.name, description: c.description, excerpt: c.excerpt })) }, questions };
}

/** Full two-request suggestion. Returns a plain result object; never throws. */
export async function suggest({ root, query, provider, cfg, fetchImpl, env }) {
  const th = { gateMin: 0.3, fitMin: 0.3, topK: 3, ...cfg.thresholds };
  const { entries, source } = loadCatalog(root);
  const res = { suggestion: null, gate: null, fit: null, candidates: [], catalogSize: entries.length, catalogSource: source, provider, calls: [] };
  if (!entries.length) return { ...res, error: 'no BMad catalog found under _bmad/' };
  const wide = await decide({ provider, cfg, fetchImpl, env, ...wideRequest(query, entries, listArtifacts(root)) });
  res.calls.push(wide.meta);
  if (!wide.ok) return { ...res, error: wide.error };
  const a = wide.answers;
  const g = [pYes(a.gate_workflow), pYes(a.gate_artifact), pYes(a.gate_prose)];
  if (g.some((v) => v === null)) return { ...res, error: 'gate answers missing' };
  res.gate = Number(((g[0] + g[1] + (1 - g[2])) / 3).toFixed(4));
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const top = ranked(a.which?.probabilities).filter((r) => byKey.has(r.label)).slice(0, th.topK);
  res.candidates = top.map((r) => ({ skill: r.label, wideP: r.p }));
  if (res.gate < th.gateMin || !top.length) return res;
  const cands = top.map((r) => ({ ...byKey.get(r.label), excerpt: skillExcerpt(root, byKey.get(r.label).skill) }));
  const rr = await decide({ provider, cfg, fetchImpl, env, ...rerankRequest(query, cands) });
  res.calls.push(rr.meta);
  if (!rr.ok) return { ...res, error: rr.error };
  const bestP = rr.answers.best?.probabilities || {};
  res.candidates = cands.map((c, i) => ({ skill: c.key, wideP: top[i].p, rerankP: bestP[c.key] ?? null, fit: pYes(rr.answers[`fit_${i}`]) }));
  const best = [...res.candidates].sort((x, y) => (y.rerankP ?? 0) - (x.rerankP ?? 0))[0];
  res.fit = best?.fit ?? null;
  if (best && best.fit !== null && best.fit >= th.fitMin) {
    const e = byKey.get(best.skill);
    res.suggestion = { skill: e.skill, action: e.action || null, name: e.name, menuCode: e.code, rerankP: best.rerankP, fit: best.fit };
  }
  return res;
}

/** Scores eval cases: wrong = suggested a different skill, needless = suggested when none expected. */
export function scoreEval(rows) {
  const s = { n: rows.length, covered: 0, wrong: 0, needless: 0, missed: 0, correct: 0, correctNone: 0, errors: 0 };
  for (const r of rows) {
    const exp = r.expected || null, got = r.got || null;
    if (r.error) s.errors++;
    if (exp) {
      s.covered++;
      if (!got) s.missed++;
      else if (got === exp || got.startsWith(`${exp}:`)) s.correct++;
      else s.wrong++;
    } else if (got) s.needless++;
    else s.correctNone++;
  }
  return s;
}

async function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args['project-root'] || process.cwd());
  const cfg = loadConfig(SKILL_DIR);
  let provider;
  try { provider = resolveProvider({ flag: args.provider === true ? undefined : args.provider, cfg }); }
  catch (e) { console.log(JSON.stringify({ suggestion: null, error: e.message })); return; }

  if (args.eval) {
    const cases = fs.readFileSync(args.eval, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    const rows = [];
    for (const c of cases) {
      const r = await suggest({ root, query: c.query, provider, cfg });
      const got = r.suggestion ? (r.suggestion.action ? `${r.suggestion.skill}:${r.suggestion.action}` : r.suggestion.skill) : null;
      rows.push({ query: c.query, expected: c.expected ?? null, got, gate: r.gate, fit: r.fit, error: r.error });
    }
    const s = scoreEval(rows);
    const pct = (x, d) => (d ? `${((100 * x) / d).toFixed(1)}%` : '-');
    console.log(JSON.stringify({ provider, summary: { ...s, wrongRate: pct(s.wrong, s.n), needlessRate: pct(s.needless, s.n), correctOfCovered: pct(s.correct, s.covered) }, rows }, null, 2));
    return;
  }

  const query = typeof args.query === 'string' ? args.query : args._.join(' ');
  if (!query.trim()) { console.log(JSON.stringify({ suggestion: null, error: 'empty --query' })); return; }
  const r = await suggest({ root, query, provider, cfg });
  appendJsonl(LOG_FILE, { project: path.basename(root), query, provider, suggestion: r.suggestion?.skill ?? null, gate: r.gate, fit: r.fit, candidates: r.candidates, error: r.error ?? null, calls: r.calls });
  console.log(JSON.stringify(r, null, args.json ? 2 : 0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.log(JSON.stringify({ suggestion: null, error: String(e?.message ?? e) })); });
}
