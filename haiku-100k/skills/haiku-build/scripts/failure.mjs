#!/usr/bin/env node
// Failure diagnostics (v3): one structured record per failed plan, build, test or review attempt, in
// manifest.failures. The fingerprint is a hash over the failure lines with paths, line numbers, timestamps,
// durations and ids normalized away, so the same failure in another folder or at another time hashes the
// same. Progress compares an attempt with the previous one of the same kind. The recovery state text is what
// the existing JEV recovery advice (`--state`) and the Sonnet retry receive; no new JEV call is made.
//
// Usage: node failure.mjs record <runDir> <plan|build|test|review> <attempt> <logFile> [--stage <id>]
//          appends a failure record to manifest.failures and prints it (stage defaults by kind:
//          plan 02-plan, build 03-implement, test 04-test, review 05-review)
//        node failure.mjs state <runDir>
//          prints { state } (the one-line recovery state text)
//   Prints one JSON line.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KINDS = ['plan', 'build', 'test', 'review'];
export const KIND_STAGE = { plan: '02-plan', build: '03-implement', test: '04-test', review: '05-review' };
export const CATEGORIES = ['timeout', 'environment', 'syntax', 'missing-file', 'runtime', 'assertion', 'handback-empty', 'handback-format', 'handback-oversize', 'unknown'];

/** One failure text with timestamps, clock times, durations, hex ids, paths and line/column numbers made neutral. */
export function normalizeFailure(text = '') {
  return String(text ?? '').replace(/\r\n/g, '\n').split('\n').map((line) => line
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<time>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\bduration_ms:?\s*\d+(?:\.\d+)?/g, 'duration_ms <dur>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|min)\b/g, '<dur>')
    .replace(/file:\/\/\/?/g, '')
    .replace(/\b[A-Za-z]:(?=[\\/])/g, '')
    .replace(/(?:[\w.@~-]*[\\/])+([\w.@-]+)/g, '$1')
    .replace(/:\d+(?::\d+)?(?=\D|$)/g, ':<n>')
    .replace(/\bline \d+/gi, 'line <n>')
    .replace(/\s+/g, ' ')
    .trim()).join('\n');
}

