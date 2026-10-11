// laya-severity.mjs — shared logic for the Laya severity check (plan 1).
// Zero dependencies, Node >= 18. Used by classify-findings.mjs, assess.mjs and laya-eval.mjs.
//
// Laya is never required: every caller works when Laya is off, down or returns garbage.
// Claude's severity is always final; nothing here changes it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LABELS = ['Critical', 'Major', 'Minor', 'Suggestion'];
export const RANK = { Critical: 3, Major: 2, Minor: 1, Suggestion: 0 };
export const MODES = ['off', 'shadow', 'recheck'];
export const MAX_RECHECKS = 3;

// Same meaning as references/review-method.md "Severity".
export const RUBRIC = {
  Critical: 'Must not merge: security hole, real secret, data loss or corruption, build break, severe production failure.',
  Major: 'Should not merge: likely bug or regression, missing guard, broken contract, unmet requirement, mandatory project-rule violation, significant maintainability risk.',
  Minor: 'Safe to merge but should be fixed: localised quality issue, small rule deviation.',
  Suggestion: 'Optional improvement.',
};

/** Critical and Major block the merge. */
export const isBlocking = (sev) => sev === 'Critical' || sev === 'Major';

/** Normalizes a label ("major", " MAJOR ") to one of LABELS, or null. */
export function normLabel(x) {
  const s = String(x ?? '').trim().toLowerCase();
  return LABELS.find((l) => l.toLowerCase() === s) ?? null;
}

// ---------------------------------------------------------------------------
// Input for Laya: no Claude severity, no severity words
// ---------------------------------------------------------------------------

// Words that leak a severity judgement into the text Laya reads.
const SEVERITY_WORDS = /\b(critical(?:ly)?|major|minor|blockers?|blocking|severe(?:ly)?|severity|nit(?:pick)?s?|trivial|cosmetic|low[- ]priority|high[- ]priority|must[- ]fix|should[- ]fix|optional|suggestions?|p[0-3])\b/gi;

