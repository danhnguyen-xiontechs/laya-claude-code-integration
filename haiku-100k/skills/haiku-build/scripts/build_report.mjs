#!/usr/bin/env node
// Builds report.html and the measured fields of manifest.json for one haiku-build run. Nothing is hand-written.
//
// Usage: node build_report.mjs <runDir>
//   reads <runDir>/manifest.json (+ manifest.transcript for usage), writes evidence/phase-usage.json,
//   rewrites manifest.json (status and Haiku 100k fields), writes report.html. Prints one summary line.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageByPhase } from './usage_by_phase.mjs';
import { CSS } from './report_style.mjs';
import { findTranscript } from './find_transcript.mjs';

export const OPUS_WORD_LIMIT = 800;
// A plan is never rejected for length (as bmad-build-auto does for its spec): 800-1600 words is normal,
// over 1600 is saved with an `oversized` warning. The review arrays keep OPUS_WORD_LIMIT.
export const PLAN_OVERSIZE_WORDS = 1600;
export const DIFF_MAX_BYTES = 60_000;
export const DIFF_MAX_LINES = 1500;

export const wordCount = (t = '') => t.trim().split(/\s+/).filter(Boolean).length;

/** Output check for an Opus call: over the word limit goes to the failure policy, never truncated. */
export function checkOpusOutput(text, limit = OPUS_WORD_LIMIT) {
  const words = wordCount(text);
  return { words, ok: words <= limit, reason: words <= limit ? null : `over ${limit} words (${words})` };
}

export const SPEC_REQUIRED_HEADINGS = ['Goal & Intent', 'Tasks & Acceptance Criteria', 'Red Checks', 'Verification'];

/** A spec must have the four required headings as "## " lines. Optional sections may be absent or say none. */
export function checkSpecSections(text = '') {
  const headings = text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  const missing = SPEC_REQUIRED_HEADINGS.filter((h) => !headings.some((x) => x.includes(h)));
  return { ok: missing.length === 0, missing, reason: missing.length ? `missing heading: ${missing.join(', ')}` : null };
}

/** Review output must be a JSON array of findings. Anything else is a failed call. */
export function checkReviewJson(text) {
  let findings;
  try {
    const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    findings = JSON.parse(body);
  } catch {
    return { ok: false, findings: [], reason: 'not parseable JSON' };
  }
  if (!Array.isArray(findings)) return { ok: false, findings: [], reason: 'not a JSON array' };
  const bad = findings.findIndex((f) => !f || !['Major', 'Minor'].includes(f.severity) || !f.finding || !f.ref);
  if (bad >= 0) return { ok: false, findings, reason: `finding ${bad} missing severity, finding or ref` };
  return { ok: true, findings, reason: null };
}

/**
 * Saves the Opus plan output as <runDir>/spec.md and records the call in manifest.json opusCalls.
 * The text must be the Agent result returned to the main session (a foreground call), never a stand-in.
 * Empty, over-limit or section-less output is recorded as a failed call and spec.md is not written.
 * On success the manifest status becomes PLANNED and the sha256 of the saved text is recorded.
 */
