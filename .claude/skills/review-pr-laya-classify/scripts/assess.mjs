// assess.mjs — counts, score, verdict and merge assessment from Claude's FINAL severities.
//
//   node assess.mjs --findings <pr-<id>.findings.json> [--coverage <read>/<ledger>] [--laya <pr-<id>.laya.json>]
//
// Verdict and merge use severity only (the score is informational):
//   any Critical/Major          → Request Changes · Blocked
//   only Minor/Suggestion       → Approve with Suggestions · Eligible
//   no findings                 → Approve · Eligible
// Laya takes no part. With --laya, the final severities and the re-check results recorded in
// the findings file (finding.recheck = { result: "kept"|"changed", from, reason }) are written
// back into the Laya log, so it can be used for evaluation.
// Prints the report header lines, then a JSON summary. Exit 0 ok, 1 bad input.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { counts, merge, readFindings, score, verdict } from './laya-severity.mjs';

export function assess(findings, { coverage = null } = {}) {
  const c = counts(findings);
  const s = score(c);
  const v = verdict(c);
  const m = merge(c);
  const cov = coverage ? ` · **Coverage:** ${coverage} files` : '';
  const header = [
    `## PR Review — ${v}`,
    '',
    `**Score:** ${s}/100 · **Merge:** ${m}${cov}`,
    `**Findings:** 🔴 Critical ${c.Critical} · 🟠 Major ${c.Major} · 🟡 Minor ${c.Minor} · 🔵 Suggestion ${c.Suggestion}`,
  ];
  return { counts: c, score: s, verdict: v, merge: m, header };
}

/** Writes final severities and re-check results into the Laya log. Returns warnings. */
export function finalizeLog(log, findings) {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const warnings = [];
  for (const r of log.results ?? []) {
    const f = byId.get(r.id);
    if (!f) { r.final = null; warnings.push(`${r.id}: in the Laya log but not in the findings file (dropped?)`); continue; }
    r.final = f.severity;
    if (f.recheck) r.recheckResult = { result: f.recheck.result ?? null, from: f.recheck.from ?? r.claude, reason: f.recheck.reason ?? null };
    if (r.recheck === 'requested' && !f.recheck) warnings.push(`${r.id}: re-check was requested but no finding.recheck was recorded`);
  }
  log.finalizedAt = new Date().toISOString();
  return warnings;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--findings', '--coverage', '--laya'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const USAGE = 'Usage: node assess.mjs --findings <file> [--coverage <read>/<ledger>] [--laya <laya.json>]';

export function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  try {
    const a = parseArgs(argv);
    if (a.help) { log(USAGE); return 0; }
    if (!a.findings) { error(USAGE); return 1; }
    if (a.coverage && !/^\d+\/\d+$/.test(a.coverage)) throw new Error('--coverage must look like 12/12');
    const { findings } = readFindings(path.resolve(a.findings));
    const res = assess(findings, { coverage: a.coverage });
    const warnings = [];
    if (a.laya && fs.existsSync(a.laya)) {
      const layaLog = JSON.parse(fs.readFileSync(a.laya, 'utf8'));
      warnings.push(...finalizeLog(layaLog, findings));
      fs.writeFileSync(a.laya, JSON.stringify(layaLog, null, 2) + '\n');
    }
    log(res.header.join('\n'));
    log('');
    log(JSON.stringify({ counts: res.counts, score: res.score, verdict: res.verdict, merge: res.merge, warnings }, null, 2));
    return 0;
  } catch (err) {
    error(`assess: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
