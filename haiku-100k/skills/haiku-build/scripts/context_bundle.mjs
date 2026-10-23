#!/usr/bin/env node
// Context bundle (v3): one compact, structured context for the Plan and Review inputs, kept in
// evidence/context-bundle.json and reused across stages. Four sections, each stored with the hash of the
// sources it depends on; a section whose sources did not change is reused, the others are rebuilt:
//   acs           <- spec.md (else the task)        the AC map (ac_map.mjs)
//   codeLocations <- spec.md + diff + facts          changed files with hunk start lines, AC targets, facts
//   diff          <- evidence/diff.patch             capDiff (whole files, omitted ones named)
//   evidence      <- tests + attempts + failures     test outcome, ladder attempts, failure records
// A missing source gives a `null` section. The whole bundle stays within BUNDLE_MAX_BYTES (diff capped at
// BUNDLE_DIFF_MAX_BYTES, every other section trimmed to SECTION_MAX_BYTES). The prompt text is also written to
// evidence/context-bundle.txt, and every use is logged in manifest.contextBundle.uses.
//
// Usage: node context_bundle.mjs <runDir> <stage> [--facts <file>]
//   Prints one JSON line: { file, stage, reused, rebuilt, bytes }.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capDiff } from './build_report.mjs';
import { acMap } from './ac_map.mjs';
import { repeatedFailures } from './failure.mjs';

export const BUNDLE_MAX_BYTES = 64 * 1024;
export const BUNDLE_DIFF_MAX_BYTES = 44 * 1024;
export const SECTION_MAX_BYTES = 6 * 1024;
export const FACTS_MAX_BYTES = 2 * 1024;
export const MAX_USES = 20;
export const SECTIONS = ['acs', 'codeLocations', 'diff', 'evidence'];
export const BUNDLE_FILE = path.join('evidence', 'context-bundle.json');
export const BUNDLE_TEXT_FILE = path.join('evidence', 'context-bundle.txt');

const bytes = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v));
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const readOr = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const clip = (s, max) => (bytes(s) <= max ? s : `${Buffer.from(s).subarray(0, max).toString('utf8').replace(/�+$/, '')}…`);

/** The bundle's sources from a run folder: { task, spec, diff, facts, tests, attempts, failures } (null when absent). */
export function bundleSources(runDir, m = {}, { facts = null } = {}) {
  return {
    task: m?.task ?? null,
    spec: readOr(path.join(runDir, 'spec.md')),
    diff: readOr(path.join(runDir, 'evidence', 'diff.patch')),
    facts: facts ?? null,
    tests: m?.tests ?? null,
    attempts: m?.attempts?.length ? m.attempts : null,
    failures: m?.failures?.length ? m.failures : null,
  };
}

/** Each section's source value (null when every source it depends on is missing). */
export function sectionSources(s = {}) {
  const anyOf = (o) => (Object.values(o).some((v) => v != null) ? o : null);
  return {
    acs: s.spec ?? s.task ?? null,
    codeLocations: anyOf({ spec: s.spec ?? null, diff: s.diff ?? null, facts: s.facts ?? null }),
    diff: s.diff ?? null,
    evidence: anyOf({ tests: s.tests ?? null, attempts: s.attempts ?? null, failures: s.failures ?? null }),
  };
}

/** Changed files of a diff with the new-side start line of each hunk: [{ file, hunks: [line] }]. */
export function diffLocations(diff = '') {
  const out = [];
  let cur = null;
  for (const line of String(diff ?? '').split('\n')) {
    const f = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (f) { cur = { file: f[2], hunks: [] }; out.push(cur); continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h && cur) cur.hunks.push(Number(h[1]));
  }
  return out;
}

/** Trims a section's data to `max` bytes: long strings first, then trailing array items; marks it `trimmed`. */
export function fitSection(data, max = SECTION_MAX_BYTES) {
  if (data == null || bytes(data) <= max) return data;
  const d = JSON.parse(JSON.stringify(data));
  d.trimmed = true;
  const shorten = (o) => {
    for (const k of Object.keys(o)) {
      if (typeof o[k] === 'string' && o[k].length > 300) o[k] = clip(o[k], 300);
      else if (o[k] && typeof o[k] === 'object') shorten(o[k]);
    }
  };
  shorten(d);
  const arrays = () => Object.values(d).filter((v) => Array.isArray(v) && v.length);
  while (bytes(d) > max && arrays().length) {
    arrays().sort((a, b) => bytes(b) - bytes(a))[0].pop();
  }
  return bytes(d) <= max ? d : { trimmed: true };
}

