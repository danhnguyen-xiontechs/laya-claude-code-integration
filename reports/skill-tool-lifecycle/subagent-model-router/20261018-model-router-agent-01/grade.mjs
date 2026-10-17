// Runs each task's own check.mjs on the agent work folders (never the agent's claim).
// Usage: node grade.mjs <rep|all> [dirSuffix...]  -> evidence/grades.json (merged)
import fs from 'node:fs';
import path from 'node:path';
import { runCheck } from '../../../../.claude/skills/subagent-model-router/bench/bench.mjs';
const here = import.meta.dirname;
const idx = JSON.parse(fs.readFileSync(path.join(here, 'evidence/run-index.json'), 'utf8'));
const gf = path.join(here, 'evidence/grades.json');
const grades = fs.existsSync(gf) ? JSON.parse(fs.readFileSync(gf, 'utf8')) : {};
const want = process.argv.slice(2);
for (const e of idx) {
  const key = path.basename(e.dir);
  if (want.length && !want.includes(key)) continue;
  if (!fs.existsSync(e.dir)) continue;
  grades[key] = { case: e.case, arm: e.arm, rep: e.rep, pass: runCheck(e.case, e.dir) };
  console.log(key, grades[key].pass);
}
fs.writeFileSync(gf, JSON.stringify(grades, null, 2));