export function savePlanSpec(runDir, text, { attempt = 1 } = {}) {
  const mf = path.join(runDir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const body = (text ?? '').trim();
  const check = !body
    ? { ok: false, words: 0, reason: 'empty output' }
    : (() => {
        const words = wordCount(body);
        const sections = checkSpecSections(body);
        return { ok: sections.ok, words, reason: sections.reason };
      })();
  const entry = {
    step: '02-plan',
    attempt,
    words: check.words,
    ok: check.ok,
    sha256: check.ok ? crypto.createHash('sha256').update(body).digest('hex') : null,
    reason: check.reason,
  };
  const oversized = check.ok && check.words > PLAN_OVERSIZE_WORDS;
  if (oversized) {
    entry.warnings = [`oversized (${check.words} words)`];
    m.warnings = [...new Set([...(m.warnings ?? []), 'oversized'])];
  }
  m.opusCalls = [...(m.opusCalls ?? []), entry];
  if (check.ok) {
    fs.writeFileSync(path.join(runDir, 'spec.md'), body + '\n');
    m.status = 'PLANNED';
  }
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return { ok: check.ok, reason: check.reason, words: check.words, sha256: entry.sha256, ...(oversized ? { warnings: entry.warnings } : {}) };
}

/**
 * Caps the diff text for the review pack. Whole files only: a file that does not fit is omitted and named.
 * Returns the stat line, the included diff text and the omitted file names.
 */
// Saves the step 04 review hand-back the way savePlanSpec saves the plan: raw text to evidence/review-raw.json,
// validated findings (resolution "open") to evidence/review.json and manifest.review, and one opusCalls entry
// with words and sha256 measured here, never typed by hand.
export function saveReview(runDir, text, { attempt = 1 } = {}) {
  const mf = path.join(runDir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const body = (text ?? '').trim();
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'evidence', 'review-raw.json'), body + '\n');
  const words = checkOpusOutput(body);
  const parsed = body ? checkReviewJson(body) : { ok: false, findings: [], reason: 'empty output' };
  const ok = Boolean(body) && words.ok && parsed.ok;
  const reason = !body ? 'empty output' : !words.ok ? words.reason : parsed.reason;
  const entry = {
    step: '04-review',
    attempt,
    words: words.words,
    ok,
    sha256: body ? crypto.createHash('sha256').update(body).digest('hex') : null,
    reason,
  };
  m.opusCalls = [...(m.opusCalls ?? []), entry];
  if (ok) {
    const findings = parsed.findings.map((f) => ({ ...f, resolution: 'open' }));
    fs.writeFileSync(path.join(runDir, 'evidence', 'review.json'), JSON.stringify(findings, null, 2));
    m.review = { status: 'done', findings };
    m.status = 'REVIEWED';
  }
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return { ok, reason, words: words.words, findings: ok ? m.review.findings.length : 0, sha256: entry.sha256 };
}

export function capDiff(diff, { maxBytes = DIFF_MAX_BYTES, maxLines = DIFF_MAX_LINES } = {}) {
  const sections = diff.split(/^(?=diff --git )/m).filter(Boolean);
  let bytes = 0, lines = 0;
  const kept = [], omitted = [];
  for (const s of sections) {
    const name = (s.match(/^diff --git a\/(\S+)/) ?? [, '(unknown)'])[1];
    const b = Buffer.byteLength(s), l = s.split('\n').length;
    if (bytes + b <= maxBytes && lines + l <= maxLines) { kept.push(s); bytes += b; lines += l; }
    else omitted.push(name);
  }
  return { text: kept.join(''), omitted, truncated: omitted.length > 0 };
}

