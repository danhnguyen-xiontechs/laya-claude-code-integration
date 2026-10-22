#!/usr/bin/env node
// Shared v3 helpers for haiku-build and haiku-build-auto: AC traceability, failure diagnostics, one reusable
// context bundle with source hashes, and run metrics. Pure functions, no network. The CLI prints one JSON line.
//
// Usage: node v3.mjs acmap <spec.md>        AC map of a spec and its summary
//        node v3.mjs context <runDir>       builds or refreshes evidence/context.json
//        node v3.mjs metrics <runDir>       run metrics of manifest.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capDiff } from './build_report.mjs';

/** Names of the context bundle parts, in render order. */
export const PART_NAMES = ['acs', 'locations', 'diff', 'tests'];

const AC_LINE = /^\s*(?:[-*]\s+)?\**(AC\d+[a-z]?)\**\s*[:.]/;
const CHECKED_BY = /checked by\s+`([^`]+)`(?:\s+"([^"]+)")?/i;
const PATH_TOKEN = /`([^`\s]*\/[^`\s]*|[^`\s/]+\.(?:mjs|cjs|js|ts|md|json|html|css|yml|yaml|txt))`/;

/** sha256 hex of a string. */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Lines under a level-2 heading that matches headingRe, up to the next level-2 heading, or null. */
function sectionOf(specText, headingRe) {
  const lines = String(specText).split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s/.test(l) && headingRe.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** The AC line at index i plus its indented continuation lines, joined with newlines. */
function acBlock(sec, i) {
  const out = [sec[i]];
  for (let j = i + 1; j < sec.length; j += 1) {
    const l = sec[j];
    if (AC_LINE.test(l)) break;
    if (l.trim() === '') { out.push(''); continue; }
    if (!/^\s/.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

/**
 * Maps each AC of a spec to its target file, test file and section 8 command.
 * Returns [{id, text, target, test, command, missing: ['target'|'test'|'command', ...]}]; missing values are null.
 */
export function parseAcMap(specText = '') {
  const sec6 = sectionOf(specText, /tasks|acceptance/i) ?? String(specText).split(/\r?\n/);
  const sec8 = sectionOf(specText, /verification/i) ?? [];
  const firstAc = sec6.findIndex((l) => AC_LINE.test(l));
  const before = firstAc < 0 ? sec6 : sec6.slice(0, firstAc);
  const fileTasks = before
    .filter((l) => /^(?:\d+\.|[-*])\s/.test(l))
    .map((l) => (l.match(PATH_TOKEN) ?? [])[1])
    .filter(Boolean);
  const out = [];
  sec6.forEach((line, i) => {
    const idMatch = line.match(AC_LINE);
    if (!idMatch) return;
    const block = acBlock(sec6, i);
    const checked = block.match(CHECKED_BY);
    const testPath = checked ? checked[1] : null;
    const test = checked ? (checked[2] ? `${checked[1]} "${checked[2]}"` : checked[1]) : null;
    const text = block.replace(AC_LINE, '').replace(CHECKED_BY, '').replace(/\s+/g, ' ').trim();
    const target = (text.match(PATH_TOKEN) ?? [])[1] ?? (fileTasks.length === 1 ? fileTasks[0] : null);
    const cmdLine = testPath ? sec8.find((l) => l.includes(testPath) && /\bnode\b/.test(l)) : undefined;
    const command = cmdLine ? cmdLine.replace(/`/g, '').trim() : null;
    const missing = [];
    if (!target) missing.push('target');
    if (!testPath) missing.push('test');
    else if (!command) missing.push('command');
    out.push({ id: idMatch[1], text, target, test, command, missing });
  });
  return out;
}

/**
 * Counts for an AC map: { total, mapped, missing: [ids with any missing mapping] }.
 */
export function acSummary(map = []) {
  const missing = map.filter((a) => a.missing.length > 0).map((a) => a.id);
  return { total: map.length, mapped: map.length - missing.length, missing };
}

/**
 * Normalises a log for fingerprinting: drops timestamps, durations (per test, and the node:test duration_ms
 * summary in spec and TAP output), absolute paths, hex ids and :line:col.
 * Returns the normalised text (lines trimmed, empty lines removed).
 */
export function normalizeLog(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '')
    .replace(/\(\s*\d+(?:\.\d+)?\s*ms\s*\)/g, '')
    .replace(/\b(duration(?:_ms)?|elapsed|time)\b(?:\s*[:=]?\s*)\d+(?:\.\d+)?(?:\s*m?s\b)?/gi, '$1')
    .replace(/file:\/\/[^\s'"()]*/g, '<path>')
    .replace(/[A-Za-z]:[\\/][^\s'"():]*/g, '<path>')
    .replace(/(^|[\s('"`])\/[^\s'"():]+/gm, '$1<path>')
    .replace(/:\d+(?::\d+)?/g, '')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi, '<hex>')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** sha256 of the normalised log, or null when the normalised log is empty. */
export function logFingerprint(text = '') {
  const norm = normalizeLog(text);
  return norm === '' ? null : sha(norm);
}

/** Failure count from the last "fail N" in a log, or null when the log has none. */
export function failedCount(log = '') {
  const hits = [...String(log).matchAll(/\bfail\s+(\d+)\b/gi)];
  return hits.length ? Number(hits.at(-1)[1]) : null;
}

/**
 * Category of a failure from its log and kind (test | review | plan | build).
 * Returns one of: test-failure | assertion | syntax | missing-module | timeout | review-invalid | plan-invalid | unknown.
 */
export function categorize(log = '', kind = 'test') {
  const t = String(log);
  if (/SyntaxError|Unexpected token/.test(t)) return 'syntax';
  if (/ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/.test(t)) return 'missing-module';
  if (/ETIMEDOUT|timed out/i.test(t)) return 'timeout';
  if (/AssertionError|ERR_ASSERTION/.test(t)) return 'assertion';
  if (kind === 'review') return 'review-invalid';
  if (kind === 'plan') return 'plan-invalid';
  if (kind === 'test') return 'test-failure';
  return 'unknown';
}

/** The latest diagnostic of one kind in a manifest, or null. */
export function lastDiagnostic(m = {}, kind = 'test') {
  return (m?.diagnostics ?? []).filter((d) => d.kind === kind).at(-1) ?? null;
}

/** Progress of an attempt against the previous diagnostic: first | same | improved | worse | changed. */
function progressOf(previous, fingerprint, failed) {
  if (!previous) return 'first';
  if (fingerprint !== null && fingerprint === previous.fingerprint) return 'same';
  if (failed == null || previous.failed == null || failed === previous.failed) return 'changed';
  return failed < previous.failed ? 'improved' : 'worse';
}

/**
 * Diagnostic of one failed attempt. Input: { kind, log, failed, previous, attempt, at }.
 * Returns { attempt, kind, fingerprint, category, failed, progress, repeated, summary, at }; summary is one line.
 */
export function diagnoseFailure({ kind = 'test', log = '', failed = null, previous = null, attempt = null, at = new Date().toISOString() } = {}) {
  const fingerprint = logFingerprint(log);
  const category = categorize(log, kind);
  const progress = progressOf(previous, fingerprint, failed);
  const repeated = progress === 'same';
  const fp = fingerprint ? `fingerprint ${fingerprint.slice(0, 12)}` : 'no log';
  const count = failed == null ? '' : `; ${failed} failed`;
  const summary = `${category}; ${progress}; ${fp}${count}`;
  return { attempt, kind, fingerprint, category, failed, progress, repeated, summary, at };
}

/** Hashes of the sources of each part. */
function sourceHashes({ specText = '', answers = [], diff = '', tests = null, files = [] } = {}) {
  return {
    acs: sha(JSON.stringify({ specText, answers })),
    locations: sha(JSON.stringify({ specText, files })),
    diff: sha(diff),
    tests: sha(JSON.stringify(tests ?? null)),
  };
}

/** True when a value has the shape of a v3 context bundle. */
function isBundle(b) {
  return Boolean(b) && typeof b === 'object' && b.version === 3 && Boolean(b.parts) && typeof b.parts === 'object' && !Array.isArray(b.parts);
}

/**
 * Builds the context bundle from the sources: { specText, answers, diff, tests, files }.
 * Returns { version: 3, parts: { acs, locations, diff, tests } } where each part is { hash, data }.
 */
export function buildContext(sources = {}) {
  const { specText = '', files = [], answers = [], diff = '', tests = null } = sources;
  const hashes = sourceHashes({ specText, answers, diff, tests, files });
  const acs = parseAcMap(specText);
  const targets = [...new Set(acs.map((a) => a.target).filter(Boolean))];
  return {
    version: 3,
    parts: {
      acs: { hash: hashes.acs, data: acs },
      locations: { hash: hashes.locations, data: { targets, files: [...files] } },
      diff: { hash: hashes.diff, data: capDiff(diff) },
      tests: { hash: hashes.tests, data: tests ?? null },
    },
  };
}

/**
 * Keeps the parts whose source hash still matches. Returns { bundle, stale } where stale lists the dropped parts.
 * A malformed or absent bundle returns a fresh build with every part listed as stale.
 */
export function validateContext(bundle, sources = {}) {
  if (!isBundle(bundle)) return { bundle: buildContext(sources), stale: [...PART_NAMES] };
  const hashes = sourceHashes(sources);
  const parts = {};
  const stale = [];
  for (const name of PART_NAMES) {
    const p = bundle.parts[name];
    if (p && typeof p === 'object' && p.hash === hashes[name] && 'data' in p) parts[name] = p;
    else stale.push(name);
  }
  return { bundle: { version: 3, parts }, stale };
}

/** Rebuilds only the missing or stale parts of a bundle and keeps the rest. */
export function refreshContext(bundle, sources = {}) {
  const { bundle: kept } = validateContext(bundle, sources);
  const fresh = buildContext(sources).parts;
  const parts = { ...kept.parts };
  for (const name of PART_NAMES) if (!parts[name]) parts[name] = fresh[name];
  return { version: 3, parts };
}

/**
 * Text for the review CONTEXT slot, capped at maxBytes (default 10240) in UTF-8.
 * Acceptance criteria, locations, the capped diff and the tests, in that order.
 */
export function renderContext(bundle, { maxBytes = 10240 } = {}) {
  const parts = isBundle(bundle) ? bundle.parts : {};
  const out = [];
  if (parts.acs) {
    const acs = Array.isArray(parts.acs.data) ? parts.acs.data : [];
    out.push('## Acceptance criteria');
    out.push(...(acs.length ? acs.map((a) => `- ${a.id}: ${a.text} (target ${a.target ?? 'none'}, test ${a.test ?? 'none'})`) : ['(none)']));
  }
  if (parts.locations) {
    const d = parts.locations.data ?? {};
    out.push('', '## Locations', ...((d.targets ?? []).length ? d.targets.map((t) => `- ${t}`) : ['(none)']));
  }
  if (parts.diff) {
    const d = parts.diff.data ?? {};
    out.push('', '## Diff', d.text ?? '');
    if (d.truncated) out.push(`(omitted: ${(d.omitted ?? []).join(', ')})`);
  }
  if (parts.tests) out.push('', '## Tests', JSON.stringify(parts.tests.data ?? null));
  const text = out.join('\n');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const note = '\n[context truncated]';
  const keep = Math.max(0, maxBytes - Buffer.byteLength(note, 'utf8'));
  return Buffer.from(text, 'utf8').subarray(0, keep).toString('utf8').replace(/�$/, '') + note;
}

/** Milliseconds between two ISO times, or null when either is missing or invalid. */
function spanMs(from, to) {
  const a = Date.parse(from), b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

/**
 * Run metrics from a manifest: { stages: [{phase, ms}], attempts: {total, failed, byModel}, tests, repeats }.
 * ms is null for an open or missing window; tests is null when the manifest has no test result.
 */
export function runMetrics(m = {}) {
  const attempts = m.attempts ?? [];
  const byModel = {};
  for (const a of attempts) byModel[a.model ?? 'unknown'] = (byModel[a.model ?? 'unknown'] ?? 0) + 1;
  return {
    stages: (m.phases ?? []).map((p) => ({ phase: p.phase, ms: spanMs(p.from, p.to) })),
    attempts: { total: attempts.length, failed: attempts.filter((a) => !a.ok).length, byModel },
    tests: m.tests ? { passed: m.tests.passed ?? null, failed: m.tests.failed ?? null } : null,
    repeats: (m.diagnostics ?? []).filter((d) => d.repeated === true).length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  const usage = 'usage: v3.mjs acmap <spec.md> | context <runDir> | metrics <runDir>';
  const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  const readJsonFile = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
  const manifestOf = (dir) => readJsonFile(path.join(dir, 'manifest.json')) ?? {};
  if (!cmd || !arg || !['acmap', 'context', 'metrics'].includes(cmd)) {
    console.log(JSON.stringify({ error: usage }));
    process.exit(2);
  }
  if (cmd === 'acmap') {
    if (!fs.existsSync(arg)) { console.log(JSON.stringify({ error: `spec not found: ${arg}` })); process.exit(1); }
    const acMap = parseAcMap(readText(arg));
    console.log(JSON.stringify({ acMap, summary: acSummary(acMap) }));
  } else if (cmd === 'context') {
    const m = manifestOf(arg);
    const sources = {
      specText: readText(path.join(arg, 'spec.md')),
      answers: m.planAnswers ?? [],
      diff: readText(path.join(arg, 'evidence', 'diff.patch')),
      tests: m.tests ?? null,
      files: m.files ?? [],
    };
    const file = path.join(arg, 'evidence', 'context.json');
    const existing = readJsonFile(file);
    const { stale } = validateContext(existing, sources);
    const bundle = refreshContext(existing, sources);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
    console.log(JSON.stringify({ written: file, stale, parts: Object.keys(bundle.parts), bytes: Buffer.byteLength(renderContext(bundle), 'utf8') }));
  } else {
    console.log(JSON.stringify(runMetrics(manifestOf(arg))));
  }
}
