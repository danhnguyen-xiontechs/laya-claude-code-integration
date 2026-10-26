// Real-output benchmark: raw command outputs captured from a real repo (ess-be), rule arm only (nothing leaves the machine).
//   node scripts/bench-real.ts <dir>     dir holds <case>.log + <case>.json {command, exit, note}
// "critical" lines are extracted from the RAW output by regexes independent of trim-core: compiler errors, failed tests,
// build/test summary lines. A case passes when none of them is lost. Writes reports/bench-real.json and prints a table.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, byteLen, decideAndBuild, planTrim, splitLines } from '../../haiku-100k/hooks/trim/core.ts';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/bench-real.ts <dir>'); process.exit(2); }
const uniq = <T>(xs: T[]) => [...new Set(xs)];
export function criticalOf(text: string): string[] {
  const out: string[] = [];
  for (const l of splitLines(text)) {
    const t = l.trim();
    if (/ error [A-Z]{2,}\d+:/.test(t)) out.push(t.replace(/\s*\[[^\]]*\]\s*$/, '')); // compiler/MSBuild error, minus the trailing [project]
    else if (/^Failed\s+\S+/.test(t) && !/^Failed!/.test(t)) out.push(t.split(' [')[0]);   // failed test line
    else if (/^(Failed|Passed)!\s+-/.test(t)) out.push(t);                                  // test run summary
    else if (/^Build (succeeded|FAILED)\./.test(t) || /^\s*\d+ Error\(s\)/.test(t)) out.push(t);
  }
  return uniq(out);
}

const rows = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const text = fs.readFileSync(path.join(dir, f.replace(/\.json$/, '.log')), 'utf8');
  const isError = meta.exit !== 0;
  const status = isError ? 'Command FAILED.' : 'Command succeeded (exit code 0).';
  const plan = planTrim(meta.command, text, DEFAULTS);
  const r = await decideAndBuild({ command: meta.command, text, opt: { ...DEFAULTS, useJev: false }, statusLine: status, rawPath: '~/.claude/smart-context-trimming/raw/x.log' });
  const out = r.built?.text ?? text;
  const crit = criticalOf(text);
  const lost = crit.filter((c) => !out.includes(c));
  rows.push({ name: meta.name ?? f.replace(/\.json$/, ''), command: meta.command, exit: meta.exit, lines: splitLines(text).length, baseline: byteLen(text), after: byteLen(out),
    reduction: +(1 - byteLen(out) / byteLen(text)).toFixed(3), trimmed: out !== text, reason: r.plan.reason, ask: plan.ask.length, critical: crit.length, lost });
}
const elig = rows.filter((r) => r.trimmed);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const summary = { cases: rows.length, trimmed: elig.length, medianReduction: med(elig.map((r) => r.reduction)), criticalTotal: rows.reduce((s, r) => s + r.critical, 0), lostTotal: rows.reduce((s, r) => s + r.lost.length, 0) };
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/bench-real.json', JSON.stringify({ summary, rows }, null, 2));
console.log('| case | exit | lines | baseline B | after B | reduction | critical | lost | reason |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.exit} | ${r.lines} | ${r.baseline} | ${r.after} | ${r.trimmed ? Math.round(r.reduction * 100) + '%' : '—'} | ${r.critical} | ${r.lost.length} | ${r.reason} |`);
console.log(JSON.stringify(summary));
