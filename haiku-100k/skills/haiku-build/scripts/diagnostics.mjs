#!/usr/bin/env node
// Failure fingerprints for a v3 run. A failure log is normalized (ANSI codes, paths, timings, line:col, ISO times
// and hashes replaced by placeholders, only lines with a failure marker kept, duplicates dropped) and hashed, so two
// logs that differ only in those details get the same fingerprint. recordFailure appends one entry to
// manifest.diagnostics with a category and a progress note. This script reports only; it never changes run status.
//
// Usage: node diagnostics.mjs <runDir> record <stage> <attempt> <logFile>
//                                  appends to manifest.diagnostics, prints the entry as one JSON line
//        node diagnostics.mjs <runDir> state [failedCount]
//                                  prints {state} as one JSON line
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const MARKER = /not ok|fail|error|assert|timed? ?out|cannot find|unexpected|rejected|too vague/i;
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const WIN_PATH = /[A-Za-z]:(?:\\[^\s\\:'"()]+)+/g;
const POSIX_PATH = /(^|[\s('"])\/[^\s:'"()]+/g;
const HASH = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{12,40}\b/g;

/** One log line with variable details replaced by placeholders. */
function normalizeLine(line) {
  return line
    .replace(ISO_TIME, '<time>')
    .replace(WIN_PATH, '<path>')
    .replace(POSIX_PATH, (_, lead) => `${lead}<path>`)
    .replace(HASH, '<hash>')
    .replace(/duration_ms\s+\d+(?:\.\d+)?/g, 'duration_ms <t>')
    .replace(/\(\d+(?:\.\d+)?\s*m?s\)/g, '<t>')
    .replace(/\b\d+(?:\.\d+)?m?s\b/g, '<t>')
    .replace(/:\d+:\d+/g, ':<n>:<n>')
    .replace(/\d+/g, '<n>');
}

/**
 * Normalized failure text: ANSI codes removed, only lines with a failure marker kept (the first non-empty lines
 * when none has one), each line normalized, duplicates dropped, original order kept.
 * @param {string} log raw log text
 * @returns {string} normalized lines joined by "\n"
 */
export function normalizeFailure(log) {
  const nonEmpty = String(log ?? '').replace(ANSI, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const marked = nonEmpty.filter((l) => MARKER.test(l));
  const kept = marked.length ? marked : nonEmpty.slice(0, 3);
  const out = [];
  for (const line of kept.map(normalizeLine)) {
    if (!out.includes(line)) out.push(line);
  }
  return out.join('\n');
}

/**
 * Twelve hex characters of the sha256 of the normalized failure text.
 * @param {string} log raw log text
 * @returns {string} 12 lowercase hex characters
 */
export function fingerprint(log) {
  return crypto.createHash('sha256').update(normalizeFailure(log)).digest('hex').slice(0, 12);
}

/**
 * Failure category from fixed rules on the log text, then on the stage when the text names no known failure.
 * @param {string} text raw log text
 * @param {{stage?: string}} [opts] stage of the failed step (plan, test, review, ...)
 * @returns {'missing-module'|'syntax'|'timeout'|'assertion'|'test-failure'|'plan-rejected'|'review-rejected'|'unknown'}
 */
export function categorize(text, { stage } = {}) {
  const s = String(text ?? '');
  if (/cannot find module|module not found|ERR_MODULE_NOT_FOUND/i.test(s)) return 'missing-module';
  if (/SyntaxError|unexpected token/i.test(s)) return 'syntax';
  if (/timed? ?out|timeout|ETIMEDOUT/i.test(s)) return 'timeout';
  if (/AssertionError|assert/i.test(s)) return 'assertion';
  if (/#\s*fail\s+[1-9]|\bnot ok\b/i.test(s)) return 'test-failure';
  if (s.trim() && stage === 'plan') return 'plan-rejected';
  if (s.trim() && stage === 'review') return 'review-rejected';
  return 'unknown';
}

/**
 * TAP-style counts from "# pass n" and "# fail n" lines.
 * @param {string} text raw log text
 * @returns {{passed: number, failed: number}|null} null when neither line is present
 */
export function parseCounts(text) {
  const s = String(text ?? '');
  const pass = /#\s*pass\s+(\d+)/i.exec(s);
  const fail = /#\s*fail\s+(\d+)/i.exec(s);
  if (!pass && !fail) return null;
  return { passed: pass ? Number(pass[1]) : 0, failed: fail ? Number(fail[1]) : 0 };
}

/**
 * Appends one failure entry to m.diagnostics. progress compares with the previous entry of the same stage:
 * 'first' (none before), 'repeated' (same fingerprint), 'improved' or 'worse' (fewer or more failed tests), else 'changed'.
 * repeatCount counts the same-stage entries with this fingerprint, this one included.
 * @param {object} m manifest object (mutated)
 * @param {{stage: string, attempt: string, log: string, at?: string}} r the failure to record
 * @returns {object} the appended entry
 */
export function recordFailure(m, { stage, attempt, log, at = new Date().toISOString() }) {
  if (!Array.isArray(m.diagnostics)) m.diagnostics = [];
  const list = m.diagnostics;
  const fp = fingerprint(log);
  const counts = parseCounts(log);
  const sameStage = list.filter((e) => e.stage === stage);
  const prev = sameStage[sameStage.length - 1];
  let progress = 'changed';
  if (!prev) progress = 'first';
  else if (prev.fingerprint === fp) progress = 'repeated';
  else if (counts && prev.failed != null && counts.failed < prev.failed) progress = 'improved';
  else if (counts && prev.failed != null && counts.failed > prev.failed) progress = 'worse';
  const entry = {
    stage,
    attempt,
    fingerprint: fp,
    category: categorize(log, { stage }),
    passed: counts?.passed ?? null,
    failed: counts?.failed ?? null,
    progress,
    repeatCount: sameStage.filter((e) => e.fingerprint === fp).length + 1,
    at,
  };
  list.push(entry);
  return entry;
}

/**
 * One line for the recovery prompt: the failed count and the last recorded failure.
 * @param {object} m manifest object
 * @param {number} [failedCount] number of failed attempts so far
 * @returns {string} for example "failed 2; last test T2: assertion abc123def456 repeated (repeat 2)"
 */
export function recoveryState(m, failedCount) {
  const list = Array.isArray(m?.diagnostics) ? m.diagnostics : [];
  const head = `failed ${failedCount ?? 0}`;
  const last = list[list.length - 1];
  if (!last) return `${head}; no failure recorded`;
  return `${head}; last ${last.stage} ${last.attempt}: ${last.category} ${last.fingerprint} ${last.progress} (repeat ${last.repeatCount})`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runDir, cmd, ...rest] = process.argv.slice(2);
  if (!runDir || !cmd) {
    console.log(JSON.stringify({ error: 'usage: node diagnostics.mjs <runDir> record <stage> <attempt> <logFile> | state [failedCount]' }));
    process.exit(2);
  }
  const mf = path.join(runDir, 'manifest.json');
  const m = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {};
  if (cmd === 'record') {
    const [stage, attempt, logFile] = rest;
    if (!stage || !attempt || !logFile || !fs.existsSync(logFile)) {
      console.log(JSON.stringify({ error: 'record needs <stage> <attempt> <logFile> with an existing log file' }));
      process.exit(1);
    }
    const entry = recordFailure(m, { stage, attempt, log: fs.readFileSync(logFile, 'utf8') });
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    console.log(JSON.stringify(entry));
  } else if (cmd === 'state') {
    console.log(JSON.stringify({ state: recoveryState(m, Number(rest[0] ?? 0)) }));
  } else {
    console.log(JSON.stringify({ error: `unknown command: ${cmd}` }));
    process.exit(2);
  }
}
