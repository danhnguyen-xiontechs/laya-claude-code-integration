#!/usr/bin/env node
// Deviation fix (result.md): a story-batch-planner gold is a set of invariants, so an answer can satisfy another
// case's gold too; build_dataset.mjs labelled every mismatched row `fail`. This re-labels the story-batch-planner
// rows with the design's own rule, checked mechanically on the answer's JSON line, and re-scores both engines'
// saved grades against the corrected labels (no new engine call). Real rows must agree with the script grade.
// Usage: node relabel_sbp.mjs   → ../dataset-corrected.json, ../scores.json, one summary line
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../../../../../.claude/skills/build-skill-tool-workflow/scripts/grade_with_engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXP = path.join(HERE, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(EXP, f), 'utf8'));

export function sbpPass(answer, gold) {
  const m = answer.match(/\{[\s\S]*?"needs_decision"[\s\S]*?\}/);
  if (!m) return false;
  const { waves = [] } = JSON.parse(m[0]);
  const waveOf = (s) => waves.findIndex((w) => w.includes(s));
  for (const o of gold.order ?? []) {
    const [a, b] = o.split(' before ');
    if (waveOf(a) < 0 || (waveOf(b) >= 0 && waveOf(a) >= waveOf(b))) return false;
  }
  for (const p of gold.notSameWave ?? []) {
    const [a, b] = p.split('/');
    if (waveOf(a) >= 0 && waveOf(a) === waveOf(b)) return false;
  }
  for (const s of [...(gold.cycle ?? []), ...(gold.blocked ?? [])]) if (waveOf(s) >= 0) return false;
  for (const s of gold.independent ?? []) if (waveOf(s) < 0) return false;
  return true;
}

const ds = read('dataset.json');
const changed = [], realDisagree = [];
const rows = ds.rows.map((r) => {
  if (r.kind !== 'sbp') return r;
  const truth = sbpPass(r.answer, r.gold) ? 'pass' : 'fail';
  if (r.source === 'real' && truth !== r.label) realDisagree.push(r.id);
  if (r.source === 'mismatch' && truth !== r.label) { changed.push(r.id); return { ...r, label: truth, relabelled: true }; }
  return r;
});
fs.writeFileSync(path.join(EXP, 'dataset-corrected.json'), JSON.stringify({ ...ds, correctedAt: '2026-10-18', rows }, null, 1));

const scores = { relabelled: changed, realRowsCheckerVsScript: realDisagree.length ? realDisagree : 'all agree' };
for (const p of ['jev', 'laya']) {
  const g = read(`engine-grades.${p}.json`);
  const fixed = g.rows.map((x, i) => ({ ...x, label: rows[i].label, source: rows[i].source }));
  const byKind = {};
  for (const [i, x] of fixed.entries()) {
    const k = rows[i].kind;
    byKind[k] ??= { rows: 0, agree: 0 };
    byKind[k].rows++;
    if (x.grade === x.label) byKind[k].agree++;
  }
  scores[p] = { frozenLabels: g.summary, correctedLabels: summarize(fixed), byKind };
}
fs.writeFileSync(path.join(EXP, 'scores.json'), JSON.stringify(scores, null, 1));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`relabelled ${changed.length}; real rows checker vs script: ${realDisagree.length ? realDisagree.length + ' disagree' : 'all agree'}; jev ${pct(scores.jev.correctedLabels.agreement)} (false pass ${scores.jev.correctedLabels.falsePassReal}+${scores.jev.correctedLabels.falsePassMismatch}), laya ${pct(scores.laya.correctedLabels.agreement)} (false pass ${scores.laya.correctedLabels.falsePassReal}+${scores.laya.correctedLabels.falsePassMismatch})`);