/** Removes severity words and collapses whitespace. */
export function neutralize(text) {
  return String(text ?? '').replace(SEVERITY_WORDS, ' ').replace(/[ \t]+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The state Laya sees for one finding. */
export function buildState(f) {
  return {
    rule: clip(neutralize(f.rule), 60),
    issue: clip(neutralize(f.issue), 400),
    evidence: clip(neutralize(f.evidence), 600),
    impact: clip(neutralize(f.impact), 300),
  };
}

/** "## Severity overrides" section of a project rules file (bullets only), or ''. */
export function extractOverrides(rulesText) {
  const lines = String(rulesText ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s*severity overrides?\b/i.test(l));
  if (start === -1) return '';
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    if (l.trim()) out.push(l.trim());
  }
  return clip(out.join(' '), 600);
}

/** The Laya question: one choice over the four labels, described by the rubric. */
export function buildQuestion(overrides = '') {
  const extra = overrides ? ` Project severity overrides (these win over the general rules): ${overrides}` : '';
  return {
    severity: {
      type: 'choice',
      instructions: `How severe is this verified code-review finding for merging the pull request?${extra}`,
      criteria: { ...RUBRIC },
    },
  };
}

// ---------------------------------------------------------------------------
// Rule baseline (frozen before evaluation — do not tune on the held-out set)
// ---------------------------------------------------------------------------

export function ruleBaseline(f) {
  const rule = String(f.rule ?? '');
  const text = `${rule} ${f.issue ?? ''}`;
  if (/\b(security|secret|credential|injection|xss|csrf|ssrf)\b/i.test(text)) return 'Critical';
  if (/^AC\d*\b/i.test(rule) || /\b(bug|regression|contract)\b/i.test(rule)) return 'Major';
  if (/\b(perf|performance|test gap|tests?|maintainability)\b/i.test(rule)) return 'Minor';
  if (/^(R|S|§)\s?\d+/i.test(rule)) return 'Minor';
  return 'Suggestion';
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * One finding: Claude's severity vs Laya's answer.
 * Returns { status: 'unavailable'|'agree'|'differs', wouldFlag }.
 * wouldFlag = differs and confidence >= threshold (threshold null → never).
 */
export function compareOne(claude, laya, threshold) {
  if (!laya || !normLabel(laya.label) || typeof laya.confidence !== 'number') return { status: 'unavailable', wouldFlag: false };
  if (normLabel(laya.label) === claude) return { status: 'agree', wouldFlag: false };
  const wouldFlag = threshold != null && laya.confidence >= threshold;
  return { status: 'differs', wouldFlag };
}

/**
 * Picks the findings Claude re-checks: only in recheck mode, at most `max`.
 * Priority: merge-boundary crossings first, then higher confidence.
 * rows: [{ id, claude, laya: {label, confidence}, wouldFlag }]. Returns Set of ids.
 */
export function pickRechecks(rows, { mode, max = MAX_RECHECKS }) {
  if (mode !== 'recheck') return new Set();
  const cands = rows.filter((r) => r.wouldFlag);
  cands.sort((a, b) => {
    const ca = isBlocking(a.claude) !== isBlocking(normLabel(a.laya.label));
    const cb = isBlocking(b.claude) !== isBlocking(normLabel(b.laya.label));
    return (cb - ca) || (b.laya.confidence - a.laya.confidence);
  });
  return new Set(cands.slice(0, max).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Score, verdict, merge (Claude's final severities only; Laya takes no part)
// ---------------------------------------------------------------------------

export function counts(findings) {
  const c = { Critical: 0, Major: 0, Minor: 0, Suggestion: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

/** Unchanged formula; informational only — decides neither verdict nor merge. */
export function score(c) {
  const s = 100 - 30 * c.Critical - 12 * c.Major - 4 * c.Minor - Math.min(5, c.Suggestion);
  return Math.max(0, Math.min(100, s));
}

export function verdict(c) {
  if (c.Critical || c.Major) return 'Request Changes';
  if (c.Minor || c.Suggestion) return 'Approve with Suggestions';
  return 'Approve';
}

export function merge(c) {
  return c.Critical || c.Major ? 'Blocked' : 'Eligible';
}

// ---------------------------------------------------------------------------
// Findings file
// ---------------------------------------------------------------------------

/** Reads pr-<id>.findings.json: an array, or { pr?, findings: [] }. Validates ids and severities. */
export function readFindings(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const list = Array.isArray(raw) ? raw : raw?.findings;
  if (!Array.isArray(list)) throw new Error('findings file must be an array or { "findings": [...] }');
  const seen = new Set();
  const findings = list.map((f, i) => {
    const id = String(f?.id ?? '').trim();
    if (!id) throw new Error(`findings[${i}].id is required`);
    if (seen.has(id)) throw new Error(`duplicate finding id "${id}"`);
    seen.add(id);
    const severity = normLabel(f.severity);
    if (!severity) throw new Error(`findings[${i}] (${id}): severity must be one of ${LABELS.join(', ')}`);
    return { ...f, id, severity };
  });
  return { pr: Array.isArray(raw) ? null : raw.pr ?? null, findings };
}

// ---------------------------------------------------------------------------
// Laya config and client
// ---------------------------------------------------------------------------

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };

/**
 * laya.json (committed defaults) + laya.local.json (per machine, gitignored) + env:
 *   XT_REVIEW_PR_LAYA=off|shadow|recheck, XT_REVIEW_PR_LAYA_THRESHOLD=<0..1>, LAYA_URL.
 * recheck without a threshold falls back to shadow (warning set).
 */
export function loadConfig({ env = process.env, dir = SKILL_DIR, overrides = {} } = {}) {
  const cfg = {
    url: 'http://localhost:8000', model: 'english', mode: 'shadow', threshold: null,
    ...readJson(path.join(dir, 'laya.json')), ...readJson(path.join(dir, 'laya.local.json')),
  };
  if (env.LAYA_URL) cfg.url = env.LAYA_URL;
  if (env.XT_REVIEW_PR_LAYA) cfg.mode = env.XT_REVIEW_PR_LAYA;
  if (env.XT_REVIEW_PR_LAYA_THRESHOLD) cfg.threshold = Number(env.XT_REVIEW_PR_LAYA_THRESHOLD);
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) cfg[k] = v;
  cfg.mode = String(cfg.mode).toLowerCase();
  if (!MODES.includes(cfg.mode)) throw new Error(`Laya mode must be one of ${MODES.join(', ')} (got "${cfg.mode}")`);
  if (cfg.threshold != null && !(cfg.threshold >= 0 && cfg.threshold <= 1)) throw new Error('threshold must be between 0 and 1');
  cfg.warning = null;
  if (cfg.mode === 'recheck' && cfg.threshold == null) {
    cfg.mode = 'shadow';
    cfg.warning = 'recheck needs a calibrated threshold; running in shadow mode';
  }
  return cfg;
}

/** true when laya-serve answers /health. */
export async function alive(url, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  try {
    const r = await fetchImpl(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

/**
 * One Laya call for one finding. Returns { label, confidence, probabilities } or null on any
 * error, timeout or a label outside LABELS. confidence = top probability (Laya's answer
 * confidence; uncalibrated until laya-eval.mjs has been run).
 */
export async function askSeverity(cfg, state, question, { fetchImpl = fetch, timeoutMs = 10000, maxLen = 512 } = {}) {
  try {
    const r = await fetchImpl(`${cfg.url.replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions: question, model: cfg.model || 'english', max_len: maxLen }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const probs = body?.answers?.severity?.probabilities;
    if (!probs || typeof probs !== 'object') return null;
    const clean = {};
    for (const [k, v] of Object.entries(probs)) {
      const l = normLabel(k);
      if (l && typeof v === 'number') clean[l] = Number(v.toFixed(4));
    }
    const label = Object.keys(clean).sort((a, b) => clean[b] - clean[a])[0];
    if (!label) return null;
    return { label, confidence: clean[label], probabilities: clean };
  } catch { return null; }
}

/** askSeverity with one retry. */
export async function askWithRetry(cfg, state, question, opts) {
  return (await askSeverity(cfg, state, question, opts)) ?? (await askSeverity(cfg, state, question, opts));
}

/** Runs fn over items with at most `limit` in flight; keeps order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
