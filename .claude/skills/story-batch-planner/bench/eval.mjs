#!/usr/bin/env node
// Scores the planner on fixtures/*.json: false-parallel rate, dependency recall, over-serialization,
// and (with --jev) Jev shadow agreement on the ambiguous pairs. Usage: node bench/eval.mjs [--jev] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, jevShadow, loadConfig } from '../scripts/planner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'fixtures');
const useJev = process.argv.includes('--jev');

export function score(fx, p) {
  const wave = new Map(p.stories.map((s) => [s.id, s.wave]));
  const deps = p.edges.filter((e) => e.relation === 'depends_on');
  const sep = [...(fx.expected.order || []), ...(fx.expected.conflict || [])];
  const sameWave = (a, b) => wave.get(a) != null && wave.get(a) === wave.get(b);
  const fp = sep.filter(([a, b]) => sameWave(a, b));
  const recalled = (fx.expected.order || []).filter(([before, after]) => deps.some((e) => e.from === after && e.to === before));
  const indep = fx.expected.independent || [];
  const overSerial = indep.filter(([a, b]) => wave.get(a) != null && wave.get(b) != null && wave.get(a) !== wave.get(b));
  const cycleOk = fx.expected.cycle ? p.blocked_or_review_required.some((r) => r.kind === 'cycle' && fx.expected.cycle.every((id) => r.stories.includes(id))) : null;
  const reviewOk = fx.expected.review ? fx.expected.review.every((id) => p.blocked_or_review_required.some((r) => r.stories.includes(id) && r.kind === 'incomplete')) : null;
  const jev = [];
  for (const e of p.edges) if (e.jev_suggestion) {
    const want = fx.expected.ambiguous?.[e.pair.join('|')];
    jev.push({ pair: e.pair.join('|'), got: e.jev_suggestion.label, p: e.jev_suggestion.p, want: want ?? null, ok: want ? want === e.jev_suggestion.label : null });
  }
  return { name: fx.name, sepPairs: sep.length, falseParallel: fp.map((x) => x.join('|')), orderPairs: (fx.expected.order || []).length, recalled: recalled.length, indepPairs: indep.length, overSerial: overSerial.map((x) => x.join('|')), cycleOk, reviewOk, waves: p.waves.map((w) => w.stories.join(',')), jev };
}

const rows = [];
let jevCost = 0, jevCalls = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const cfg = loadConfig({ overrides: { jev: { enabled: useJev, log: null } } });
  let p = plan(fx, cfg);
  if (useJev) { p = await jevShadow(fx, p, cfg); jevCost += p.jev_shadow.cost; jevCalls += p.jev_shadow.calls; }
  rows.push(score(fx, p));
}
const sum = (k) => rows.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
const tot = { sepPairs: sum('sepPairs'), falseParallel: sum('falseParallel'), orderPairs: sum('orderPairs'), recalled: sum('recalled'), indepPairs: sum('indepPairs'), overSerial: sum('overSerial') };
if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, tot, jevCalls, jevCost }, null, 2));
else {
  for (const r of rows) console.log(`${r.name.padEnd(22)} FP ${r.falseParallel.length}/${r.sepPairs}  recall ${r.recalled}/${r.orderPairs}  over-serial ${r.overSerial.length}/${r.indepPairs}  cycle ${r.cycleOk ?? '-'}  review ${r.reviewOk ?? '-'}  waves [${r.waves.join(' | ')}]${r.falseParallel.length ? `  FP: ${r.falseParallel}` : ''}`);
  console.log(`TOTAL false-parallel ${tot.falseParallel}/${tot.sepPairs}  dependency recall ${tot.recalled}/${tot.orderPairs}  over-serialized ${tot.overSerial}/${tot.indepPairs}`);
  if (useJev) { console.log(`Jev shadow: ${jevCalls} calls, $${jevCost.toFixed(5)}`); for (const r of rows) for (const j of r.jev) console.log(`  ${r.name} ${j.pair}: ${j.got} (${j.p}) want ${j.want ?? '?'} ${j.ok == null ? '' : j.ok ? 'OK' : 'MISS'}`); }
}
