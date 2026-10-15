// finding-questions.mjs — the two extra per-finding yes/no questions (introduced_by_pr, already_raised),
// the shuffled-order severity samples behind the stable-disagreement policy, and the project rule-id
// severities used by the `rules` column of the logs. Zero dependencies, Node >= 18.
//
// Everything here is shadow/log data: nothing changes a severity. The facts the questions need are
// computed in code (patch line status, BM25 over existing threads) and passed to the provider as state.
import { LABELS, isBlocking, neutralize, normLabel } from './laya-severity.mjs';

const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const normPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^[ab]\//, '').trim();

// ---------------------------------------------------------------------------
// Patch: is a line added or modified by this PR?
// ---------------------------------------------------------------------------

/**
 * Parses a unified diff into per-file new-side line kinds:
 *   Map(path → { changeType, oldPath, lines: Map(newLine → 'added'|'modified'|'context') })
 * '+' lines in a change block that also removes lines are 'modified'; '+' lines with no removal
 * in their block are 'added'.
 */
export function annotatePatch(text) {
  const files = new Map();
  let f = null, newLine = 0, inHunk = false, block = [], blockHasDel = false;
  const flush = () => {
    for (const n of block) f.lines.set(n, blockHasDel ? 'modified' : 'added');
    block = []; blockHasDel = false;
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      if (f) flush();
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      f = { path: m ? m[2] : null, oldPath: m ? m[1] : null, changeType: 'modified', lines: new Map() };
      if (f.path) files.set(f.path, f);
      inHunk = false;
      continue;
    }
    if (!f) continue;
    if (!inHunk) {
      if (line.startsWith('new file mode')) f.changeType = 'added';
      else if (line.startsWith('deleted file mode')) f.changeType = 'deleted';
      else if (line.startsWith('rename to ')) { f.changeType = 'renamed'; files.delete(f.path); f.path = line.slice(10); files.set(f.path, f); }
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { flush(); newLine = Number(h[1]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith('+')) block.push(newLine++);
    else if (line.startsWith('-')) blockHasDel = true;
    else if (line.startsWith(' ')) { flush(); f.lines.set(newLine++, 'context'); }
    else if (!line.startsWith('\\')) { flush(); inHunk = false; }
  }
  if (f) flush();
  return files;
}

/**
 * Where the finding's cited line(s) sit in the patch. Returns
 *   { kind: 'added'|'modified'|'context'|'unchanged'|'file-not-in-pr'|'no-line', lines, file, text }
 * kind is the strongest over [line..endLine]: added/modified beat context beat unchanged.
 */
export function citedLineStatus(patch, f) {
  const file = normPath(f.file);
  const line = Number(f.line);
  if (!file) return { kind: 'no-line', file: null, lines: null, text: 'The finding cites no file.' };
  const pf = patch.get(file) ?? [...patch.values()].find((x) => x.path && (x.path.endsWith(`/${file}`) || file.endsWith(`/${x.path}`)));
  if (!pf) return { kind: 'file-not-in-pr', file, lines: null, text: `The cited file ${file} is not changed by this PR.` };
  if (!Number.isInteger(line) || line < 1) {
    const kind = pf.changeType === 'added' ? 'added' : 'no-line';
    return { kind, file, lines: null, text: pf.changeType === 'added' ? `The cited file ${file} is a new file added by this PR.` : `The finding cites ${file} without a line; the file is changed by this PR.` };
  }
  const end = Number.isInteger(Number(f.endLine)) && Number(f.endLine) >= line ? Math.min(Number(f.endLine), line + 50) : line;
  const kinds = [];
  for (let n = line; n <= end; n++) kinds.push(pf.lines.get(n) ?? 'unchanged');
  const kind = ['added', 'modified', 'context', 'unchanged'].find((k) => kinds.includes(k)) ?? 'unchanged';
  const where = end > line ? `${file}:${line}-${end}` : `${file}:${line}`;
  const text = {
    added: pf.changeType === 'added' ? `The cited line ${where} is in a new file added by this PR.` : `The cited line ${where} is a line added by this PR.`,
    modified: `The cited line ${where} is a line modified by this PR (it replaces earlier code).`,
    context: `The cited line ${where} is unchanged context next to this PR's changes; it existed before this PR.`,
    unchanged: `The cited line ${where} is not changed by this PR; it existed before this PR.`,
  }[kind];
  return { kind, file, lines: [line, end], text };
}

export const YES_NO = ['yes', 'no'];

export function buildIntroducedState(f, status) {
  return {
    issue: clip(neutralize(f.issue), 400),
    evidence: clip(neutralize(f.evidence), 600),
    cited_lines: status.text,
  };
}

export function buildIntroducedQuestion() {
  return {
    introduced_by_pr: {
      type: 'choice',
      instructions: "Is this problem introduced by this PR's change, rather than pre-existing code?",
      criteria: {
        yes: "The problem is caused by code this PR adds or modifies.",
        no: 'The problem was already in the code before this PR; the PR did not cause it.',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Existing threads: local BM25, top passages
// ---------------------------------------------------------------------------

const STOP = new Set('a an and are as at be but by for from has have if in into is it its no not of on or so such that the their then there these this to was were will with without when which who can may must should would via per than also only any all each other our your we you they them do does did done just more most some very one two'.split(' '));

/** Lower-case word tokens; identifiers are kept whole and also split on camelCase / snake_case. */
export function tokenize(text) {
  const out = [];
  for (const raw of String(text ?? '').match(/[A-Za-z0-9_]+/g) ?? []) {
    const whole = raw.toLowerCase();
    const parts = raw.split(/_+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map((p) => p.toLowerCase()).filter(Boolean);
    for (const t of new Set([whole, ...parts])) if (t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)) out.push(t);
  }
  return out;
}

/**
 * Splits threads into passages (paragraphs of each comment; short paragraphs merged with the next),
 * so one long summary comment that lists many findings is matched per finding.
 */
export function threadPassages(threads, { minChars = 200, maxChars = 1500 } = {}) {
  const out = [];
  for (const t of threads ?? []) {
    for (const c of t.comments ?? []) {
      const paras = String(c.body ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      let buf = '';
      const push = () => { if (buf.trim()) out.push({ threadId: t.id ?? null, status: t.status ?? null, file: t.file ?? null, line: t.line ?? null, text: buf.trim().slice(0, maxChars) }); buf = ''; };
      for (const p of paras) {
        buf = buf ? `${buf}\n\n${p}` : p;
        if (buf.length >= minChars) push();
      }
      push();
    }
  }
  return out;
}

/** Okapi BM25 over passages. Returns [{ ...passage, score }] sorted by score, score > 0 only. */
export function bm25(query, passages, { k1 = 1.2, b = 0.75 } = {}) {
  const docs = passages.map((p) => tokenize(`${p.file ?? ''} ${p.text}`));
  const N = docs.length;
  if (!N) return [];
  const avg = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(tokenize(query))];
  return passages.map((p, i) => {
    const tf = new Map();
    for (const t of docs[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * docs[i].length) / avg)));
    }
    return { ...p, score: Number(score.toFixed(4)) };
  }).filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
}

/** The finding text BM25 searches with. */
export const findingQuery = (f) => [f.rule, f.issue, f.evidence, String(f.file ?? '').split(/[\\/]/).pop()].filter(Boolean).join(' ');

/** Top `n` distinct passages for a finding, each truncated to `chars`. */
export function similarThreads(f, passages, { n = 3, chars = 400 } = {}) {
  const seen = new Set();
  const out = [];
  for (const p of bm25(findingQuery(f), passages)) {
    const key = p.text.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ threadId: p.threadId, status: p.status, file: p.file, line: p.line, score: p.score, text: clip(p.text.replace(/\s+/g, ' '), chars) });
    if (out.length === n) break;
  }
  return out;
}

