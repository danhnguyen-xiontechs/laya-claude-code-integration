#!/usr/bin/env node
// Builds the frozen grading dataset (design.md): saved answers + their script grades from past rounds, plus one
// mismatched negative per real row (the answer against the gold of the next case with a different gold, label fail).
// Usage: node build_dataset.mjs [--root <reports/skill-tool-lifecycle>]  → ../dataset.json, one summary line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--root');
const ROOT = i > 0 ? process.argv[i + 1] : path.resolve(HERE, '../../..');
const CUT = 1500;

const RULES = {
  acc: 'Every acceptance criterion\'s verdict in the answer must be in the accepted set of the key ("A|B" means either verdict is accepted).',
  iv: 'The batch verdict and every story\'s verdict in the answer must equal the key exactly.',
  sr: 'The answer\'s PICK line (plugin namespace and a leading "/" dropped) must equal the gold skill id; "none" means no skill.',
  sbp: 'Every invariant of the key must hold in the answer\'s waves: "order" X before Y means X is in an earlier wave than Y; "notSameWave" X/Y means not in the same wave; "cycle" and "blocked" stories must not be in any wave.',
};
const DATASETS = [
  ['acceptance-criteria-coverage/20261018-acc-agent-01', 'acc'],
  ['integration-verifier/20261018-integration-verifier-agent-01', 'iv'],
  ['integration-verifier/20261018-integration-verifier-r2-agent-01', 'iv'],
  ['skills-router/20261018-skills-router-agent-01', 'sr'],
  ['skills-router/20261018-skills-router-r2-agent-01', 'sr'],
  ['story-batch-planner/20261017-sbp-agent-01', 'sbp'],
];

// <case>.<A|B>.r<n>.txt, <case>.r<n>.<A|B>.txt or <case>.<A|B>.txt
function parseName(f) {
  const b = f.replace(/\.txt$/, '');
  let m = b.match(/^(.+)\.(A|B)\.(r\d+)$/) || b.match(/^(.+)\.(r\d+)\.(A|B)$/);
  if (m) return m[2].startsWith('r') ? { caseId: m[1], rep: m[2], arm: m[3] } : { caseId: m[1], arm: m[2], rep: m[3] };
  m = b.match(/^(.+)\.(A|B)$/);
  return m ? { caseId: m[1], arm: m[2], rep: null } : null;
}

const rows = [], skipped = [];
for (const [rel, kind] of DATASETS) {
  const dir = path.join(ROOT, rel);
  const grades = {}; // `${caseId}.${arm}.${rep}` → case
  for (const armDir of fs.readdirSync(path.join(dir, 'runs'))) {
    const arm = armDir.startsWith('A') ? 'A' : 'B';
    for (const rep of fs.readdirSync(path.join(dir, 'runs', armDir))) {
      const f = path.join(dir, 'runs', armDir, rep, 'results.json');
      if (!fs.existsSync(f)) continue;
      for (const c of JSON.parse(fs.readFileSync(f, 'utf8')).cases) grades[`${c.caseId}.${arm}.${rep}`] = c;
    }
  }
  const real = [];
  for (const f of fs.readdirSync(path.join(dir, 'evidence', 'answers')).sort()) {
    const n = parseName(f);
    let key = n && n.rep ? `${n.caseId}.${n.arm}.${n.rep}` : null;
    if (n && !n.rep) {
      const hits = Object.keys(grades).filter((k) => k.startsWith(`${n.caseId}.${n.arm}.`));
      key = hits.length === 1 ? hits[0] : null;
    }
    const c = key && grades[key];
    if (!c || !['pass', 'fail'].includes(c.status)) { skipped.push(`${rel}/${f}`); continue; }
    const text = fs.readFileSync(path.join(dir, 'evidence', 'answers', f), 'utf8');
    real.push({ id: `${rel}/${f}`, dataset: rel, kind, caseId: c.caseId, rule: RULES[kind], gold: c.goldOutcome,
      answer: text.slice(0, CUT), cut: text.length > CUT, label: c.status, source: 'real' });
  }
  const golds = [...new Map(real.map((r) => [r.caseId, r.gold])).entries()];
  for (const r of real) {
    const at = golds.findIndex(([id]) => id === r.caseId);
    const other = [...golds.slice(at + 1), ...golds.slice(0, at)].find(([, g]) => JSON.stringify(g) !== JSON.stringify(r.gold));
    rows.push(r);
    if (other) rows.push({ ...r, id: `${r.id}#vs:${other[0]}`, gold: other[1], label: 'fail', source: 'mismatch', goldOf: other[0] });
  }
}
const count = (f) => rows.filter(f).length;
fs.writeFileSync(path.join(HERE, '..', 'dataset.json'), JSON.stringify({ frozenAt: '2026-10-18', rows }, null, 1));
console.log(`dataset: ${rows.length} rows (real ${count((r) => r.source === 'real')}, of which fail ${count((r) => r.source === 'real' && r.label === 'fail')}; mismatch ${count((r) => r.source === 'mismatch')}; cut ${count((r) => r.cut)}); skipped ${skipped.length}${skipped.length ? ': ' + skipped.join(', ') : ''}`);
