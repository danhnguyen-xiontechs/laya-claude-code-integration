// POST-HOC diagnostic (not the gate): codegraph Recall@8 with and without the task sentence as a query.
// Run from the worktree root: node reports/.../diag-queries-only.mjs
import fs from 'node:fs';
import path from 'node:path';
import { explore, findCodegraph } from '../../../../.claude/skills/codebase-task-explorer/scripts/explore.mjs';

const root = process.cwd();
const dir = path.join(root, '.claude/skills/codebase-task-explorer/eval');
const tasks = [...JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).tasks, ...JSON.parse(fs.readFileSync(path.join(dir, 'tasks-codegraph.json'), 'utf8')).tasks];
const rec = (list, groups) => groups.filter((g) => g.some((rel) => list.slice(0, 8).some((p) => p.endsWith(rel)))).length / groups.length;
const cg = findCodegraph();
const out = [];
for (const t of tasks) {
  const withTask = await explore({ task: t.task, mode: t.mode, queries: t.queries, root, engine: 'codegraph', cg });
  // same run with the task sentence replaced by a term that matches nothing: only the Stage-0 queries count
  const queriesOnly = await explore({ task: 'zzqnomatchzz', mode: t.mode, queries: t.queries, root, engine: 'codegraph', cg });
  out.push({ id: t.id, withTask: rec(withTask.rows.map((x) => x.path), t.relevant), queriesOnly: rec(queriesOnly.rows.map((x) => x.path), t.relevant) });
}
const mean = (k) => Number((out.reduce((s, x) => s + x[k], 0) / out.length).toFixed(3));
console.log(JSON.stringify({ withTask: mean('withTask'), queriesOnly: mean('queriesOnly'), rows: out }, null, 1));
