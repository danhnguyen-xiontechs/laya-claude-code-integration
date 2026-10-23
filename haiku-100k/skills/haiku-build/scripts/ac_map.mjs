#!/usr/bin/env node
// AC traceability (v3): maps every acceptance criterion of a spec to its implementation target and its
// verification command or test, so the plan, the report and haiku-build-auto share one contract. An AC with no
// target or no verify is `unmapped` and never counts as passing.
//
// AC line format (templates/spec.md section 6):
//   - AC1: <behaviour> — target: `src/a.mjs`; verify: `node --test test/a.test.mjs`
// (`checked by` is read as a legacy spelling of `verify:`.)
//
// Usage: node ac_map.mjs <runDir|spec.md>
//   Reads spec.md (and manifest.json tests when a run folder is given), prints one JSON line:
//   { ok, reason, acs, unmapped, evidence? }. Exit 1 when an AC is unmapped or no AC was found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AC_START = /\bAC(\d+)\s*(?::|—|–|-{1,2})\s*/g;
const TARGET = /\btarget:\s*(?:`([^`]+)`|([^;\n]+))/i;
const VERIFY = /\b(?:verify:|checked by)\s*(?:`([^`]+)`|([^;\n]+))/i;
const FIELD_START = /\s*(?:[—–]|-{1,2})?\s*(?:\btarget:|\bverify:|\bchecked by\b)/i;

/** The "Tasks & Acceptance" section when the text has one, else the whole text. */
export function acceptanceSection(text = '') {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s.*Tasks & Acceptance/i.test(l));
  if (start < 0) return lines.join('\n');
  const level = lines[start].match(/^#+/)[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => { const h = l.match(/^(#{1,6})\s/); return h && h[1].length <= level; });
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

const value = (m) => (m ? (m[1] ?? m[2] ?? '').trim().replace(/[.,]+$/, '').trim() || null : null);

/** Parses the ACs of a spec or story text. First occurrence of an id wins. Returns [{ id, text, target, verify, missing }]. */
export function parseAcs(text = '') {
  const body = acceptanceSection(text);
  const starts = [...body.matchAll(AC_START)];
  const seen = new Set();
  const acs = [];
  starts.forEach((s, i) => {
    const id = `AC${s[1]}`;
    let seg = body.slice(s.index + s[0].length, i + 1 < starts.length ? starts[i + 1].index : body.length);
    // A list item ends at a blank line, a heading or the next bullet.
    const cut = seg.search(/\n\s*\n|\n#|\n\s*[-*] /);
    if (cut >= 0) seg = seg.slice(0, cut);
    seg = seg.replace(/\s*[-*]\s*$/, '').trim();
    if (seen.has(id)) return;
    seen.add(id);
    const target = value(seg.match(TARGET));
    const verify = value(seg.match(VERIFY));
    const f = seg.search(FIELD_START);
    const behaviour = (f >= 0 ? seg.slice(0, f) : seg).replace(/\s+/g, ' ').replace(/[\s,;.—–-]+$/, '').trim();
    const missing = [...(target ? [] : ['target']), ...(verify ? [] : ['verify'])];
    acs.push({ id, text: behaviour, target, verify, missing });
  });
  return acs;
}

/** AC map of a spec: { acs, unmapped: [ids], ok, reason }. No ACs: ok false, reason `no acceptance criteria`. */
export function acMap(text = '') {
  const acs = parseAcs(text);
  const unmapped = acs.filter((a) => a.missing.length).map((a) => a.id);
  if (!acs.length) return { acs, unmapped, ok: false, reason: 'no acceptance criteria' };
  return { acs, unmapped, ok: unmapped.length === 0, reason: unmapped.length ? `unmapped: ${unmapped.join(', ')}` : null };
}

/**
 * Report rows: { id, text, target, verify, status } with status unmapped | pass | fail | not_run.
 * `results` ({ AC1: 'pass' | 'fail' }) wins when given; else the run's tests decide (failed 0 and passed > 0:
 * pass; failed > 0: fail; no tests: not_run). An unmapped AC is never pass.
 */
export function acEvidence(map, { tests = null, results = {} } = {}) {
  const fromTests = !tests || tests.failed == null ? 'not_run'
    : Number(tests.failed) > 0 ? 'fail'
      : Number(tests.passed ?? 0) > 0 ? 'pass' : 'not_run';
  return (map?.acs ?? []).map((a) => ({
    id: a.id, text: a.text, target: a.target ?? null, verify: a.verify ?? null,
    status: (a.missing?.length || !a.target || !a.verify) ? 'unmapped'
      : ['pass', 'fail', 'not_run'].includes(results?.[a.id]) ? results[a.id] : fromTests,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) { console.log('usage: node ac_map.mjs <runDir|spec.md>'); process.exit(2); }
  const isDir = fs.existsSync(arg) && fs.statSync(arg).isDirectory();
  const specFile = isDir ? path.join(arg, 'spec.md') : arg;
  if (!fs.existsSync(specFile)) { console.log(JSON.stringify({ ok: false, reason: `missing ${specFile}` })); process.exit(1); }
  const map = acMap(fs.readFileSync(specFile, 'utf8'));
  const mf = isDir ? path.join(arg, 'manifest.json') : null;
  const tests = mf && fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')).tests ?? null : null;
  console.log(JSON.stringify({ ...map, ...(isDir ? { evidence: acEvidence(map, { tests }) } : {}) }));
  process.exit(map.ok ? 0 : 1);
}
