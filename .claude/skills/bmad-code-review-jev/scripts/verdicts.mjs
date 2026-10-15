#!/usr/bin/env node
// verdicts.mjs — records the triage verdict of each Jev finding, and summarizes precision across runs.
//
//   node verdicts.mjs --run <run-log.json> --set "J1=medium,J2=false,J3=maybe-false"
//   node verdicts.mjs --summary
//
// Verdicts are the ones bmad-code-review's triage gives: high | medium | low | false | maybe-false.
// A finding counts as real when its verdict is high, medium or low.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './decision-provider.mjs';
import { RUN_DIR } from './rules-layer.mjs';

export const VERDICTS = ['high', 'medium', 'low', 'false', 'maybe-false'];
const REAL = new Set(['high', 'medium', 'low']);

export function parseSet(s) {
  const out = {};
  for (const part of String(s).split(',').map((x) => x.trim()).filter(Boolean)) {
    const [id, v] = part.split('=').map((x) => x.trim());
    if (!/^J\d+$/i.test(id) || !VERDICTS.includes(v)) throw new Error(`bad verdict "${part}" (want J<n>=${VERDICTS.join('|')})`);
    out[id.toUpperCase()] = v;
  }
  return out;
}

export function summarize(runs) {
  const by = {};
  for (const r of runs) {
    const k = `${r.provider}${r.model ? ` ${r.model}` : ''}`;
    const s = (by[k] ||= { runs: 0, findings: 0, judged: 0, real: 0, false: 0, maybeFalse: 0, pairs: 0, costUsd: 0 });
    s.runs++; s.findings += r.findings?.length || 0; s.pairs += r.stats?.pairsAsked || 0; s.costUsd += r.stats?.costUsd || 0;
    for (const v of Object.values(r.verdicts || {})) {
      s.judged++;
      if (REAL.has(v)) s.real++; else if (v === 'false') s.false++; else s.maybeFalse++;
    }
  }
  for (const s of Object.values(by)) {
    s.precision = s.judged ? Number((s.real / s.judged).toFixed(3)) : null;
    s.falsePerRun = s.runs ? Number((s.false / s.runs).toFixed(2)) : null;
  }
  return by;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.summary) {
    let files = [];
    try { files = fs.readdirSync(RUN_DIR).filter((f) => f.endsWith('.json')); } catch { /* none */ }
    const runs = files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUN_DIR, f), 'utf8')); } catch { return null; } }).filter(Boolean);
    console.log(JSON.stringify(summarize(runs), null, 2));
    return;
  }
  if (typeof args.run !== 'string' || typeof args.set !== 'string') { console.error('usage: verdicts.mjs --run <file> --set "J1=medium,..." | --summary'); process.exitCode = 2; return; }
  const run = JSON.parse(fs.readFileSync(args.run, 'utf8'));
  const set = parseSet(args.set);
  const ids = new Set((run.findings || []).map((f) => f.id));
  for (const id of Object.keys(set)) if (!ids.has(id)) throw new Error(`${id} is not a finding of this run`);
  run.verdicts = { ...run.verdicts, ...set };
  fs.writeFileSync(args.run, JSON.stringify(run, null, 2));
  console.log(`recorded ${Object.keys(set).length} verdicts in ${args.run}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
