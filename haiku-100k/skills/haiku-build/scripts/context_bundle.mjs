#!/usr/bin/env node
// Context bundle for a v3 run: evidence/context-bundle.json gathers what a later stage needs (the task, the spec's
// ACs with their trace, the files the diff touches, the last test counts, the review finding count and a diff
// excerpt) within BUNDLE_MAX_BYTES. getBundle reuses the file while the hashes of its sources are unchanged. When a
// source changed, or the file is missing or unreadable, it rebuilds the file and says why. This script reports
// only; it never changes run status.
//
// Usage: node context_bundle.mjs <runDir> [--stage <stage>] [--task <text>]
//                                  reuses or rebuilds evidence/context-bundle.json, prints one JSON line
//                                  {reused, bytes, invalidated, reason?, file}
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTrace } from './trace.mjs';
import { parseCounts } from './diagnostics.mjs';

/** Largest serialized bundle, in UTF-8 bytes. */
export const BUNDLE_MAX_BYTES = 12000;

const BUNDLE_REL = 'evidence/context-bundle.json';
const SOURCE_FILES = {
  spec: 'spec.md',
  diff: 'evidence/diff.patch',
  tests: 'evidence/unit-tests.log',
  review: 'evidence/review.json',
};
const TASK_CHARS = 500;
const AC_TEXT_CHARS = 160;
const ACS_MAX = 30;
const LOCATIONS_MAX = 100;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readOrNull(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function byteSize(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

/**
 * Sha256 of each source of a run: the task text and the files spec.md, evidence/diff.patch,
 * evidence/unit-tests.log and evidence/review.json. A source that is absent gives null.
 * @param {string} runDir run folder
 * @param {{task?: string|null}} [opts] task text of the run
 * @returns {{task: string|null, spec: string|null, diff: string|null, tests: string|null, review: string|null}}
 */
export function sourceHashes(runDir, { task = null } = {}) {
  const out = { task: task == null ? null : sha256(String(task)) };
  for (const [key, rel] of Object.entries(SOURCE_FILES)) {
    const text = readOrNull(path.join(runDir, rel));
    out[key] = text == null ? null : sha256(text);
  }
  return out;
}

/** Every file path named in the "diff --git a/<path> b/<path>" headers of a diff, in order, unique. */
function locationsOf(diff) {
  const found = [];
  for (const m of String(diff ?? '').matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)) {
    if (!found.includes(m[2])) found.push(m[2]);
  }
  return found;
}

/** Finding count of a review.json text, null when absent or not JSON with a findings list. */
function reviewCount(text) {
  if (text == null) return null;
  try {
    const review = JSON.parse(text);
    return Array.isArray(review.findings) ? review.findings.length : null;
  } catch {
    return null;
  }
}

/**
 * Builds the bundle object for a run. The diff excerpt is cut until the serialized bundle fits in maxBytes;
 * when even the excerpt is not enough, the AC texts are dropped first, then the locations.
 * @param {string} runDir run folder
 * @param {{task?: string|null, maxBytes?: number}} [opts] task text and size limit
 * @returns {object} { version, builtAt, sources, task, acs, locations, tests, reviewFindings, diffExcerpt, truncated }
 */
export function buildBundle(runDir, { task = null, maxBytes = BUNDLE_MAX_BYTES } = {}) {
  const specText = readOrNull(path.join(runDir, SOURCE_FILES.spec));
  const diff = readOrNull(path.join(runDir, SOURCE_FILES.diff)) ?? '';
  const trace = specText == null ? null : buildTrace(specText);
  const allAcs = (trace?.acs ?? []).map((a) => ({
    id: a.id, text: a.text.slice(0, AC_TEXT_CHARS), status: a.status, target: a.target, verify: a.verify,
  }));
  const allLocations = locationsOf(diff);
  const trimmed = allAcs.length > ACS_MAX || allLocations.length > LOCATIONS_MAX;
  const base = {
    version: 1,
    builtAt: new Date().toISOString(),
    sources: sourceHashes(runDir, { task }),
    task: task == null ? null : String(task).slice(0, TASK_CHARS),
    acs: allAcs.slice(0, ACS_MAX),
    locations: allLocations.slice(0, LOCATIONS_MAX),
    tests: parseCounts(readOrNull(path.join(runDir, SOURCE_FILES.tests)) ?? ''),
    reviewFindings: reviewCount(readOrNull(path.join(runDir, SOURCE_FILES.review))),
  };

  let excerpt = diff;
  let bundle = { ...base, diffExcerpt: excerpt, truncated: trimmed };
  while (byteSize(bundle) > maxBytes && excerpt.length > 0) {
    excerpt = excerpt.slice(0, Math.max(0, excerpt.length - Math.max(1, byteSize(bundle) - maxBytes)));
    bundle = { ...base, diffExcerpt: excerpt, truncated: true };
  }
  if (byteSize(bundle) > maxBytes) {
    bundle = { ...bundle, acs: bundle.acs.map((a) => ({ id: a.id, status: a.status })), truncated: true };
  }
  if (byteSize(bundle) > maxBytes) {
    bundle = { ...bundle, locations: [] };
  }
  return bundle;
}

/**
 * Reuses evidence/context-bundle.json when every source hash matches, else rebuilds and rewrites it.
 * @param {string} runDir run folder
 * @param {{stage?: string|null, task?: string|null, maxBytes?: number}} [opts] stage is echoed back; task and limit as in buildBundle
 * @returns {{reused: boolean, stage: string|null, bundle: object, invalidated: string[], reason?: string, bytes: number}}
 *   reused true: bundle is the stored one and the file is not rewritten. reused false: bundle was rebuilt and
 *   written; reason says why (missing file, unreadable file, or the changed sources in invalidated).
 */
export function getBundle(runDir, { stage = null, task = null, maxBytes = BUNDLE_MAX_BYTES } = {}) {
  const file = path.join(runDir, BUNDLE_REL);
  const hashes = sourceHashes(runDir, { task });
  let reason = null;
  if (!fs.existsSync(file)) {
    reason = 'no bundle file yet';
  } else {
    let old = null;
    try {
      old = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      reason = 'bundle file is not valid JSON';
    }
    if (old !== null && (typeof old !== 'object' || old.version !== 1 || typeof old.sources !== 'object')) {
      reason = 'bundle file has an unknown version or shape';
    } else if (old !== null) {
      const invalidated = Object.keys(hashes).filter((k) => (old.sources[k] ?? null) !== hashes[k]);
      if (invalidated.length === 0) {
        return { reused: true, stage, bundle: old, invalidated: [], bytes: byteSize(JSON.stringify(old)) };
      }
      reason = `sources changed: ${invalidated.join(', ')}`;
    }
  }
  const bundle = buildBundle(runDir, { task, maxBytes });
  const text = JSON.stringify(bundle);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const invalidated = reason?.startsWith('sources changed: ') ? reason.slice('sources changed: '.length).split(', ') : [];
  return { reused: false, stage, bundle, invalidated, reason, bytes: byteSize(text) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const runDir = args[0];
  const flag = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? null : (args[at + 1] ?? null);
  };
  if (!runDir || runDir.startsWith('--')) {
    console.log(JSON.stringify({ error: 'usage: node context_bundle.mjs <runDir> [--stage <stage>] [--task <text>]' }));
    process.exit(2);
  }
  if (!fs.existsSync(runDir)) {
    console.log(JSON.stringify({ error: `run folder not found: ${runDir}` }));
    process.exit(1);
  }
  const r = getBundle(runDir, { stage: flag('--stage'), task: flag('--task') });
  console.log(JSON.stringify({
    reused: r.reused,
    bytes: r.bytes,
    invalidated: r.invalidated,
    ...(r.reason ? { reason: r.reason } : {}),
    file: BUNDLE_REL,
  }));
}
