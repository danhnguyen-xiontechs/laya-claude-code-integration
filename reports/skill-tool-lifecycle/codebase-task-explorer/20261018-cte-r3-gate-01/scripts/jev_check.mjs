#!/usr/bin/env node
// pool_check.mjs — is the gold in codemap's candidate pool (top 30 per query) but outside the printed top 8?
// Full pools stay local (D:/cte-r3/pools-jev.json); the public pool-check.json has ids and numbers only.
//   node pool_check.mjs [--data D:/cte-r3] [--explore <explore.mjs>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('data', 'D:/cte-r3');
const EXPLORE = arg('explore', path.resolve(HERE, '../../../../../.claude/worktrees/cte-r3/.claude/skills/codebase-task-explorer/scripts/explore.mjs'));
const ENV = { ...process.env, CODEMAP_BIN: process.env.CODEMAP_BIN || `${os.homedir()}/tools/codemap/codemap.exe`, DECISION_PROVIDER: '' };
const units = JSON.parse(fs.readFileSync(path.join(DATA, 'units.json'), 'utf8')).filter((u) => !u.dropped);
const tasks = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DATA, 'tasks.json'), 'utf8')).map((t) => [t.id, t]));
const filtered = JSON.parse(fs.readFileSync(path.join(DATA, 'results.json'), 'utf8')).filtered.ids;

const pools = {}, rows = [];
for (const u of units) {
  const t = tasks[u.id];
  const r = spawnSync(process.execPath, [EXPLORE, '--engine', 'codemap', '--provider', 'jev', '--json', '--no-gate', '--top', '96', '--max-pool', '96', '--per-query', '30',
    '--mode', t.mode === 'feature' ? 'feature' : 'bug', '--task', t.task, '--queries', t.queries.join('|'), '--root', path.join(DATA, 'snap', u.id)], { env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(r.stdout);
  const order = j.top.map((c) => c.path.replace(/\\/g, '/'));
  pools[u.id] = { order, rulesTop: j.rulesTop, poolSize: j.poolSize, considered: j.considered, jev: { called: j.jev.called, calls: j.jev.calls, fallback: j.jev.fallback, reason: j.jev.reason, latencyMs: j.jev.latencyMs, cost: j.jev.cost, noneWon: j.jev.global?.noneWon } };
  const gold = u.gold.map((g) => g.toLowerCase());
  const jv = j.jev; const pos = gold.map((g) => order.findIndex((p) => p.toLowerCase() === g) + 1); // 0 = not in pool
  const inTop8 = pos.filter((p) => p >= 1 && p <= 8).length, inPoolOut8 = pos.filter((p) => p > 8).length, notInPool = pos.filter((p) => p === 0).length;
  rows.push({ id: u.id, filtered: filtered.includes(u.id), gold: gold.length, poolSize: j.poolSize, inTop8, inPoolOut8, notInPool, goldRanks: pos,
    recall8: inTop8 / Math.min(gold.length, 8), jevCalled: !!jv.called, jevCalls: jv.calls || 0, jevFallback: !!jv.fallback, jevLatencyMs: jv.latencyMs || 0, jevCost: jv.cost || 0, noneWon: jv.global?.noneWon ?? null, poolRecall: (inTop8 + inPoolOut8) / gold.length });
  console.error(`${u.id} pool=${j.poolSize} top8=${inTop8} pool>8=${inPoolOut8} missing=${notInPool}`);
}
const agg = (set) => ({
  units: set.length,
  goldFiles: set.reduce((s, r) => s + r.gold, 0),
  goldInTop8: set.reduce((s, r) => s + r.inTop8, 0),
  goldInPoolOutside8: set.reduce((s, r) => s + r.inPoolOut8, 0),
  goldNotInPool: set.reduce((s, r) => s + r.notInPool, 0),
  unitsWithGoldInPoolOutside8: set.filter((r) => r.inPoolOut8 > 0).length,
  unitsMissedTop8ButInPool: set.filter((r) => r.inTop8 === 0 && r.inPoolOut8 > 0).length,
  meanRecall8: set.reduce((s, r) => s + r.recall8, 0) / set.length,
  meanPoolRecall: set.reduce((s, r) => s + r.poolRecall, 0) / set.length,
});
fs.writeFileSync(path.join(DATA, 'pools-jev.json'), JSON.stringify(pools, null, 2));
const out = { experimentId: '20261018-cte-r3-gate-01', check: 'codemap pool reranked by Jev (rules + Jev batches + global rerank), top 8', generatedAt: new Date().toISOString(), filtered: agg(rows.filter((r) => r.filtered)), all: agg(rows), rows };
fs.writeFileSync(path.join(HERE, '..', 'jev-check.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ filtered: out.filtered, all: out.all }, null, 1));
