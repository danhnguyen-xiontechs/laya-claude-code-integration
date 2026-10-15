// Extra arm (NOT part of the like-for-like swap): does giving the verdict question the EARLIER steps of the same run fix
// the cross-reference failures seen on real steps ("Total hours equals the TC01 value", "Same value as step 1")?
//   node eval/run-context-arm.mjs [--jev-reps 3]      → eval/results/raw-verdictctx-{laya,jev}.jsonl, then re-run analyze
// Only the 20 REAL steps are used (their run order is known); the state gets `earlier_steps` = up to 6 previous steps
// of the same run as { step, expected, actual (≤200 chars) } — never the current step's status.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERDICT } from './questions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { decide } = await import(pathToFileURL(path.join(root, '.claude', 'skills', 'web-test-jev-wait', 'scripts', 'decision-provider.mjs')).href);
const argv = process.argv.slice(2);
const REPS = Number(argv[argv.indexOf('--jev-reps') + 1] || 3);

/** Same ordering/IDs as build-datasets.mjs, plus the earlier steps of the run. */
const items = [];
for (const d of fs.readdirSync(path.join(root, 'ess-test-runs')).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(root, 'ess-test-runs', d, 'results.json'), 'utf8'));
  const seen = [];
  for (const c of r.cases) for (const s of c.steps || []) {
    if (!s.expected || !['pass', 'fail', 'blocked'].includes(s.status)) continue;
    items.push({ id: `real-${d.split('-')[0]}-${d.split('-').slice(-2).join('')}-${c.id}-S${s.n}`, expected: s.expected, actual: s.actual ?? '', truth: s.status, earlier: seen.slice(-6).map((x) => ({ ...x })) });
    seen.push({ step: `${c.id}-S${s.n}`, expected: s.expected, actual: String(s.actual ?? '').slice(0, 200) });
  }
}
const withCtx = (it) => ({ ...VERDICT.state(it.expected, it.actual), ...(it.earlier.length ? { earlier_steps: it.earlier } : {}) });
for (const engine of ['laya', 'jev']) {
  const reps = engine === 'jev' ? REPS : 1;
  const rows = [];
  for (const it of items) for (let rep = 0; rep < reps; rep++) {
    const r = await decide({ provider: engine, state: withCtx(it), questions: VERDICT.question, laya: { url: process.env.LAYA_URL || 'http://localhost:8000', model: 'english', maxLen: VERDICT.maxLen }, jev: {}, timeoutMs: 60000 });
    rows.push({ task: 'verdictctx', id: it.id, engine, rep, ok: r.ok, ...(r.ok ? { answers: r.answers } : { error: r.error }), latencyMs: r.meta.latencyMs, usage: r.meta.usage, cost: r.meta.cost, model: r.meta.model });
  }
  fs.writeFileSync(path.join(here, 'results', `raw-verdictctx-${engine}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`verdictctx/${engine}: ${rows.filter((r) => r.ok).length}/${rows.length} ok`);
}
fs.writeFileSync(path.join(here, 'data', 'verdictctx.json'), JSON.stringify(items.map(({ id, truth, earlier }) => ({ id, truth, earlierSteps: earlier.length })), null, 1) + '\n');
