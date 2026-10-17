#!/usr/bin/env node
// Diagnostic, no agent and no Jev call: for each case, is a gold group in each arm's candidate pool?
//   B pool      = the tool's own pipeline before Jev (findCodemap → codemapFind → cleanup → rulesRank, first 96)
//   B rules top5 = the first five of that rules order (what the tool would hand over without Jev)
//   A list      = the paths the arm A helper printed the first time (first/<case>.A.txt)
// Separates a retrieval gap (gold not in the pool) from a ranking gap (in the pool, not in the top five).
//
// Usage: node pool_check.mjs --workmap <scratch>/workmap.json --first <scratch>/first --tasks <tasks.json> --out <file>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const workmap = JSON.parse(fs.readFileSync(opt('--workmap'), 'utf8'));
const firstDir = opt('--first');
const tasks = JSON.parse(fs.readFileSync(opt('--tasks'), 'utf8')).tasks;
const outFile = opt('--out');

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
const groupHit = (group, paths) => group.some((g) => paths.some((p) => p === norm(g) || p.endsWith('/' + norm(g))));
const first5 = (paths) => [...new Set(paths)].slice(0, 5);

const results = [];
for (const t of tasks.slice(0, 4)) {
  const bEntry = workmap.find((w) => w.caseId === t.id && w.arm === 'B');
  const explore = pathToFileURL(path.join(bEntry.repo, '.claude', 'skills', 'codebase-task-explorer', 'scripts', 'explore.mjs')).href;
  const ex = await import(explore);
  const cm = ex.findCodemap();
  if (!cm) throw new Error('codemap not found by the tool');
  const qs = [...new Set([t.task, ...t.queries].map((q) => String(q).trim()).filter(Boolean))];
  const { hits, coverage } = ex.codemapFind(cm, bEntry.repo, qs, ex.DEFAULTS.perQuery);
  const pool = ex.cleanup(hits);
  const ruled = ex.rulesRank(pool, hits, t.mode).slice(0, ex.DEFAULTS.maxPool);
  const poolPaths = ruled.map((c) => norm(c.path));
  const rulesTop5 = first5(poolPaths);

  let aPaths = [];
  const aFile = path.join(firstDir, `${t.id}.A.txt`);
  if (fs.existsSync(aFile)) {
    aPaths = fs.readFileSync(aFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => norm(l.slice(2).replace(/\s+\[[^\]]*\]\s*$/, '')));
  }
  const groups = t.relevant.map((g) => ({
    group: g,
    inPoolB: groupHit(g, poolPaths),
    inRulesTop5B: groupHit(g, rulesTop5),
    inListA: groupHit(g, aPaths),
  }));
  results.push({
    caseId: t.id, mode: t.mode, engine: `codemap ${cm.version}`, coverage: coverage.status,
    poolSizeB: ruled.length, listSizeA: new Set(aPaths).size,
    recallPoolB: groups.filter((x) => x.inPoolB).length / groups.length,
    recallRulesTop5B: groups.filter((x) => x.inRulesTop5B).length / groups.length,
    recallListA: groups.filter((x) => x.inListA).length / groups.length,
    groups, rulesTop5B: rulesTop5,
  });
}
const out = { generatedBy: 'pool_check.mjs', note: 'diagnostic; no agent, no Jev call', results };
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(results.map(({ caseId, poolSizeB, listSizeA, recallPoolB, recallRulesTop5B, recallListA }) => ({ caseId, poolSizeB, listSizeA, recallPoolB, recallRulesTop5B, recallListA })), null, 2));
