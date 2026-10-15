// Replays the SAME decision requests through Laya (local laya-serve) and Jev (OpenRouter), as the skills send them.
//   node eval/run-ab.mjs [--tasks gate,verdict,oracle,wait] [--engines laya,jev] [--jev-reps 3] [--limit N]
// Needs: laya-serve on http://localhost:8000 (for laya) and OPENROUTER_API_KEY (for jev). Raw answers go to
// eval/results/raw-<task>-<engine>.jsonl (overwritten per run); nothing but the decision request leaves the machine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATE, VERDICT, ORACLE, WAIT } from './questions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { decide } = await import(pathToFileURL(path.join(here, '..', '.claude', 'skills', 'web-test-jev-wait', 'scripts', 'decision-provider.mjs')).href);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
const TASKS = opt('--tasks', 'gate,verdict,oracle,wait').split(',');
const ENGINES = opt('--engines', 'laya,jev').split(',');
const JEV_REPS = Number(opt('--jev-reps', 3));
const LIMIT = Number(opt('--limit', 0));
const LAYA_URL = process.env.LAYA_URL || 'http://localhost:8000';
const data = (n) => JSON.parse(fs.readFileSync(path.join(here, 'data', n), 'utf8'));
fs.mkdirSync(path.join(here, 'results'), { recursive: true });

const build = {
  gate: () => data('gate.json').map((x) => ({ id: x.id, state: GATE.state(x.text), questions: GATE.question, maxLen: GATE.maxLen })),
  verdict: () => data('verdict.json').map((x) => ({ id: x.id, state: VERDICT.state(x.expected, x.actual), questions: VERDICT.question, maxLen: VERDICT.maxLen })),
  oracle: () => data('oracle.json').map((x) => ({ id: x.id, state: ORACLE.state(x.expected, x.observed, x.url, x.loading), questions: ORACLE.question, maxLen: ORACLE.maxLen })),
  // wait.mjs asks state + screen + login in ONE request
  wait: () => data('wait.json').map((x) => ({ id: x.id, state: WAIT.state({ url: x.url, title: x.title, loading: x.loading, text: x.text }), questions: WAIT.questions, maxLen: 512 })),
};

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); } }));
  return out;
}

for (const task of TASKS) {
  let items = build[task]();
  if (LIMIT) items = items.slice(0, LIMIT);
  for (const engine of ENGINES) {
    const reps = engine === 'jev' ? JEV_REPS : 1;
    const jobs = items.flatMap((it) => Array.from({ length: reps }, (_, rep) => ({ ...it, rep })));
    const t0 = Date.now();
    const rows = await pool(jobs, engine === 'jev' ? 4 : 1, async (j) => {
      const r = await decide({ provider: engine, state: j.state, questions: j.questions, laya: { url: LAYA_URL, model: 'english', maxLen: j.maxLen }, jev: {}, timeoutMs: 60000 });
      return { task, id: j.id, engine, rep: j.rep, ok: r.ok, ...(r.ok ? { answers: r.answers } : { error: r.error }), latencyMs: r.meta.latencyMs, usage: r.meta.usage, cost: r.meta.cost, model: r.meta.model };
    });
    fs.writeFileSync(path.join(here, 'results', `raw-${task}-${engine}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const ok = rows.filter((r) => r.ok).length;
    const lat = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const cost = rows.reduce((s, r) => s + (r.cost || 0), 0);
    console.log(`${task}/${engine}: ${ok}/${rows.length} ok, p50 ${lat[Math.floor(lat.length / 2)]} ms, p95 ${lat[Math.floor(lat.length * 0.95)]} ms, cost $${cost.toFixed(5)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
