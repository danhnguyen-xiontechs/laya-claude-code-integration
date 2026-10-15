// laya-severity.mjs — shared logic for the Laya severity check (plan 1).
// Zero dependencies, Node >= 18. Used by classify-findings.mjs, assess.mjs and laya-eval.mjs.
//
// Laya is never required: every caller works when Laya is off, down or returns garbage.
// Claude's severity is always final; nothing here changes it.
//
// A/B copy: cfg.provider = laya (default) | jev picks who answers the SAME questions over the SAME
// state (TypeSafe Jev via the OpenRouter Decisions API, see decision-provider.mjs). Names that say
// "laya" (log keys, functions) are kept so the evaluation tooling reads both providers' logs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JEV_MODEL, PROVIDERS, decide, jevReady, resolveProvider } from './decision-provider.mjs';

export const LABELS = ['Critical', 'Major', 'Minor', 'Suggestion'];
export const RANK = { Critical: 3, Major: 2, Minor: 1, Suggestion: 0 };
export const MODES = ['off', 'shadow', 'recheck'];
export const MAX_RECHECKS = 3;
// Re-check policies: 'threshold' (differs and top probability >= a calibrated threshold) or
// 'stable-disagreement' (k shuffled-order answers agree with each other, disagree with Claude and
// cross the merge boundary; needs no threshold).
export const POLICIES = ['threshold', 'stable-disagreement'];
export const STABILITY_SCOPES = ['all', 'boundary'];

// Same meaning as references/review-method.md "Severity".
export const RUBRIC = {
  Critical: 'Must not merge: security hole, data leak or loss, build break.',
  Major: 'Should not merge: likely bug, broken contract, required rule broken.',
  Minor: 'Can merge, fix later: small quality or rule issue.',
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
  const extra = overrides ? ` Project overrides: ${clip(overrides, 300)}` : '';
  return { severity: { type: 'choice', instructions: `How severe is this code-review finding?${extra}`, criteria: { ...RUBRIC } } };
}

// ---------------------------------------------------------------------------
// Merge question (merge_gate): one call per PR, over the findings' text and Claude's severities
// ---------------------------------------------------------------------------

// The three merge assessments (same policy as merge() below). Laya answers with these exact labels.
export const MERGE_STATES = ['Blocked', 'Eligible with suggestions', 'Eligible'];
export const MERGE_ICON = { Blocked: '🔴', 'Eligible with suggestions': '🟡', Eligible: '🟢' };

const BY_SEVERITY = (a, b) => RANK[normLabel(b.severity ?? b.claude)] - RANK[normLabel(a.severity ?? a.claude)];

/**
 * The state Laya sees: one block per finding, worst first, so that a cut at max_len only drops
 * the mildest findings:
 *   Claude severity: <S> Finding: <issue> Evidence: <evidence> Impact: <impact> Project context: rule <rule>.
 * No findings → "No findings. The review is complete."
 */
export function buildMergeState(findings) {
  if (!findings.length) return { text: 'No findings. The review is complete.' };
  const text = [...findings].sort(BY_SEVERITY).map((f) => [
    `Claude severity: ${normLabel(f.severity ?? f.claude)}`,
    `Finding: ${f.issue ?? ''}`,
    f.evidence ? `Evidence: ${f.evidence}` : '',
    f.impact ? `Impact: ${f.impact}` : '',
    f.rule ? `Project context: rule ${f.rule}.` : '',
  ].filter(Boolean).join(' ')).join('\n\n');
  return { text };
}

/**
 * One 3-label question whose labels are the skill's own merge states ("S2", 2026-10-11).
 * On 4 sets x 16 severity combinations (real Laya): top label 59/64 but 5 missed blocks; with the
 * block threshold below, 60/64 and no missed block (threshold chosen on sets A-C, set D 16/16).
 */
export function buildMergeQuestion() {
  return {
    merge_gate: {
      type: 'choice',
      instructions: 'Based on the findings and their severity, is the PR Blocked, Eligible with suggestions, or Eligible?',
      criteria: {
        Blocked: 'At least one Critical or Major finding exists. The PR must not be merged.',
        'Eligible with suggestions': 'No Critical or Major findings exist, but one or more Minor or Suggestion findings exist. The PR can be merged with suggestions.',
        Eligible: 'No findings exist, and the review is complete. The PR is eligible to merge.',
      },
    },
  };
}

