#!/usr/bin/env node
// compare_orders.mjs — Recall@8 per unit for codemap order, rules order and rules+Jev, from the local pools
// (D:/cte-r3/pools.json, pools-jev.json). Writes ../order-compare.json (ids and numbers only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = process.argv[2] || 'D:/cte-r3';
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const units = read('units.json'), p = read('pools.json'), pj = read('pools-jev.json'), filtered = read('results.json').filtered.ids;
const norm = (x) => x.toLowerCase().split('\\').join('/');
const rec = (list, gold) => { const top = new Set(list.slice(0, 8).map(norm)); const h = gold.filter((g) => top.has(norm(g))).length; return { recall: h / Math.min(gold.length, 8), hit: h > 0 }; };
const rows = units.map((u) => {
  const jv = pj[u.id].jev;
  return { id: u.id, filtered: filtered.includes(u.id), gold: u.gold.length, codemap: rec(p[u.id].order, u.gold), rules: rec(p[u.id].rulesTop, u.gold), jev: rec(pj[u.id].order, u.gold),
    jevCalls: jv.calls || 0, jevLatencyMs: jv.latencyMs || 0, jevCost: jv.cost || 0, jevFallback: !!jv.fallback, jevReason: jv.reason || null, noneWon: jv.noneWon ?? null };
});
const sum = (set) => Object.fromEntries(['codemap', 'rules', 'jev'].map((k) => [k, { recall: Math.round(1000 * set.reduce((s, r) => s + r[k].recall, 0) / set.length) / 1000, hit: set.filter((r) => r[k].hit).length, n: set.length }]));
const lat = rows.map((r) => r.jevLatencyMs).sort((a, b) => a - b);
const out = { filtered: sum(rows.filter((r) => r.filtered)), all: sum(rows), jev: { calls: rows.reduce((s, r) => s + r.jevCalls, 0), cost: rows.reduce((s, r) => s + r.jevCost, 0), fallbacks: rows.filter((r) => r.jevFallback).length, latencyP50Ms: lat[Math.floor(lat.length / 2)], latencyMaxMs: lat.at(-1) }, rows };
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'order-compare.json'), JSON.stringify(out, null, 2));
for (const r of rows) console.log(r.id, r.filtered ? 'F' : ' ', 'codemap', r.codemap.recall.toFixed(3), 'rules', r.rules.recall.toFixed(3), 'jev', r.jev.recall.toFixed(3), 'calls', r.jevCalls, `${r.jevLatencyMs} ms`, r.jevFallback ? `FALLBACK ${r.jevReason}` : '', r.noneWon ? 'noneWon' : '');
console.log(JSON.stringify({ filtered: out.filtered, all: out.all, jev: out.jev }));
