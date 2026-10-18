#!/usr/bin/env node
// Grades case answers against a known gold with Jev or Laya (one System One `choice` call per row: pass / fail).
// Shadow only: it never changes a script grade. A failed call, timeout or malformed answer gives grade null.
//
// Usage: node grade_with_engine.mjs <rows.json> --provider jev|laya [--out <file>] [--laya-url <url>] [--concurrency 4]
// Reads:  rows.json { rows: [{ id, rule, gold, answer, label? }] }  (label = the script grade, pass|fail, when known)
// Writes: --out (default <rows dir>/engine-grades.<provider>.json): per-row grade + p + latency, and the summary
//         (agreement, false passes, p50 latency, cost). Prints one summary line.
import fs from 'node:fs';
import path from 'node:path';
import { decide } from './decision-provider.mjs';

export const THRESHOLD = 0.5;

export function buildRequest({ rule, gold, answer }) {
  const text = [
    `Pass rule: ${rule}`,
    `Key (expected answer): ${typeof gold === 'string' ? gold : JSON.stringify(gold)}`,
    `Answer to grade:\n${answer}`,
  ].join('\n');
  return {
    state: { text },
    questions: {
      grade: {
        type: 'choice',
        instructions: 'Does the answer meet the pass rule against the key?',
        criteria: {
          pass: 'The answer meets the pass rule: everything the key requires is in the answer, with no conflicting verdict.',
          fail: 'The answer breaks the pass rule: a required item is missing, different or contradicted.',
        },
      },
    },
  };
}

/** Engine result → { grade: 'pass'|'fail'|null, p: p(pass)|null, error? } */
export function interpret(r, threshold = THRESHOLD) {
  if (!r?.ok) return { grade: null, p: null, error: r?.error ?? 'no result' };
  const probs = r.answers?.grade?.probabilities;
  const p = typeof probs?.pass === 'number' ? probs.pass : typeof probs?.fail === 'number' ? 1 - probs.fail : null;
  if (p === null || Number.isNaN(p)) return { grade: null, p: null, error: 'malformed answer' };
  return { grade: p >= threshold ? 'pass' : 'fail', p };
}

export async function gradeRows(rows, { provider, laya = {}, concurrency = 4, decideImpl = decide, timeoutMs = 15000 } = {}) {
  const out = new Array(rows.length);
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const k = next++;
      const row = rows[k];
      const r = await decideImpl({ provider, ...buildRequest(row), laya, timeoutMs });
      const g = interpret(r);
      out[k] = { id: row.id, label: row.label ?? null, source: row.source ?? null, ...g, latencyMs: r?.meta?.latencyMs ?? null, cost: r?.meta?.cost ?? null };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return out;
}

export function summarize(graded) {
  const lab = graded.filter((g) => g.label);
  const agree = lab.filter((g) => g.grade === g.label).length;
  const falsePass = (src) => lab.filter((g) => (src ? g.source === src : true) && g.label === 'fail' && g.grade === 'pass').length;
  const fails = (src) => lab.filter((g) => (src ? g.source === src : true) && g.label === 'fail').length;
  const lat = graded.map((g) => g.latencyMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const costs = graded.map((g) => g.cost).filter((x) => typeof x === 'number');
  return {
    rows: graded.length,
    graded: graded.filter((g) => g.grade).length,
    nullGrades: graded.filter((g) => !g.grade).length,
    agreement: lab.length ? agree / lab.length : null,
    falsePassReal: falsePass('real'), realFails: fails('real'),
    falsePassMismatch: falsePass('mismatch'), mismatchRows: fails('mismatch'),
    falsePassMismatchRate: fails('mismatch') ? falsePass('mismatch') / fails('mismatch') : null,
    falseFail: lab.filter((g) => g.label === 'pass' && g.grade === 'fail').length,
    p50Ms: lat.length ? lat[Math.floor(lat.length / 2)] : null,
    p90Ms: lat.length ? lat[Math.floor(lat.length * 0.9)] : null,
    costUSD: costs.length ? Number(costs.reduce((s, x) => s + x, 0).toFixed(6)) : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const file = args[0]?.startsWith('--') ? null : args[0];
  const provider = opt('provider');
  if (!file || !['jev', 'laya'].includes(provider)) {
    console.error('Usage: node grade_with_engine.mjs <rows.json> --provider jev|laya [--out <file>] [--laya-url <url>] [--concurrency 4]');
    process.exit(2);
  }
  const { rows } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const graded = await gradeRows(rows, { provider, laya: { url: opt('laya-url', 'http://localhost:8000') }, concurrency: Number(opt('concurrency', 4)) });
  const summary = summarize(graded);
  const out = opt('out', path.join(path.dirname(file), `engine-grades.${provider}.json`));
  fs.writeFileSync(out, JSON.stringify({ provider, threshold: THRESHOLD, generatedAt: new Date().toISOString(), summary, rows: graded }, null, 1));
  const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  console.log(`${provider}: agreement ${pct(summary.agreement)} on ${summary.rows} rows, false pass real ${summary.falsePassReal}/${summary.realFails}, mismatch ${summary.falsePassMismatch}/${summary.mismatchRows}, null ${summary.nullGrades}, p50 ${summary.p50Ms} ms → ${out}`);
}