export function buildRaisedState(f, similar) {
  return {
    issue: clip(neutralize(f.issue), 400),
    evidence: clip(neutralize(f.evidence), 300),
    location: f.file ? `${normPath(f.file)}${f.line ? `:${f.line}` : ''}` : 'none',
    existing_threads: similar.map((s, i) => `Thread ${i + 1}${s.file ? ` (${s.file}${s.line ? `:${s.line}` : ''})` : ''}${s.status ? ` [${s.status}]` : ''}: ${s.text}`).join('\n\n'),
  };
}

export function buildRaisedQuestion() {
  return {
    already_raised: {
      type: 'choice',
      instructions: 'Is this point already raised in an existing review thread?',
      criteria: {
        yes: 'One of the existing threads already raises the same problem at the same place.',
        no: 'None of the existing threads raises this problem.',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Stable disagreement: k severity samples with the option order shuffled
// ---------------------------------------------------------------------------

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * k distinct label orders, none equal to the canonical order, chosen deterministically from `seed`
 * (the finding id), so a rerun sends the same requests.
 */
export function shuffledOrders(seed, k, labels = LABELS) {
  const pool = permutations(labels).filter((p) => p.join() !== labels.join());
  let h = fnv(String(seed));
  const out = [];
  while (out.length < Math.min(k, pool.length)) {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

/** The severity question with its criteria in `order` (same wording otherwise). */
export function reorderQuestion(question, order) {
  const [name, q] = Object.entries(question)[0];
  return { [name]: { ...q, criteria: Object.fromEntries(order.map((l) => [l, q.criteria[l]])) } };
}

// One letter per option for the logged orders: C=Critical, M=Major, m=Minor, S=Suggestion.
const ORDER_CODE = { Critical: 'C', Major: 'M', Minor: 'm', Suggestion: 'S' };

/**
 * Summary of the k samples: { k, answered, labels, orders, stable, label, share, meanP }.
 * stable = every one of the k calls answered and all gave the same label.
 */
export function summarizeStability(samples, orders) {
  const labels = samples.map((s) => normLabel(s?.label));
  const answered = labels.filter(Boolean);
  const tally = new Map();
  for (const l of answered) tally.set(l, (tally.get(l) ?? 0) + 1);
  const [label, count] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const ps = samples.map((s) => (label && s?.probabilities ? s.probabilities[label] ?? 0 : null)).filter((p) => p != null);
  return {
    k: samples.length,
    answered: answered.length,
    labels,
    orders: orders.map((o) => o.map((l) => ORDER_CODE[l] ?? l).join('')),
    stable: samples.length > 0 && answered.length === samples.length && count === samples.length,
    label,
    share: samples.length ? Number((count / samples.length).toFixed(3)) : 0,
    meanP: ps.length ? Number((ps.reduce((s, p) => s + p, 0) / ps.length).toFixed(4)) : null,
  };
}

/**
 * The stable-disagreement flag: the k answers agree with each other, disagree with Claude, and cross
 * the merge boundary. direction 'up' = the provider would block where Claude does not (possible missed block).
 */
export function stableFlag(claude, stability) {
  if (!stability?.stable || !stability.label || stability.label === claude) return { wouldFlag: false, direction: null };
  if (isBlocking(claude) === isBlocking(stability.label)) return { wouldFlag: false, direction: null };
  return { wouldFlag: true, direction: isBlocking(stability.label) ? 'up' : 'down' };
}

/** Re-check picks for stable-disagreement: upward first, then higher mean probability; at most `max`. */
export function pickStableRechecks(rows, { mode, max = 3 }) {
  if (mode !== 'recheck') return new Set();
  const cands = rows.filter((r) => r.wouldFlag);
  cands.sort((a, b) => ((b.direction === 'up') - (a.direction === 'up')) || ((b.stability?.meanP ?? 0) - (a.stability?.meanP ?? 0)));
  return new Set(cands.slice(0, max).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Project rule ids → default severity (the `rules` column of the logs)
// ---------------------------------------------------------------------------

const ID_RE = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)/;

/** "TH-01/04/05" → TH-01, TH-04, TH-05; "TH-02 / C-01" → TH-02, C-01. */
function expandIds(head) {
  const out = [];
  let prefix = null;
  for (const part of head.split(/\s*\/\s*/)) {
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(part)) { out.push(part); prefix = part.includes('-') ? part.replace(/-[^-]+$/, '-') : null; }
    else if (prefix && /^[A-Z0-9]+$/.test(part)) out.push(prefix + part);
    else break;
  }
  return out;
}

const RANK_OF = { Critical: 3, Major: 2, Minor: 1, Suggestion: 0 };

/**
 * Reads a project rules file: bullets "- <ID> <check> — <Severity>" anywhere, then the
 * "## Severity overrides" section ("- Critical: A, B, TH-01/04" and "A and B are Major").
 * An id listed with several defaults keeps the highest. Override items with extra words
 * ("D-07 entity") are conditional and are not applied. Returns Map(ID → severity).
 */
export function projectRuleSeverities(rulesText) {
  const map = new Map();
  let inOverrides = false;
  const overrides = [];
  for (const raw of String(rulesText ?? '').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(raw)) { inOverrides = /^#{1,6}\s*severity overrides?\b/i.test(raw); continue; }
    const m = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (!m) continue;
    if (inOverrides) { overrides.push(m[1]); continue; }
    const head = /^([A-Z][A-Z0-9-]*(?:\s*\/\s*[A-Z0-9][A-Z0-9-]*)*)\s/.exec(m[1]);
    const sev = /[—–]\s*(Critical|Major|Minor|Suggestion)\b/.exec(m[1]) ?? /\s-\s(Critical|Major|Minor|Suggestion)\b/.exec(m[1]);
    if (!head || !sev) continue;
    for (const id of expandIds(head[1])) {
      const cur = map.get(id);
      if (!cur || RANK_OF[sev[1]] > RANK_OF[cur]) map.set(id, sev[1]);
    }
  }
  for (const line of overrides) {
    for (const clause of line.split(';').map((c) => c.trim())) {
      let label = null, items = [];
      const lead = /^(Critical|Major|Minor|Suggestion)\s*:\s*(.*)$/.exec(clause);
      const tail = /^(.*?)\s+(?:is|are)\s+(Critical|Major|Minor|Suggestion)\.?$/.exec(clause);
      if (lead) { label = lead[1]; items = lead[2].split(','); }
      else if (tail) { label = tail[2]; items = tail[1].split(/,|\band\b/); }
      else continue;
      for (const it of items.map((x) => x.trim().replace(/\.$/, '')).filter(Boolean)) {
        const ids = expandIds(it);
        if (!ids.length || it.replace(/\s*\/\s*/g, '/').split(/\s+/).length > 1) continue; // conditional ("D-07 entity")
        for (const id of ids) map.set(id, label);
      }
    }
  }
  return map;
}

/** The project's default severity for a finding's rule id, or null when the rule is not a project id. */
export function projectRuleSeverity(f, map) {
  if (!map?.size) return null;
  const rule = String(f.rule ?? '').trim().toUpperCase();
  if (!rule) return null;
  if (map.has(rule)) return map.get(rule);
  const m = ID_RE.exec(rule);
  for (const id of m ? expandIds(rule.split(/\s+/)[0]) : []) if (map.has(id)) return map.get(id);
  return null;
}