function buildSection(name, src, { diffMax = BUNDLE_DIFF_MAX_BYTES, specMap = null } = {}) {
  if (name === 'acs') {
    const map = specMap ?? acMap(src);
    return fitSection({ acs: map.acs, unmapped: map.unmapped, reason: map.reason });
  }
  if (name === 'codeLocations') {
    const map = src.spec ? (specMap ?? acMap(src.spec)) : null;
    return fitSection({
      files: diffLocations(src.diff ?? ''),
      targets: (map?.acs ?? []).filter((a) => a.target).map((a) => ({ id: a.id, target: a.target })),
      facts: src.facts ? clip(String(src.facts), FACTS_MAX_BYTES) : null,
    });
  }
  if (name === 'diff') {
    const cap = capDiff(String(src), { maxBytes: diffMax, maxLines: Number.MAX_SAFE_INTEGER });
    const files = diffLocations(src).map((f) => f.file);
    return { files, text: cap.text, omitted: cap.omitted, truncated: cap.truncated };
  }
  // evidence
  return fitSection({
    tests: src.tests ? { command: src.tests.command ?? null, passed: src.tests.passed ?? null, failed: src.tests.failed ?? null } : null,
    attempts: (src.attempts ?? []).map((a) => ({ attempt: a.attempt, ok: a.ok, ...(a.passed != null ? { passed: a.passed } : {}), ...(a.failed != null ? { failed: a.failed } : {}) })),
    failures: (src.failures ?? []).slice(-5).map(({ kind, stage, attempt, fingerprint, category, progress, repeatCount, failed }) => ({ kind, stage, attempt, fingerprint, category, progress, repeatCount, failed })),
    repeated: repeatedFailures(src.failures ?? []).map(({ fingerprint, count, category }) => ({ fingerprint, count, category })),
  });
}

/** Reads evidence/context-bundle.json, or null when missing or not version 1. */
export function readBundle(runDir) {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(runDir, BUNDLE_FILE), 'utf8'));
    return b?.version === 1 && b.sections ? b : null;
  } catch {
    return null;
  }
}

/**
 * Builds or refreshes the bundle for `stage`: a section whose source hash is unchanged is reused, the rest are
 * rebuilt. Writes evidence/context-bundle.json and .txt. Returns { bundle, text, reused, rebuilt, bytes, file }.
 */
export function prepareBundle(runDir, sources = {}, { stage = null } = {}) {
  const prev = readBundle(runDir);
  const src = sectionSources(sources);
  const sections = {}, reused = [], rebuilt = [];
  const specMap = sources.spec ? acMap(sources.spec) : null;
  for (const name of SECTIONS) {
    if (src[name] == null) { sections[name] = null; continue; }
    const h = hash(src[name]);
    const old = prev?.sections?.[name];
    if (old && old.sourceHash === h) { sections[name] = old; reused.push(name); continue; }
    sections[name] = { sourceHash: h, data: buildSection(name, src[name], { specMap: name === 'acs' && !sources.spec ? null : specMap }) };
    rebuilt.push(name);
  }
  const entry = { stage, reused, rebuilt, bytes: 0 };
  const bundle = { version: 1, sections, uses: [...(prev?.uses ?? []), entry].slice(-MAX_USES) };
  let json = JSON.stringify(bundle, null, 1);
  // The diff is the only large section: shrink its cap until the whole bundle fits.
  let diffMax = BUNDLE_DIFF_MAX_BYTES;
  while (bytes(json) > BUNDLE_MAX_BYTES && sections.diff && diffMax > 0) {
    diffMax = Math.max(0, diffMax - (bytes(json) - BUNDLE_MAX_BYTES) - 1024);
    sections.diff = { sourceHash: sections.diff.sourceHash, data: buildSection('diff', src.diff, { diffMax }) };
    json = JSON.stringify(bundle, null, 1);
  }
  for (let i = 0; i < 2; i++) { entry.bytes = bytes(json); json = JSON.stringify(bundle, null, 1); }
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(runDir, BUNDLE_FILE), json);
  const text = renderBundle(bundle);
  fs.writeFileSync(path.join(runDir, BUNDLE_TEXT_FILE), text);
  return { bundle, text, reused, rebuilt, bytes: bytes(json), file: path.join(runDir, BUNDLE_FILE) };
}

