#!/usr/bin/env node
// Offline score, no agents: Recall@5 of rulesTop (rules only) vs top (rules + Jev) vs codemapOnlyTop (raw codemap order)
// on the tasks of eval/tasks.json, same pool for all three (one explore() call with Jev per task, rules order read
// from the same result). Usage: node offline_score.mjs <repoRoot> [tasks.json] > evidence/offline-score.json
import fs from 'node:fs';
import path from 'node:path';
import { explore } from '../../../../.claude/skills/codebase-task-explorer/scripts/explore.mjs';

const root = path.resolve(process.argv[2] || '.');
const tasks = JSON.parse(fs.readFileSync(process.argv[3] || path.join(root, '.claude/skills/codebase-task-explorer/eval/tasks.json'), 'utf8')).tasks;
const norm = (p) => p.replaceAll('\\', '/').toLowerCase();
const recall = (groups, top) => groups.filter((g) => top.slice(0, 5).some((p) => g.some((x) => norm(p).endsWith(norm(x))))).length / groups.length;
const rows = [];
for (const t of tasks) {
  const r = await explore({ task: t.task, mode: t.mode, queries: t.queries, root, provider: 'jev' });
  const jevTop = r.top.map((c) => c.path);
  rows.push({ id: t.id, engine: r.engine, pool: r.poolSize, rules: recall(t.relevant, r.rulesTop), jev: recall(t.relevant, jevTop), codemapOnly: recall(t.relevant, r.codemapOnlyTop),
    jevCalls: r.jev.calls, jevFallback: r.jev.fallback, jevReason: r.jev.reason, latencyMs: r.jev.latencyMs, cost: r.jev.cost,
    rulesTop5: r.rulesTop.slice(0, 5), jevTop5: jevTop.slice(0, 5), codemapOnlyTop5: r.codemapOnlyTop.slice(0, 5) });
}
const mean = (k) => rows.reduce((s, x) => s + x[k], 0) / rows.length;
const pass = (k) => rows.filter((x) => x[k] === 1).length;
console.log(JSON.stringify({ root: path.basename(root), at: new Date().toISOString(), summary: { cases: rows.length, rules: { pass: pass('rules'), meanRecall: mean('rules') }, jev: { pass: pass('jev'), meanRecall: mean('jev') }, codemapOnly: { pass: pass('codemapOnly'), meanRecall: mean('codemapOnly') } }, rows }, null, 2));