/**
 * Block threshold, not the top label: letting a Critical/Major PR through costs far more than
 * blocking a clean one. Default 0.29, chosen on sets A-C (lowest must-block P(Blocked) 0.299;
 * the 4 errors left are Minor-only PRs blocked). The margin is thin: re-measure after any change
 * to the wording or the Laya model.
 */
export const MERGE_BLOCK_THRESHOLD = 0.29;

/** Blocked when P(Blocked) >= threshold; otherwise the more likely of the two eligible states. */
export function decideMerge(probabilities, threshold = MERGE_BLOCK_THRESHOLD) {
  const p = (k) => probabilities[k] ?? 0;
  if (p('Blocked') >= threshold) return 'Blocked';
  return p('Eligible with suggestions') >= p('Eligible') ? 'Eligible with suggestions' : 'Eligible';
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

/** Merge assessment: Blocked (any Critical/Major) · Eligible with suggestions (only Minor/Suggestion) · Eligible (no findings). */
export function merge(c) {
  if (c.Critical || c.Major) return 'Blocked';
  return c.Minor || c.Suggestion ? 'Eligible with suggestions' : 'Eligible';
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
 *   XT_REVIEW_PR_LAYA_POLICY=threshold|stable-disagreement, XT_REVIEW_PR_LAYA_K=<2..8>.
 * recheck with policy 'threshold' and no threshold falls back to shadow (warning set);
 * 'stable-disagreement' needs no threshold.
 */
export function loadConfig({ env = process.env, dir = SKILL_DIR, overrides = {} } = {}) {
  const cfg = {
    url: 'http://localhost:8000', model: 'english', mode: 'shadow', threshold: null, mergeBlockThreshold: MERGE_BLOCK_THRESHOLD,
    provider: 'laya', jevModel: JEV_MODEL, policy: 'threshold', k: 3, stabilityScope: 'all',
    ...readJson(path.join(dir, 'laya.json')), ...readJson(path.join(dir, 'laya.local.json')),
  };
  // Provider: --provider (overrides) → XT_REVIEW_PR_DECIDER → DECISION_PROVIDER → config → laya.
  cfg.provider = resolveProvider({ flag: overrides.provider ?? env.XT_REVIEW_PR_DECIDER, env, cfg });
  if (env.JEV_MODEL) cfg.jevModel = env.JEV_MODEL;
  if (env.LAYA_URL) cfg.url = env.LAYA_URL;
  if (env.XT_REVIEW_PR_LAYA) cfg.mode = env.XT_REVIEW_PR_LAYA;
  if (env.XT_REVIEW_PR_LAYA_THRESHOLD) cfg.threshold = Number(env.XT_REVIEW_PR_LAYA_THRESHOLD);
  if (env.XT_REVIEW_PR_LAYA_MERGE_BLOCK) cfg.mergeBlockThreshold = Number(env.XT_REVIEW_PR_LAYA_MERGE_BLOCK);
  if (env.XT_REVIEW_PR_LAYA_POLICY) cfg.policy = env.XT_REVIEW_PR_LAYA_POLICY;
  if (env.XT_REVIEW_PR_LAYA_K) cfg.k = Number(env.XT_REVIEW_PR_LAYA_K);
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && k !== 'provider') cfg[k] = v;
  cfg.mode = String(cfg.mode).toLowerCase();
  if (!MODES.includes(cfg.mode)) throw new Error(`Laya mode must be one of ${MODES.join(', ')} (got "${cfg.mode}")`);
  if (cfg.threshold != null && !(cfg.threshold >= 0 && cfg.threshold <= 1)) throw new Error('threshold must be between 0 and 1');
  if (!(cfg.mergeBlockThreshold >= 0 && cfg.mergeBlockThreshold <= 1)) throw new Error('mergeBlockThreshold must be between 0 and 1');
  cfg.policy = String(cfg.policy ?? 'threshold').toLowerCase();
  if (!POLICIES.includes(cfg.policy)) throw new Error(`policy must be one of ${POLICIES.join(', ')} (got "${cfg.policy}")`);
  cfg.k = Number(cfg.k);
  if (!(Number.isInteger(cfg.k) && cfg.k >= 2 && cfg.k <= 8)) throw new Error('k must be an integer from 2 to 8');
  if (!STABILITY_SCOPES.includes(cfg.stabilityScope)) throw new Error(`stabilityScope must be one of ${STABILITY_SCOPES.join(', ')}`);
  cfg.questions = { introducedByPr: true, alreadyRaised: true, ...(cfg.questions ?? {}) };
  cfg.warning = null;
  if (cfg.mode === 'recheck' && cfg.policy === 'threshold' && cfg.threshold == null) {
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
 * The selected provider can answer: Laya → laya-serve answers /health; Jev → OPENROUTER_API_KEY is set.
 */
export async function providerUp(cfg, { env = process.env, fetchImpl = fetch } = {}) {
  return (cfg.provider ?? 'laya') === 'jev' ? jevReady(env) : alive(cfg.url, { fetchImpl });
}

/** Where the selected provider lives, for messages (never contains the key). */
export const providerWhere = (cfg) => ((cfg.provider ?? 'laya') === 'jev' ? 'OpenRouter (OPENROUTER_API_KEY not set)' : `no server at ${cfg.url}`);

/**
 * One call to the selected provider (cfg.provider, default laya) for a single-question choice.
 * Returns { label, confidence, probabilities, meta } or null on any error, timeout or when no
 * returned label is in `labels`. confidence = top probability for BOTH providers (the value the
 * thresholds were calibrated on); Jev's own confidence is kept as nativeConfidence.
 * meta = { provider, model, latencyMs, usage, cost } (usage/cost only from Jev).
 */
export async function askChoice(cfg, state, question, { labels, fetchImpl = fetch, timeoutMs = 10000, maxLen = 512, env = process.env } = {}) {
  const name = Object.keys(question)[0];
  const norm = (k) => labels.find((l) => l.toLowerCase() === String(k).trim().toLowerCase()) ?? null;
  const provider = cfg.provider ?? 'laya';
  if (!PROVIDERS.includes(provider)) return null;
  const res = await decide({ provider, state, questions: question, laya: { url: cfg.url, model: cfg.model, maxLen }, jev: { model: cfg.jevModel }, env, fetchImpl, timeoutMs });
  if (!res.ok) return null;
  const ans = res.answers[name];
  const probs = ans?.probabilities;
  if (!probs || typeof probs !== 'object') return null;
  const clean = {};
  for (const [k, v] of Object.entries(probs)) {
    const l = norm(k);
    if (l && typeof v === 'number') clean[l] = Number(v.toFixed(4));
  }
  const label = Object.keys(clean).sort((a, b) => clean[b] - clean[a])[0];
  if (!label) return null;
  const { provider: p, model, latencyMs, usage, cost } = res.meta;
  return { label, confidence: clean[label], probabilities: clean, ...(ans.confidence != null ? { nativeConfidence: ans.confidence } : {}), meta: { provider: p, model, latencyMs, usage, cost } };
}

/** Severity of one finding (labels = LABELS). */
export function askSeverity(cfg, state, question, opts = {}) {
  return askChoice(cfg, state, question, { ...opts, labels: LABELS });
}

/**
 * The merge_gate question for the whole PR. Returns
 * { label, confidence, pBlock, threshold, topLabel, probabilities } or null on any error.
 * label uses the block threshold (decideMerge); topLabel is Laya's own top answer.
 */
export async function askMerge(cfg, state, questions, opts = {}) {
  const a = await askChoice(cfg, state, questions, { maxLen: 1024, ...opts, labels: MERGE_STATES });
  if (!a) return null;
  const threshold = opts.blockThreshold ?? MERGE_BLOCK_THRESHOLD;
  const label = decideMerge(a.probabilities, threshold);
  return { label, confidence: a.probabilities[label] ?? 0, pBlock: a.probabilities.Blocked ?? 0, threshold, topLabel: a.label, probabilities: a.probabilities, ...(a.nativeConfidence != null ? { nativeConfidence: a.nativeConfidence } : {}), meta: a.meta };
}

/** One call with one retry. */
export async function retry(fn) {
  return (await fn()) ?? (await fn());
}

/** askSeverity with one retry. */
export async function askWithRetry(cfg, state, question, opts) {
  return retry(() => askSeverity(cfg, state, question, opts));
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
