#!/usr/bin/env node
// Saves an Opus hand-back to the run folder in one command, in the turn it arrives (steps 02 and 04).
//
// Usage: node save_opus.mjs plan   <runDir> <textFile> [--attempt N --approved-by "<user's words>"]
//        node save_opus.mjs review <runDir> <textFile> [--attempt N --approved-by "<user's words>"]
//   plan -> spec.md + opusCalls (savePlanSpec); review -> evidence/review*.json + opusCalls (saveReview).
//   A retry (attempt 2 or more) needs the user's OK: --approved-by is required and is stored with the time
//   as retryApprovedBy / retryAt on that opusCalls entry. A failed check also appends a diagnostic
//   (fingerprint, category, progress) to manifest diagnostics, as status.mjs record fail does for tests.
//   <textFile> holds the hand-back text exactly as returned. Prints one JSON line; exit 1 when the check fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { savePlanSpec, saveReview } from './build_report.mjs';
import { diagnoseFailure, lastDiagnostic } from './v3.mjs';

export function saveOpus(kind, runDir, textFile, { attempt = 1, approvedBy = null, now = new Date() } = {}) {
  if (!['plan', 'review'].includes(kind)) throw new Error(`unknown kind "${kind}" (use plan or review)`);
  if (attempt > 1 && !approvedBy) throw new Error(`a retry needs the user's OK: pass --approved-by "<their words>"`);
  const text = fs.readFileSync(textFile, 'utf8');
  const r = kind === 'plan' ? savePlanSpec(runDir, text, { attempt }) : saveReview(runDir, text, { attempt });
  const mf = path.join(runDir, 'manifest.json');
  if ((attempt > 1 || !r.ok) && fs.existsSync(mf)) {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    if (attempt > 1) Object.assign(m.opusCalls.at(-1), { retryApprovedBy: approvedBy, retryAt: now.toISOString() });
    // A failed hand-back gets the same diagnostic as a failed test rung: the check reason plus the text.
    if (!r.ok) m.diagnostics = [...(m.diagnostics ?? []), diagnoseFailure({ kind, log: `${r.reason}\n${text}`, previous: lastDiagnostic(m, kind), attempt, at: now.toISOString() })];
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  }
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, runDir, textFile] = process.argv.slice(2);
  const opt = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const attempt = Number(opt('--attempt') ?? 1);
  if (!kind || !runDir || !textFile) {
    console.log('usage: node save_opus.mjs plan|review <runDir> <textFile> [--attempt N --approved-by "<words>"]');
    process.exit(2);
  }
  let r;
  try {
    r = saveOpus(kind, runDir, textFile, { attempt, approvedBy: opt('--approved-by') ?? null });
  } catch (e) {
    console.log(JSON.stringify({ ok: false, reason: e.message }));
    process.exit(2);
  }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