const FAILURE_LINE = /not ok|fail|error|assert|expected|actual|✖/i;
const SUMMARY_LINE = /^\s*(?:#|ℹ)\s*(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/i;

/** The lines that describe the failure (node:test summary lines excluded); all non-empty lines when none match. */
export function failureLines(text = '') {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  const picked = lines.filter((l) => FAILURE_LINE.test(l) && !SUMMARY_LINE.test(l));
  return picked.length ? picked : lines;
}

/** First 16 hex of sha256 over the normalized failure lines. */
export function fingerprint(text = '') {
  const body = failureLines(text).map((l) => normalizeFailure(l)).join('\n');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}

/** Category of a failure text; `kind` plan / review reads hand-back check reasons. */
export function failureCategory(text = '', kind = 'test') {
  const t = String(text ?? '');
  if (kind === 'plan' || kind === 'review') {
    if (!t.trim() || /empty output/i.test(t)) return 'handback-empty';
    if (/over \d+ words|oversized/i.test(t)) return 'handback-oversize';
    if (/not parseable|not a JSON array|missing heading|missing severity|not a valid/i.test(t)) return 'handback-format';
  }
  if (/timed? ?out|ETIMEDOUT|timeout/i.test(t)) return 'timeout';
  if (/spawn \S+ ENOENT|EACCES|EPERM|EADDRINUSE|ECONNREFUSED|ENOTFOUND|ERR_UNSUPPORTED|command not found|is not recognized as|unsupported engine/i.test(t)) return 'environment';
  if (/SyntaxError|Unexpected token|Unexpected end of input|ERR_INVALID_TYPESCRIPT/i.test(t)) return 'syntax';
  if (/ENOENT|Cannot find module|ERR_MODULE_NOT_FOUND|no such file|missing required artifact/i.test(t)) return 'missing-file';
  if (/AssertionError|ERR_ASSERTION|\bexpected\b|\bactual\b|deepStrictEqual|strictEqual/i.test(t)) return 'assertion';
  if (/TypeError|ReferenceError|RangeError|\bthrew\b|Uncaught|\bError:/.test(t)) return 'runtime';
  return 'unknown';
}

const lastCount = (log, word) => {
  const summary = [...log.matchAll(new RegExp(`^\\s*(?:#|ℹ)\\s*${word}\\s+(\\d+)\\s*$`, 'gm'))];
  const any = summary.length ? summary : [...log.matchAll(new RegExp(`(?:^|[\\s#ℹ])${word}\\s+(\\d+)\\b`, 'g'))];
  return any.length ? Number(any.at(-1)[1]) : null;
};

/** node:test pass / fail counts of a log: { passed, failed }, each null when absent. */
export function testCounts(log = '') {
  const t = String(log ?? '');
  return { passed: lastCount(t, 'pass'), failed: lastCount(t, 'fail') };
}

const numOrNull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * One failure record: { kind, stage, attempt, fingerprint, category, passed, failed, progress, repeatCount, summary }.
 * progress vs the last record of the same kind in `previous`: first | none (same fingerprint) |
 * improved / regressed (fewer / more failed) | changed. Counts default to the ones parsed from `text`.
 */
export function failureRecord({ kind = 'test', stage = null, attempt = null, text = '', passed, failed } = {}, previous = []) {
  const counts = testCounts(text);
  const p = numOrNull(passed) ?? counts.passed;
  const f = numOrNull(failed) ?? counts.failed;
  const fp = fingerprint(text);
  const prev = (previous ?? []).filter((r) => r.kind === kind).at(-1);
  let progress = 'first';
  if (prev) {
    if (prev.fingerprint === fp) progress = 'none';
    else if (f != null && prev.failed != null && f < prev.failed) progress = 'improved';
    else if (f != null && prev.failed != null && f > prev.failed) progress = 'regressed';
    else progress = 'changed';
  }
  const repeatCount = (previous ?? []).filter((r) => r.kind === kind && r.fingerprint === fp).length + 1;
  const summary = normalizeFailure(failureLines(text)[0] ?? '').slice(0, 160) || null;
  return {
    kind, stage: stage ?? KIND_STAGE[kind] ?? null, attempt: attempt == null ? null : String(attempt),
    fingerprint: fp, category: failureCategory(text, kind), passed: p, failed: f, progress, repeatCount, summary,
  };
}

/** Appends a failure record to m.failures (in place) and returns the record. */
export function recordFailure(m, input) {
  const r = failureRecord(input, m.failures ?? []);
  m.failures = [...(m.failures ?? []), r];
  return r;
}

/** Fingerprints seen 2 or more times: [{ fingerprint, kind, category, count, attempts, stages }]. */
export function repeatedFailures(list = []) {
  const groups = new Map();
  for (const r of list ?? []) {
    const g = groups.get(r.fingerprint) ?? { fingerprint: r.fingerprint, kind: r.kind, category: r.category, count: 0, attempts: [], stages: [] };
    g.count += 1;
    g.attempts.push(r.attempt);
    if (r.stage && !g.stages.includes(r.stage)) g.stages.push(r.stage);
    groups.set(r.fingerprint, g);
  }
  return [...groups.values()].filter((g) => g.count >= 2);
}

/** One-line state text for the JEV recovery `--state` and the Sonnet retry. */
export function recoveryState(list = []) {
  const last = (list ?? []).at(-1);
  if (!last) return 'no failure recorded';
  const counts = last.failed != null ? `, failed ${last.failed}${last.passed != null ? ` passed ${last.passed}` : ''}` : '';
  const rep = repeatedFailures(list).map((g) => `${g.fingerprint} x${g.count}`).join(', ');
  return [
    `last ${last.kind} failure ${last.attempt ?? '?'} (${last.stage ?? '?'}): category ${last.category}, fingerprint ${last.fingerprint}, progress ${last.progress}, seen ${last.repeatCount}x${counts}`,
    rep ? `repeated: ${rep}` : null,
    last.summary ? `first failure line: ${last.summary}` : null,
  ].filter(Boolean).join('; ');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--stage');
  const stage = si >= 0 ? args.splice(si, 2)[1] : null;
  const [cmd, runDir, kind, attempt, logFile] = args;
  const usage = () => { console.log('usage: node failure.mjs record <runDir> <plan|build|test|review> <attempt> <logFile> [--stage <id>] | state <runDir>'); process.exit(2); };
  if (!runDir || !['record', 'state'].includes(cmd)) usage();
  if (cmd === 'record' && (!KINDS.includes(kind) || !attempt || !logFile)) usage();
  const mf = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(mf)) { console.log(JSON.stringify({ error: `missing required artifact: manifest.json in ${runDir}` })); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  if (cmd === 'state') { console.log(JSON.stringify({ state: recoveryState(m.failures ?? []) })); process.exit(0); }
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const r = recordFailure(m, { kind, stage, attempt, text });
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  console.log(JSON.stringify(r));
}