/** Run status, one value. Order: plan failure, failing tests, skipped review, fixed, reported. */
export function runStatus(m) {
  if (m.planFailed) return 'PLAN_FAILED';
  if ((m.tests?.failed ?? 0) > 0) return 'TESTS_FAIL';
  if (m.review?.status === 'skipped') return 'REVIEW_SKIPPED';
  if (m.decision === 'fix_and_report') return 'FIXED';
  // A report built before step 05's question was answered must not look finished.
  if (!m.decision) return 'INCOMPLETE';
  return 'REPORTED';
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => (v == null ? 'not measured' : v.toLocaleString('en-US'));

export function renderHtml(m, u) {
  const status = runStatus(m);
  const notice = m.planFailed
    ? `<p class="warn"><b>INCOMPLETE.</b> The plan step failed (${esc(m.planFailure ?? 'no reason recorded')}). No spec was built, and no code change was made.</p>`
    : '';
  const review = m.review?.status === 'skipped'
    ? `<p class="warn">The code was <b>not independently reviewed</b>: the user skipped the review after a failed Opus call.</p>`
    : `<table><tr><th>Severity</th><th>Lens</th><th>Finding</th><th>Ref</th><th>Resolution</th></tr>${(m.review?.findings ?? []).map((f) => `<tr><td>${esc(f.severity)}</td><td>${esc(f.lens)}</td><td>${esc(f.finding)}</td><td>${esc(f.ref)}</td><td>${esc(f.resolution)}${f.reason ? `: ${esc(f.reason)}` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No findings.</td></tr>'}</table>`;
  const phaseRows = (u?.phases ?? []).map((p) => {
    if (p.turns == null) return `<tr><td>${esc(p.phase)}</td><td colspan="5">not measured</td></tr>`;
    const h = p.byClass.haiku, o = p.byClass.opus;
    return `<tr><td>${esc(p.phase)}</td><td>${num(h.turns)} Haiku / ${num(o.turns)} Opus</td><td>${num(h.input + h.cacheRead + h.cacheWrite)}</td><td>${num(o.input + o.cacheRead + o.cacheWrite)}</td><td>${num(p.opusCalls)}</td><td>${num(p.turns)}</td></tr>`;
  }).join('');
  const unassigned = u?.unassigned ? `<p>Unassigned turns (outside every phase window): ${num(u.unassigned.turns)}.</p>` : '';
  const overlap = u?.overlaps?.length ? `<p class="warn">Phase windows overlap: ${esc(u.overlaps.map((o) => o.join(' / ')).join('; '))}</p>` : '';
  const answers = m.planAnswers ?? [];
  const decisions = answers.length
    ? `<table><tr><th>Question</th><th>Answer</th><th>Spec section changed</th></tr>${answers.map((a) => `<tr><td>${esc(a.question)}</td><td>${esc(a.answer)}</td><td>${esc(a.section)}</td></tr>`).join('')}</table>`
    : '<p>No blocking questions were asked; the spec was built as written.</p>';
  const h = m.haiku ?? {};
  return `<!doctype html><html><head><meta charset="utf-8"><title>haiku-build ${esc(m.runId)}</title><style>${CSS()}
.warn{color:#8a4b00;background:#fff4e0;padding:6px 10px;border-radius:4px}</style></head><body>
<h1>haiku-build: ${esc(m.runId)}</h1>
<p><b>Status:</b> ${esc(status)} &middot; <b>Decision:</b> ${esc(m.decision ?? 'none')}</p>
${notice}
<p>${esc(m.task)}</p>
<h2>Verification</h2>
<p>Unit tests: ${num(m.tests?.passed)} passed, ${num(m.tests?.failed)} failed (${esc(m.tests?.command ?? '')}).</p>
<h2>Decisions</h2>${decisions}
<h2>Review</h2>${review}
<h2>Haiku input limit (100k per request)</h2>
<table><tr><th>Requests</th><th>Over 100k</th><th>Max input</th><th>Verification</th></tr>
<tr><td>${num(h.haiku_request_count)}</td><td>${num(h.haiku_requests_over_100k)}</td><td>${num(h.max_haiku_input_tokens)}</td><td>${esc(h.input_limit_verification)}${h.reason ? ` (${esc(h.reason)})` : ''}</td></tr></table>
<h2>Usage per phase</h2>
<table><tr><th>Phase</th><th>Turns</th><th>Haiku tokens</th><th>Opus tokens</th><th>Opus calls</th><th>All turns</th></tr>${phaseRows}</table>
${unassigned}${overlap}
<p class="muted">Tokens = input + cache read + cache write + output per model class. A missing number is "not measured", never zero.</p>
</body></html>`;
}

/** Sets the measured fields on the manifest (never typed by hand) and returns it. */
export function measure(m, u) {
  return {
    ...m,
    status: runStatus(m),
    haiku: { ...u.haiku, haiku_request_count: u.haiku.request_count, haiku_requests_over_100k: u.haiku.requests_over_100k },
  };
}

// Forward slashes work on every OS and survive shell quoting; a path with control characters was mangled.
export function normalizeTranscriptPath(p) {
  if (!p || /[\u0000-\u001f]/.test(p)) return null;
  return p.replace(/\\/g, '/');
}

/** manifest.transcript if it exists, else the transcript found by run id, else null. */
export function resolveTranscript(given, runId, find = findTranscript) {
  const p = normalizeTranscriptPath(given);
  if (p && fs.existsSync(p)) return { path: p, source: 'manifest' };
  const found = runId ? find(runId) : null;
  if (found) return { path: normalizeTranscriptPath(found), source: 'lookup' };
  return { path: null, source: given ? 'manifest path not found' : 'none' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: build_report.mjs <runDir>'); process.exit(2); }
  const mf = path.join(dir, 'manifest.json');
  const m0 = JSON.parse(fs.readFileSync(mf, 'utf8'));
  // A transcript path typed through a shell can lose its backslashes; fall back to the lookup by run id.
  const t = resolveTranscript(m0.transcript, m0.runId);
  if (t.path && t.path !== m0.transcript) m0.transcript = t.path;
  m0.transcriptSource = t.source;
  const u = usageByPhase({ mainFile: t.path, phases: m0.phases ?? [] });
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence', 'phase-usage.json'), JSON.stringify(u, null, 2));
  const m = measure(m0, u);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  fs.writeFileSync(path.join(dir, 'report.html'), renderHtml(m, u));
  console.log(`report: ${m.status}, decision ${m.decision ?? 'none'}, Haiku limit ${m.haiku.input_limit_verification} -> ${path.join(dir, 'report.html')}`);
}
