// planner.mjs — story-batch-planner core. Zero dependencies, Node >= 18.
//
// Phase 1 (deterministic): parse stories + explicit links, extract shared resources (files, modules,
// API/DTO contracts, schema/migrations, test fixtures), classify every pair, build the ordering
// graph, report cycles, pack waves. Phase 3 (shadow): ask TypeSafe Jev about the pre-filtered
// ambiguous pairs only; its answers are stored as suggestions and NEVER change the waves.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { decide, top, appendJsonl } from './decision-provider.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const RELATIONS = ['depends_on', 'shared_resource', 'likely_independent', 'unknown'];
export const JEV_LABELS = ['independent', 'shared_module_or_contract', 'depends_on_A', 'depends_on_B', 'unknown'];

export const DEFAULTS = {
  maxConcurrency: 4,
  protectedKinds: ['schema', 'migration'],          // never parallel, whatever Jev says
  incompleteMinWords: 8,                            // fewer words and no resources → incomplete
  ambiguousTokenOverlap: 2,                         // shared significant title/desc tokens → ambiguous
  jev: { enabled: false, provider: 'jev', maxCalls: 10, timeoutMs: 10000, log: path.join(os.homedir(), '.story-batch-planner', 'jev-shadow.jsonl') },
};

export function loadConfig({ file = path.join(here, '..', 'config.json'), overrides = {} } = {}) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* defaults */ }
  return { ...DEFAULTS, ...cfg, ...overrides, jev: { ...DEFAULTS.jev, ...(cfg.jev || {}), ...(overrides.jev || {}) } };
}

