#!/usr/bin/env node
// analyze.mjs - what the engine decided in arm B and whether it matched the answer key; writes evidence/engine-analysis.json
import fs from 'node:fs';
import path from 'node:path';
import { loadTool } from './retro.mjs';
const ROOT = 'D:/XionTechs/Laya/.claude/worktrees/hopeful-mestorf-48efe4/reports/skill-tool-lifecycle';
const DIRS = { acc: 'acceptance-criteria-coverage/20261018-acc-agent-01', dcf: 'dead-code-finder/20261018-dcf-agent-01', grs: 'git-risk-scanner/20261018-grs-agent-01' };
const out = {};
const logs = (exp, caseId, rep) => {
  const f = path.join(exp, 'evidence', '_logs', `${caseId}.B.r${rep}.jsonl`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
for (const slug of ['acc', 'dcf', 'grs']) {
  const exp = path.join(ROOT, DIRS[slug]);
  const tool = await loadTool(slug);
  const idx = JSON.parse(fs.readFileSync(path.join(exp, 'evidence', 'run-index.json'), 'utf8'));
  const res = {};
  for (const c of tool.cases) for (const rep of [1, 2]) {
    const L = logs(exp, c.id, rep);
    const key = `${c.id}.r${rep}`;
    const runs = L.length;
    if (slug === 'grs') {
      res[key] = { wrapperRuns: runs, rows: L.at(-1)?.rows?.filter((r) => r.file === c.file).map((r) => ({ formula: r.formula, jevP: r.jev.p ?? null, jevAdjust: r.jev.adjust ?? null, risk: r.risk, flagged: r.flagged })) ?? null };
    } else if (slug === 'dcf') {
      const l = L.at(-1);
      if (!l) { res[key] = { wrapperRuns: 0 }; continue; }
      const dead = c.gold.filter((g) => g.class === 'dead'); const decoy = c.gold.filter((g) => g.class === 'decoy');
      const { gradeAnswer } = await import('./tools/dcf.mjs');
      const classify = (cd) => {
        const what = cd.symbol ?? '';
        const g = gradeAnswer(c, JSON.stringify({ delete: [{ file: cd.file, what: what || "?" }] }), "W");
        return g.deadFound ? 'dead' : g.decoyHits.length ? 'decoy' : g.neutral.length ? 'neutral' : 'unlisted';
      };
      const unused = l.candidates.filter((cd) => cd.id.startsWith('C') && cd.symbol);
      const tierA = unused.filter((cd) => cd.tier === 'A').map((cd) => ({ symbol: cd.symbol, file: cd.file, cls: classify(cd) }));
      const tierC = unused.filter((cd) => cd.tier === 'C').length;
      res[key] = {
        wrapperRuns: runs, tiers: l.tiers, changedByJev: l.changedByJev, sent: l.sent, answered: l.answered, latencyMs: l.latencyMs, cost: l.cost,
        unusedTierA: tierA.length, tierA_dead: tierA.filter((x) => x.cls === 'dead').length, tierA_decoy: tierA.filter((x) => x.cls === 'decoy').length,
        tierA_neutral: tierA.filter((x) => x.cls === 'neutral').length, tierA_unlisted: tierA.filter((x) => x.cls === 'unlisted').map((x) => `${x.file}:${x.symbol}`),
        tierA_decoys: tierA.filter((x) => x.cls === 'decoy').map((x) => `${x.file}:${x.symbol}`),
        deadInTierBorC: dead.length - tierA.filter((x) => x.cls === 'dead').length,
      };
    } else {
      const l = L.at(-1);
      if (!l) { res[key] = { wrapperRuns: 0 }; continue; }
      const A = JSON.parse(fs.readFileSync(path.join(exp, 'evidence', 'answers', `${c.id}.A.r${rep}.txt`), 'utf8').replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
      const B = JSON.parse(fs.readFileSync(path.join(exp, 'evidence', 'answers', `${c.id}.B.r${rep}.txt`), 'utf8').replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
      const cited = new Set(Object.values(B).flatMap((v) => v.tests ?? []));
      const skippable = l.labels.filter((p) => p.skippable);
      const skippedButCited = skippable.filter((p) => (B[p.criterion]?.tests ?? []).includes(p.test));
      // trap = criterion whose gold excludes Covered/Partial but a name-only test exists: label Jev gave to its best-named test
      const verdictsSame = Object.keys(A).every((k) => A[k]?.coverage === B[k]?.coverage);
      const goldOf = c.gold;
      const wrongDirection = Object.entries(goldOf).filter(([id, ok]) => ok.includes('Missing') || ok.includes('Unclear')).map(([id]) => ({ id, labels: l.labels.filter((p) => p.criterion === id && ['direct_coverage', 'partial_coverage'].includes(p.label)).map((p) => `${p.test.split('::')[1]}=${p.label} p=${p.p}`) }));
      res[key] = { wrapperRuns: runs, pairs: l.pairs, labelled: l.labelled, skippable: skippable.length, skippableButCitedByAgent: skippedButCited.length, verdictsIdenticalAB: verdictsSame, missingCriteriaWithPositiveLabel: wrongDirection };
    }
  }
  out[slug] = res;
  fs.writeFileSync(path.join(exp, 'evidence', 'engine-analysis.json'), JSON.stringify(res, null, 2));
}
console.log(JSON.stringify(out, null, 1).slice(0, 9000));
