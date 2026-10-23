#!/usr/bin/env node
// AC traceability for a v3 run. Each "- AC<n>: ..." line in the spec's "Tasks & Acceptance Criteria" section is
// mapped to an implementation target (a backticked source path) and a verification (the test named after
// "Checked by"). An AC without both is `unmapped`: it is flagged and kept, and it never counts as evidence.
// This script reports only; it never changes the run status.
//
// Usage: node trace.mjs <runDir>   reads spec.md, writes manifest.trace, prints one JSON line
//                                  {ok, total, mapped, unmapped} (unmapped is a count; exit 1 when spec.md is missing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_HEADING = /^##\s+(?:\d+\.\s+)?Tasks & Acceptance Criteria\b/i;
const ANY_HEADING = /^##\s/;
const AC_LINE = /^- (AC\d+):\s*(.+?)\s*$/;
const TEST_FILE = /\.test\.[cm]?js$/;

/** The lines of the Tasks & Acceptance Criteria section; the whole text when that heading is absent. */
function sectionLines(specText) {
  const lines = String(specText ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => SECTION_HEADING.test(l));
  if (start === -1) return lines;
  const end = lines.findIndex((l, i) => i > start && ANY_HEADING.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/**
 * Acceptance criteria of a spec: the "- AC<n>: text" lines inside the Tasks & Acceptance Criteria section.
 * @param {string} specText full text of spec.md
 * @returns {{id: string, text: string}[]} in spec order
 */
export function parseAcs(specText) {
  const acs = [];
  for (const line of sectionLines(specText)) {
    const m = AC_LINE.exec(line);
    if (m) acs.push({ id: m[1], text: m[2] });
  }
  return acs;
}

/** Backticked tokens of a string that look like a source path (has a slash or a file extension). */
function pathTokens(s) {
  return [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((t) => /\//.test(t) || /\.(mjs|cjs|js|json|md|ts)$/.test(t));
}

/** Verification named in an AC text: "Checked by `file` \"name\"" or a bare backticked test file. */
function verifyOf(text) {
  const named = /Checked by\s+`([^`]+)`(?:\s+"([^"]+)")?/.exec(text);
  if (named) return named[2] ? `${named[1]} "${named[2]}"` : named[1];
  const bare = pathTokens(text).find((t) => TEST_FILE.test(t));
  return bare ?? null;
}

/** Implementation target named in an AC text: the first backticked source path that is not a test file. */
function targetOf(text) {
  return pathTokens(text).find((t) => !TEST_FILE.test(t)) ?? null;
}

/**
 * Full trace of a spec. A task line in the section that names the AC id (for example "AC2") supplies the
 * target when the AC line itself names none.
 * @param {string} specText full text of spec.md
 * @returns {{acs: object[], mapped: number, unmapped: string[], ok: boolean, reason?: string}}
 *   acs items: { id, text, target, verify, status: 'mapped'|'unmapped', missing: ('target'|'verify')[] }
 */
export function buildTrace(specText) {
  const lines = sectionLines(specText);
  const acs = parseAcs(specText).map(({ id, text }) => {
    const taskLine = lines.find((l) => !AC_LINE.test(l) && new RegExp(`\\b${id}\\b`).test(l) && pathTokens(l).length);
    const target = targetOf(text) ?? (taskLine ? targetOf(taskLine) : null);
    const verify = verifyOf(text);
    const missing = [...(target ? [] : ['target']), ...(verify ? [] : ['verify'])];
    return { id, text, target, verify, status: missing.length ? 'unmapped' : 'mapped', missing };
  });
  if (acs.length === 0) return { acs: [], mapped: 0, unmapped: [], ok: false, reason: 'no acceptance criteria' };
  const unmapped = acs.filter((a) => a.status === 'unmapped').map((a) => a.id);
  return { acs, mapped: acs.length - unmapped.length, unmapped, ok: unmapped.length === 0 };
}

/**
 * Evidence per AC from the test counts. An AC is 'pass' only when it is mapped, passed > 0 and failed is 0.
 * @param {object} trace result of buildTrace
 * @param {{passed?: number, failed?: number}|null} tests counts of the latest test run
 * @returns {{id: string, evidence: 'pass'|'fail'|'unmapped'|'not run'}[]}
 */
export function traceEvidence(trace, tests) {
  return (trace?.acs ?? []).map((ac) => {
    if (ac.status !== 'mapped') return { id: ac.id, evidence: 'unmapped' };
    if (!tests) return { id: ac.id, evidence: 'not run' };
    if ((tests.failed ?? 0) > 0) return { id: ac.id, evidence: 'fail' };
    if ((tests.passed ?? 0) > 0) return { id: ac.id, evidence: 'pass' };
    return { id: ac.id, evidence: 'not run' };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) {
    console.log(JSON.stringify({ error: 'usage: node trace.mjs <runDir>' }));
    process.exit(2);
  }
  const specFile = path.join(runDir, 'spec.md');
  if (!fs.existsSync(specFile)) {
    console.log(JSON.stringify({ error: `missing required artifact: spec.md in ${runDir}` }));
    process.exit(1);
  }
  const mf = path.join(runDir, 'manifest.json');
  const m = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : {};
  const trace = buildTrace(fs.readFileSync(specFile, 'utf8'));
  fs.writeFileSync(mf, JSON.stringify({ ...m, trace }, null, 2));
  console.log(JSON.stringify({ ok: trace.ok, total: trace.acs.length, mapped: trace.mapped, unmapped: trace.unmapped.length }));
}
