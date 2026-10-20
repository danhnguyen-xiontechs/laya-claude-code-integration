#!/usr/bin/env node
// run-eval.mjs — quick pilot: B (codemap-only) vs C (rules) vs D (rules + Jev batches) on Recall@5.
//   node run-eval.mjs [--root <repo>] [--tasks <tasks.json>] [--max-calls 3] [--shard i/n] [--provider jev|none] [--engine auto|fallback] [--out results.json] [--max-pool 48] [--batch 24]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore } from '../scripts/explore.mjs';
import { parseArgs } from '../scripts/decision-provider.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const a = parseArgs(process.argv.slice(2));
const root = a.root ? path.resolve(a.root) : path.resolve(here, '../../../..');
const { tasks: allTasks } = JSON.parse(fs.readFileSync(a.tasks ? path.resolve(a.tasks) : path.join(here, 'tasks.json'), 'utf8'));

const [shardI, shardN] = (a.shard || '0/1').split('/').map(Number);
const tasks = allTasks.filter((_, i) => i % shardN === shardI);

export function recallAt(list, groups, k = 5) {
  const top = list.slice(0, k);
  return groups.filter((g) => g.some((rel) => top.some((p) => p.endsWith(rel)))).length / groups.length;
}

const rows = [];
let calls = 0;
for (const t of tasks) {
  const r = await explore({ task: t.task, mode: t.mode, queries: t.queries, root, provider: a.provider || 'none', engine: a.engine || 'auto',
    opts: { maxPool: Number(a['max-pool'] || 48), batch: Number(a.batch || 24), keep: 4, maxCalls: Number(a['max-calls'] || 3) } });
  calls += r.jev.calls || 0;
  const D = r.top.map((c) => c.path);
  rows.push({ id: t.id, mode: t.mode, pool: r.poolSize, B: recallAt(r.codemapOnlyTop, t.relevant), C: recallAt(r.rulesTop, t.relevant), D: r.jev.called && !r.jev.fallback ? recallAt(D, t.relevant) : null,
    jevCalls: r.jev.calls || 0, noneWon: r.jev.global?.noneWon ?? null, fallback: r.jev.fallback || false, reason: r.jev.reason || r.jev.skipped || null, latencyMs: r.jev.latencyMs || 0, cost: r.jev.cost || 0,
    top5: { B: r.codemapOnlyTop.slice(0, 5), C: r.rulesTop.slice(0, 5), D: D.slice(0, 5) }, engine: r.engine, coverage: r.coverage.status });
  console.error(`${t.id}: B=${rows.at(-1).B} C=${rows.at(-1).C} D=${rows.at(-1).D} calls=${r.jev.calls || 0}`);
}
const mean = (k) => { const v = rows.map((x) => x[k]).filter((x) => x != null); return v.length ? Number((v.reduce((s, x) => s + x, 0) / v.length).toFixed(3)) : null; };
const summary = { tasks: rows.length, B: mean('B'), C: mean('C'), D: mean('D'), jevCalls: calls, latencyMs: rows.reduce((s, x) => s + x.latencyMs, 0), cost: Number(rows.reduce((s, x) => s + x.cost, 0).toFixed(5)) };
console.log(JSON.stringify(summary));
if (a.out) fs.writeFileSync(a.out, JSON.stringify({ summary, rows }, null, 2));