/** Prompt text of a bundle: ACCEPTANCE CRITERIA, CODE LOCATIONS, DIFF, EVIDENCE; a null section says none. */
export function renderBundle(bundle) {
  const s = bundle?.sections ?? {};
  const out = ['CONTEXT BUNDLE (evidence/context-bundle.json)', '', 'ACCEPTANCE CRITERIA:'];
  const acs = s.acs?.data;
  if (!acs?.acs?.length) out.push(`none${acs?.reason ? ` (${acs.reason})` : ''}`);
  for (const a of acs?.acs ?? []) {
    out.push(`- ${a.id}: ${a.text} — target: ${a.target ?? 'MISSING'}; verify: ${a.verify ?? 'MISSING'}${a.missing?.length ? ' [unmapped]' : ''}`);
  }
  out.push('', 'CODE LOCATIONS:');
  const cl = s.codeLocations?.data;
  if (!cl) out.push('none');
  else {
    for (const f of cl.files ?? []) out.push(`- ${f.file}${f.hunks?.length ? ` (hunks at ${f.hunks.join(', ')})` : ''}`);
    if (cl.targets?.length) out.push(`AC targets: ${cl.targets.map((t) => `${t.id} ${t.target}`).join('; ')}`);
    if (cl.facts) out.push('FACTS:', cl.facts);
    if (!cl.files?.length && !cl.targets?.length && !cl.facts) out.push('none');
  }
  const d = s.diff?.data;
  out.push('', `DIFF${d ? ` (${d.files.length} file(s)${d.omitted.length ? `, omitted: ${d.omitted.join(', ')}` : ''})` : ''}:`);
  out.push(d ? d.text || '(empty)' : 'none');
  out.push('', 'EVIDENCE:');
  const e = s.evidence?.data;
  if (!e) out.push('none');
  else {
    if (e.tests) out.push(`tests: passed ${e.tests.passed ?? '?'}, failed ${e.tests.failed ?? '?'}${e.tests.command ? ` (${e.tests.command})` : ''}`);
    if (e.attempts?.length) out.push(`attempts: ${e.attempts.map((a) => `${a.attempt} ${a.ok ? 'pass' : 'fail'}${a.failed != null ? ` (failed ${a.failed})` : ''}`).join(', ')}`);
    for (const f of e.failures ?? []) out.push(`failure: ${f.kind} ${f.attempt ?? '?'} ${f.category} ${f.fingerprint} progress ${f.progress}`);
    if (e.repeated?.length) out.push(`repeated: ${e.repeated.map((r) => `${r.fingerprint} x${r.count}`).join(', ')}`);
  }
  return out.join('\n') + '\n';
}

/**
 * Prepares the bundle from a run folder and logs the use in m.contextBundle (in place; the caller writes the
 * manifest). Returns the prepareBundle result.
 */
export function useBundle(runDir, m, { stage = null, facts = null } = {}) {
  const r = prepareBundle(runDir, bundleSources(runDir, m, { facts }), { stage });
  m.contextBundle = {
    file: BUNDLE_FILE.replace(/\\/g, '/'),
    uses: [...(m.contextBundle?.uses ?? []), { stage, reused: r.reused, rebuilt: r.rebuilt, bytes: r.bytes }],
  };
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--facts');
  const factsFile = fi >= 0 ? args.splice(fi, 2)[1] : null;
  const [runDir, stage] = args;
  if (!runDir || !stage) { console.log('usage: node context_bundle.mjs <runDir> <stage> [--facts <file>]'); process.exit(2); }
  const mf = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(mf)) { console.log(JSON.stringify({ error: `missing required artifact: manifest.json in ${runDir}` })); process.exit(1); }
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const r = useBundle(runDir, m, { stage, facts: factsFile ? readOr(factsFile) : null });
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  console.log(JSON.stringify({ file: r.file, stage, reused: r.reused, rebuilt: r.rebuilt, bytes: r.bytes }));
}
