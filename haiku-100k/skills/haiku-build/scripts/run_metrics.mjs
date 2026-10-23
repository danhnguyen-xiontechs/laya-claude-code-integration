#!/usr/bin/env node
// Run metrics (v3): per-stage durations, attempt counts, test outcomes, repeated failures and the AC status
// counts of one run, computed from manifest.json only. A measurement the manifest does not hold is left out
// and named in `missing`; nothing is estimated. Used by build_report.mjs (manual) and auto.mjs endRun (auto).
//
// Usage: node run_metrics.mjs <runDir>   prints the metrics of <runDir>/manifest.json as one JSON line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repeatedFailures } from './failure.mjs';
import { acEvidence } from './ac_map.mjs';

/** Milliseconds per phase, summed over its windows; null for a phase with an open or unparsable window. */
export function stageDurations(phases = []) {
  const out = {};
  for (const p of phases ?? []) {
    if (!p?.phase) continue;
    const from = Date.parse(p.from), to = Date.parse(p.to);
    const ms = Number.isFinite(from) && Number.isFinite(to) && to >= from ? to - from : null;
    out[p.phase] = p.phase in out ? (out[p.phase] == null || ms == null ? null : out[p.phase] + ms) : ms;
  }
  return out;
}

/**
 * Metrics of a manifest: { stages, attempts: { tests, plan, review, fixRounds? }, tests: { final, runs },
 * repeatedFailures, failures, acs?, missing: [names of unavailable measurements] }.
 */
export function runMetrics(m = {}) {
  const missing = [];
  const out = {};
  if (m?.phases?.length) out.stages = stageDurations(m.phases);
  else missing.push('stages');

  const attempts = {};
  if (m?.attempts?.length) attempts.tests = m.attempts.length;
  else missing.push('attempts.tests');
  if (Array.isArray(m?.opusCalls)) {
    attempts.plan = m.opusCalls.filter((c) => c.step === '02-plan').length;
    attempts.review = m.opusCalls.filter((c) => c.step === '04-review').length;
  } else missing.push('attempts.plan', 'attempts.review');
  if (m?.auto?.fixRounds != null) attempts.fixRounds = m.auto.fixRounds;
  if (Object.keys(attempts).length) out.attempts = attempts;

  const tests = {};
  if (m?.tests && (m.tests.passed != null || m.tests.failed != null)) {
    tests.final = { command: m.tests.command ?? null, passed: m.tests.passed ?? null, failed: m.tests.failed ?? null };
  } else missing.push('tests.final');
  if (m?.attempts?.length) {
    tests.runs = m.attempts.map((a) => ({
      attempt: a.attempt, ok: a.ok, ...(a.passed != null ? { passed: a.passed } : {}), ...(a.failed != null ? { failed: a.failed } : {}),
    }));
  } else missing.push('tests.runs');
  if (Object.keys(tests).length) out.tests = tests;

  if (Array.isArray(m?.failures)) {
    out.failures = m.failures.length;
    out.repeatedFailures = repeatedFailures(m.failures);
  } else missing.push('failures');

  if (m?.acMap?.acs) {
    const rows = acEvidence(m.acMap, { tests: m.tests });
    const count = (s) => rows.filter((r) => r.status === s).length;
    out.acs = { total: rows.length, pass: count('pass'), fail: count('fail'), not_run: count('not_run'), unmapped: count('unmapped') };
  } else missing.push('acs');

  out.missing = missing;
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) { console.log('usage: node run_metrics.mjs <runDir>'); process.exit(2); }
  const mf = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(mf)) { console.log(JSON.stringify({ error: `missing required artifact: manifest.json in ${runDir}` })); process.exit(1); }
  console.log(JSON.stringify(runMetrics(JSON.parse(fs.readFileSync(mf, 'utf8')))));
}