// ---------- extraction ----------
const RX = {
  file: /\b[\w./-]*[\w-]+\.(?:tsx?|jsx?|mjs|cs|py|java|go|rb|sql|json|ya?ml|razor|cshtml|html|css|scss)\b/g,
  endpoint: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/{}:.-]+)|(\/api\/[\w/{}:.-]+)/g,
  dto: /\b[A-Z][A-Za-z0-9]*(?:Dto|DTO|Request|Response|Contract|Event)\b/g,
  table: /\b(?:table|tables)\s+[`"']?([A-Za-z_][\w.]*)|\b[`"']?([A-Za-z_][\w.]*)[`"']?\s+table\b/gi,
  migration: /\b(?:migration|schema change|alter table|add column|drop column|new column|index on)\b/i,
  fixture: /\b(?:fixture|seed data|seed file|test data set)s?\s+[`"']?([\w./-]+)/gi,
  producer: /\b(?:add|adds|create|creates|introduce|introduces|define|defines|expose|exposes|implement|implements|new|extend|extends|change|changes|rename|renames)\b/i,
  consumer: /\b(?:call|calls|consume|consumes|use|uses|using|display|displays|show|shows|read|reads|integrate|integrates|fetch|fetches|from)\b/i,
  ref: /\b(?:depends on|dependent on|after|requires|blocked by|builds on|needs|once)\s+(?:story\s+|ticket\s+|#)?([A-Z][A-Z0-9]*-\d+|\d{2,})/gi,
};
const STOP = new Set('the a an and or of to for in on with by as is are be it this that from into at when user users should can will add new update show page list data story field fields button allow able'.split(' '));
const words = (s) => (String(s).toLowerCase().match(/[a-z][a-z0-9]+/g) || []);
const stem = (w) => w.replace(/(ings?|als?|ed|es|s|e)$/, '');
const sentences = (s) => String(s).split(/(?<=[.!?;\n])\s+/).filter(Boolean);

function textOf(st) { return [st.title, st.description, ...(st.ac || [])].filter(Boolean).join('\n'); }

/** Resources of one story: explicit metadata first, then what the text names. */
export function extract(st) {
  const text = textOf(st);
  const res = { file: new Set(st.files || []), module: new Set(st.modules || []), contract: new Map(), table: new Set(st.tables || []), migration: Boolean(st.migration), fixture: new Set(st.fixtures || []) };
  for (const c of st.contracts || []) res.contract.set(typeof c === 'string' ? c : c.name, typeof c === 'string' ? null : c.role || null);
  for (const m of text.matchAll(RX.file)) res.file.add(m[0]);
  for (const f of res.file) {
    if (/(^|\/)(fixtures?|seed|testdata)\//i.test(f)) res.fixture.add(f);
    const parts = f.split('/'); if (parts.length > 2) res.module.add(parts.slice(0, 2).join('/'));
  }
  // contract roles at sentence level: a producer verb wins over a consumer verb
  for (const s of sentences(text)) {
    const names = [...[...s.matchAll(RX.endpoint)].map((m) => `${m[1] || m[2]}`), ...[...s.matchAll(RX.dto)].map((m) => m[0])];
    const role = RX.producer.test(s) ? 'producer' : RX.consumer.test(s) ? 'consumer' : null;
    for (const n of names) { const prev = res.contract.get(n); res.contract.set(n, prev === 'producer' ? prev : role || prev || null); }
  }
  for (const m of text.matchAll(RX.table)) { const t = (m[1] || m[2]).toLowerCase(); if (!STOP.has(t) && t !== 'the') res.table.add(t); }
  if (RX.migration.test(text) || st.migrations?.length) res.migration = true;
  for (const m of st.migrations || []) res.file.add(m);
  for (const m of text.matchAll(RX.fixture)) res.fixture.add(m[1].replace(/[.,]$/, ''));
  const refs = new Set((st.links || []).filter((l) => /depend|predecessor|blocked/i.test(l.type || 'depends_on')).map((l) => String(l.id)));
  const textRefs = new Set([...text.matchAll(RX.ref)].map((m) => m[1]));
  const tokens = new Set(words(`${st.title} ${st.description || ''}`).filter((w) => !STOP.has(w) && w.length > 2).map(stem));
  const nWords = words(text).length;
  const hasRes = res.file.size || res.module.size || res.contract.size || res.table.size || res.migration || res.fixture.size;
  return { ...res, refs, textRefs, tokens, incomplete: nWords < (st._minWords ?? DEFAULTS.incompleteMinWords) && !hasRes && !refs.size };
}

const inter = (a, b) => [...a].filter((x) => b.has(x));

// ---------- pair analysis ----------
/**
 * Classify one pair (A before B in input order). Returns an edge:
 * { from, to, relation, source, evidence[], confidence, needs_review, order?: [first, second], ambiguous, protected }
 * depends_on edges read "from depends_on to" (to is the prerequisite).
 */
export function classifyPair(A, B, ra, rb, cfg = DEFAULTS) {
  const base = { a: A.id, b: B.id, evidence: [], needs_review: false, ambiguous: false, protected: false };
  // 1. explicit links (ADO) — hard, highest precedence
  if (ra.refs.has(B.id) || rb.refs.has(A.id)) {
    const both = ra.refs.has(B.id) && rb.refs.has(A.id);
    const [from, to] = ra.refs.has(B.id) ? [A.id, B.id] : [B.id, A.id];
    return { ...base, from, to, relation: 'depends_on', source: 'explicit_link', confidence: 'high', evidence: [`link ${from} → ${to}${both ? ' (and reverse)' : ''}`], also_reverse: both };
  }
  // 2. story text names the other story ("depends on S-2")
  if (ra.textRefs.has(B.id) || rb.textRefs.has(A.id)) {
    const [from, to] = ra.textRefs.has(B.id) ? [A.id, B.id] : [B.id, A.id];
    return { ...base, from, to, relation: 'depends_on', source: 'text_reference', confidence: 'high', evidence: [`${from} text references ${to}`], also_reverse: ra.textRefs.has(B.id) && rb.textRefs.has(A.id) };
  }
  const ev = [];
  // 3. API/DTO contract: producer → consumer is an ordering; two producers conflict
  for (const c of inter(new Set(ra.contract.keys()), new Set(rb.contract.keys()))) {
    const pa = ra.contract.get(c), pb = rb.contract.get(c);
    if (pa === 'producer' && pb !== 'producer') return { ...base, from: B.id, to: A.id, relation: 'depends_on', source: 'contract_role', confidence: 'medium', evidence: [`${A.id} produces ${c}, ${B.id} consumes it`] };
    if (pb === 'producer' && pa !== 'producer') return { ...base, from: A.id, to: B.id, relation: 'depends_on', source: 'contract_role', confidence: 'medium', evidence: [`${B.id} produces ${c}, ${A.id} consumes it`] };
    if (pa === 'producer' && pb === 'producer') ev.push({ kind: 'contract', what: c, note: 'both change it' });
    else if (pa !== 'consumer' || pb !== 'consumer') ev.push({ kind: 'contract', what: c, note: 'roles unclear' });
  }
  // 4. schema / migrations — protected
  const tables = inter(ra.table, rb.table);
  if (ra.migration && rb.migration) ev.push({ kind: 'migration', what: tables.length ? tables.join(',') : 'migration chain', note: 'both add migrations' });
  else if (tables.length && (ra.migration || rb.migration)) ev.push({ kind: 'schema', what: tables.join(','), note: 'one changes a table the other uses' });
  // 5. files, fixtures
  for (const f of inter(ra.file, rb.file)) ev.push({ kind: 'file', what: f });
  for (const f of inter(ra.fixture, rb.fixture)) ev.push({ kind: 'fixture', what: f });
  if (ev.length) {
    const prot = ev.some((e) => cfg.protectedKinds.includes(e.kind));
    const unclear = ev.every((e) => e.note === 'roles unclear');
    return { ...base, relation: 'shared_resource', source: 'deterministic', confidence: unclear ? 'low' : 'high', evidence: ev.map((e) => `${e.kind}: ${e.what}${e.note ? ` (${e.note})` : ''}`), protected: prot, ambiguous: unclear && !prot, needs_review: unclear };
  }
  // 6. same module only, or strong topical overlap, or an incomplete story → ambiguous (serialize, review)
  const mods = inter(ra.module, rb.module);
  const toks = inter(ra.tokens, rb.tokens);
  if (mods.length) return { ...base, relation: 'unknown', source: 'prefilter', confidence: 'low', evidence: [`same module: ${mods.join(', ')}`, ...(toks.length ? [`shared terms: ${toks.slice(0, 5).join(', ')}`] : [])], ambiguous: true, needs_review: true, reason: 'same module, no file/contract evidence' };
  if ((ra.incomplete || rb.incomplete) && toks.length) return { ...base, relation: 'unknown', source: 'prefilter', confidence: 'low', evidence: [`incomplete story; shared terms: ${toks.slice(0, 5).join(', ')}`], ambiguous: true, needs_review: true, reason: 'incomplete description' };
  if (toks.length >= cfg.ambiguousTokenOverlap) return { ...base, relation: 'unknown', source: 'prefilter', confidence: 'low', evidence: [`shared terms: ${toks.slice(0, 5).join(', ')}`], ambiguous: true, needs_review: true, reason: 'topical overlap without resource evidence' };
  return { ...base, relation: 'likely_independent', source: 'deterministic', confidence: (ra.incomplete || rb.incomplete) ? 'low' : 'medium', evidence: ['no shared resource found'] };
}

// ---------- graph ----------
/** Strongly connected components with > 1 node (Tarjan). adj: Map id → Set(prereq ids). */
export function findCycles(ids, adj) {
  let idx = 0; const st = [], on = new Set(), I = new Map(), L = new Map(), out = [];
  const visit = (v) => {
    I.set(v, idx); L.set(v, idx++); st.push(v); on.add(v);
    for (const w of adj.get(v) || []) {
      if (!I.has(w)) { visit(w); L.set(v, Math.min(L.get(v), L.get(w))); } else if (on.has(w)) L.set(v, Math.min(L.get(v), I.get(w)));
    }
    if (L.get(v) === I.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) out.push(c.reverse()); }
  };
  for (const v of ids) if (!I.has(v)) visit(v);
  return out;
}

/** Layer by longest path over prerequisites; chunk by maxConcurrency. */
function layer(ids, prereq, maxC) {
  const level = new Map();
  const lv = (v, seen = new Set()) => {
    if (level.has(v)) return level.get(v);
    seen.add(v);
    let l = 0; for (const p of prereq.get(v) || []) if (ids.includes(p)) l = Math.max(l, lv(p, seen) + 1);
    level.set(v, l); return l;
  };
  ids.forEach((v) => lv(v));
  const byLevel = [];
  for (const v of ids) (byLevel[level.get(v)] ||= []).push(v);
  const waves = [];
  for (const grp of byLevel.filter(Boolean)) for (let i = 0; i < grp.length; i += maxC) waves.push(grp.slice(i, i + maxC));
  return waves;
}

// ---------- plan ----------
export function plan(batch, cfg = loadConfig()) {
  const stories = (batch.stories || []).map((s) => ({ ...s, id: String(s.id) }));
  const ids = stories.map((s) => s.id);
  const R = new Map(stories.map((s) => [s.id, extract({ ...s, _minWords: cfg.incompleteMinWords })]));
  const assumptions = [];
  for (const s of stories) {
    for (const r of R.get(s.id).refs) if (!ids.includes(r)) assumptions.push(`${s.id} links to ${r}, which is not in this batch (assumed done or out of scope)`);
    if (!s.files?.length && !s.modules?.length) assumptions.push(`${s.id}: no repository metadata; modules/files inferred from text only`);
  }
  const edges = [];
  for (let i = 0; i < stories.length; i++) for (let j = i + 1; j < stories.length; j++) {
    const e = classifyPair(stories[i], stories[j], R.get(stories[i].id), R.get(stories[j].id), cfg);
    edges.push(e);
    if (e.also_reverse) edges.push({ ...e, from: e.to, to: e.from, evidence: [`link ${e.to} → ${e.from}`] });
  }
  // hard prerequisite graph
  const prereq = new Map(ids.map((id) => [id, new Set()]));
  for (const e of edges) if (e.relation === 'depends_on') prereq.get(e.from).add(e.to);
  const cycles = findCycles(ids, prereq);
  const inCycle = new Set(cycles.flat());
  // anything that (transitively) depends on a cycle member is blocked too
  const blocked = new Set(inCycle);
  let grew = true;
  while (grew) { grew = false; for (const id of ids) if (!blocked.has(id) && [...prereq.get(id)].some((p) => blocked.has(p))) { blocked.add(id); grew = true; } }
  const incomplete = new Set(ids.filter((id) => R.get(id).incomplete && !blocked.has(id)));
  // orient conflict / unknown edges: follow hard-dependency depth, then input order (never creates a cycle)
  const depth = new Map();
  const d = (v, seen = new Set()) => { if (depth.has(v)) return depth.get(v); if (seen.has(v)) return 0; seen.add(v); let x = 0; for (const p of prereq.get(v)) x = Math.max(x, d(p, seen) + 1); depth.set(v, x); return x; };
  ids.forEach((v) => d(v));
  const pos = new Map(ids.map((id, k) => [id, k]));
  const order = new Map(ids.map((id) => [id, new Set(prereq.get(id))]));
  for (const e of edges) {
    if (e.relation !== 'shared_resource' && e.relation !== 'unknown') continue;
    const [first, second] = [e.a, e.b].sort((x, y) => depth.get(x) - depth.get(y) || pos.get(x) - pos.get(y));
    e.order = [first, second];
    e.handling = e.relation === 'unknown' ? 'serialize_and_review' : e.protected ? 'serialize_protected' : 'serialize';
    order.get(second).add(first);
  }
  // waves: schedulable stories first, then incomplete ones alone (review first), blocked ones never
  const runnable = ids.filter((id) => !blocked.has(id) && !incomplete.has(id));
  const waves = layer(runnable, order, cfg.maxConcurrency);
  for (const id of incomplete) waves.push([id]);
  const waveOf = new Map(); waves.forEach((w, k) => w.forEach((id) => waveOf.set(id, k + 1)));

  const review = [];
  for (const c of cycles) review.push({ kind: 'cycle', stories: c, reason: `dependency cycle ${c.join(' → ')} → ${c[0]}; planning decision needed, no order invented` });
  for (const id of blocked) if (!inCycle.has(id)) review.push({ kind: 'blocked', stories: [id], reason: 'depends on a story in a cycle' });
  for (const id of incomplete) review.push({ kind: 'incomplete', stories: [id], reason: 'description too thin to infer relationships; scheduled alone in a final wave' });
  for (const e of edges) if (e.needs_review) review.push({ kind: 'pair', stories: [e.a, e.b], reason: e.reason || e.evidence.join('; '), handling: e.handling });

  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    policy: { maxConcurrency: cfg.maxConcurrency, protectedKinds: cfg.protectedKinds, jev: cfg.jev.enabled ? 'shadow' : 'disabled' },
    stories: stories.map((s) => {
      const r = R.get(s.id);
      const risk = [];
      if (r.migration) risk.push('schema/migration');
      if (r.incomplete) risk.push('incomplete description');
      if (blocked.has(s.id)) risk.push(inCycle.has(s.id) ? 'in dependency cycle' : 'blocked by cycle');
      return { id: s.id, title: s.title, wave: waveOf.get(s.id) ?? null, prerequisites: [...prereq.get(s.id)], after: [...order.get(s.id)].filter((x) => !prereq.get(s.id).has(x)), modules: [...r.module], risk_notes: risk };
    }),
    edges: edges.filter((e) => e.relation !== 'likely_independent' || e.confidence === 'low').map(cleanEdge),
    independent_pairs: edges.filter((e) => e.relation === 'likely_independent' && e.confidence !== 'low').length,
    waves: waves.map((w, k) => ({ wave: k + 1, stories: w })),
    blocked_or_review_required: review,
    assumptions,
    dispatch: waves.flatMap((w, k) => w.map((id) => {
      const s = stories.find((x) => x.id === id);
      return { story: id, wave: k + 1, subagent_type: 'general-purpose', worktree: true, task: `Implement story ${id}: ${s.title}\n\n${s.description || ''}${s.ac?.length ? `\n\nAcceptance criteria:\n- ${s.ac.join('\n- ')}` : ''}` };
    })),
  };
  return out;
}

function cleanEdge(e) {
  const o = { from: e.from ?? e.a, to: e.to ?? e.b, relation: e.relation, source: e.source, confidence: e.confidence, evidence: e.evidence, needs_review: e.needs_review };
  if (e.relation !== 'depends_on') { o.pair = [e.a, e.b]; delete o.from; delete o.to; }
  if (e.order) o.order = e.order;
  if (e.handling) o.handling = e.handling;
  if (e.protected) o.protected = true;
  if (e.ambiguous) o.ambiguous = true;
  return o;
}

// ---------- Phase 3: Jev shadow ----------
export function buildJevRequest(A, B, edge) {
  const brief = (s) => `${s.id}: ${s.title}\n${String(s.description || '').slice(0, 400)}${s.ac?.length ? `\nAC: ${s.ac.slice(0, 3).join(' | ').slice(0, 300)}` : ''}${s.modules?.length ? `\nModules: ${s.modules.join(', ')}` : ''}`;
  const state = { text: `Two user stories from the same delivery batch. Decide how they relate for parallel implementation by separate agents in separate worktrees.\n\nStory A — ${brief(A)}\n\nStory B — ${brief(B)}\n\nWhy this pair was shortlisted: ${edge.evidence.join('; ')}` };
  const criteria = {
    independent: 'A and B can be implemented and merged in either order or at the same time without touching the same module, contract, schema or test data.',
    shared_module_or_contract: 'A and B change the same module, API/DTO contract, schema or test fixture, so running them at once risks merge conflicts or integration breakage, but neither needs the other first.',
    depends_on_A: 'B needs something A delivers (A must be done first).',
    depends_on_B: 'A needs something B delivers (B must be done first).',
    unknown: 'The descriptions are too vague to tell.',
  };
  return { state, questions: { relation: { type: 'choice', instructions: 'How do story A and story B relate?', criteria } } };
}

/** Map a Jev answer onto a suggestion; anything invalid → unknown (conservative). */
export function interpretJev(r, edge) {
  if (!r?.ok) return { label: 'unknown', p: null, valid: false, error: r?.error || 'no response', handling: 'serialize_and_review' };
  const t = top(r.answers?.relation?.probabilities || {});
  if (!JEV_LABELS.includes(t.label)) return { label: 'unknown', p: null, valid: false, error: 'invalid label', handling: 'serialize_and_review' };
  let handling = 'serialize_and_review';
  if (t.label === 'independent') handling = edge.protected ? 'serialize_protected' : 'would_parallelize_if_promoted';
  else if (t.label === 'shared_module_or_contract') handling = 'serialize';
  else if (t.label.startsWith('depends_on')) handling = 'order';
  return { label: t.label, p: t.p, margin: Number((t.p - t.second).toFixed(4)), valid: true, handling };
}

/** Shadow pass: annotates ambiguous edges with jev_suggestion; waves are left untouched. */
export async function jevShadow(batch, result, cfg, { decideImpl = decide, env = process.env } = {}) {
  const byId = new Map(batch.stories.map((s) => [String(s.id), { ...s, id: String(s.id) }]));
  const cands = result.edges.filter((e) => e.ambiguous);
  const shadow = { calls: 0, skipped: 0, errors: 0, cost: 0, latencyMs: [] };
  for (const e of cands) {
    if (shadow.calls >= cfg.jev.maxCalls) { shadow.skipped++; e.jev_suggestion = { label: 'unknown', valid: false, error: 'call budget exhausted', handling: 'serialize_and_review' }; continue; }
    const [a, b] = e.pair;
    const { state, questions } = buildJevRequest(byId.get(a), byId.get(b), e);
    const r = await decideImpl({ provider: cfg.jev.provider, state, questions, jev: cfg.jev, laya: cfg.laya, env, timeoutMs: cfg.jev.timeoutMs });
    shadow.calls++;
    const s = interpretJev(r, e);
    if (!s.valid) shadow.errors++;
    shadow.cost += r?.meta?.cost || 0;
    if (r?.meta?.latencyMs != null) shadow.latencyMs.push(r.meta.latencyMs);
    e.jev_suggestion = { ...s, provenance: { provider: cfg.jev.provider, model: r?.meta?.model ?? null, latencyMs: r?.meta?.latencyMs ?? null }, applied: false };
    if (cfg.jev.log) appendJsonl(cfg.jev.log, { pair: e.pair, deterministic: e.relation, suggestion: s.label, p: s.p, valid: s.valid, model: r?.meta?.model ?? null });
  }
  result.jev_shadow = { ...shadow, cost: Number(shadow.cost.toFixed(6)), candidates: cands.length };
  return result;
}

// ---------- summary ----------
export function summary(p) {
  const L = [`# Story batch plan (${p.stories.length} stories, ${p.waves.length} waves, Jev ${p.policy.jev})`, ''];
  for (const w of p.waves) L.push(`- Wave ${w.wave}: ${w.stories.join(', ')}`);
  const unsched = p.stories.filter((s) => s.wave == null).map((s) => s.id);
  if (unsched.length) L.push(`- Not scheduled: ${unsched.join(', ')}`);
  L.push('', '## Dependencies and conflicts');
  for (const e of p.edges) {
    const head = e.relation === 'depends_on' ? `${e.from} depends on ${e.to}` : `${e.pair.join(' ↔ ')} ${e.relation}${e.order ? ` → ${e.order.join(' then ')}` : ''}`;
    L.push(`- ${head} [${e.source}, ${e.confidence}]: ${e.evidence.join('; ')}${e.jev_suggestion ? ` · Jev(shadow): ${e.jev_suggestion.label}${e.jev_suggestion.p != null ? ` ${e.jev_suggestion.p}` : ''}` : ''}`);
  }
  if (p.blocked_or_review_required.length) { L.push('', '## Needs a decision'); for (const r of p.blocked_or_review_required) L.push(`- [${r.kind}] ${r.stories.join(', ')}: ${r.reason}`); }
  if (p.assumptions.length) { L.push('', '## Assumptions'); for (const a of p.assumptions) L.push(`- ${a}`); }
  return L.join('\n');
}
