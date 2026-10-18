#!/usr/bin/env node
// guardrail_laya.mjs — design.md section 5: Recall@5 on Laya eval/tasks.json, old default (rules order) vs new default
// (codemap order), same run of explore.mjs --provider none. Writes ../guardrail-laya.json (Laya paths only, public repo).
//   node guardrail_laya.mjs <skill dir in the cte-r3 worktree>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const skill = path.resolve(process.argv[2]);
const { explore } = await import(pathToFileURL(path.join(skill, 'scripts/explore.mjs')).href);
const recall = ((list, groups, k = 5) => groups.filter((g) => g.some((rel) => list.slice(0, k).some((p) => p.endsWith(rel)))).length / groups.length);
const root = path.resolve(skill, '../../..');
const { tasks } = JSON.parse(fs.readFileSync(path.join(skill, 'eval/tasks.json'), 'utf8'));
const rows = [];
for (const t of tasks) {
  const r = await explore({ task: t.task, mode: t.mode, queries: t.queries, root, provider: 'none', engine: 'codemap', gate: false });
  rows.push({ id: t.id, rulesOrder: recall(r.rulesTop, t.relevant), codemapOrder: recall(r.top.map((c) => c.path), t.relevant), elapsedMs: r.elapsedMs, notes: r.coverage.notes.filter((n) => n.startsWith('codemap find')) });
  console.error(rows.at(-1));
}
const mean = (k) => rows.reduce((s, x) => s + x[k], 0) / rows.length;
const out = { K: 5, tasks: rows.length, meanRulesOrder: mean('rulesOrder'), meanCodemapOrder: mean('codemapOrder'), p50ms: rows.map((r) => r.elapsedMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)], rows };
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'guardrail-laya.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ meanRulesOrder: out.meanRulesOrder, meanCodemapOrder: out.meanCodemapOrder, p50ms: out.p50ms }));
