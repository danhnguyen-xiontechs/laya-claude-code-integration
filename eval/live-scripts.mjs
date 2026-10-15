// End-to-end run of gate.mjs / verdict.mjs / oracle.mjs of the Laya skills and the Jev skills on the REAL plans and
// steps of the 6 earlier ESS runs (ess-test-runs/*/results.json, copied to a temp dir — originals are never touched).
// Same inputs for both skills; real Laya (local laya-serve) and real Jev (OpenRouter).   node eval/live-scripts.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SK = (name) => path.join(root, '.claude', 'skills', name, 'scripts');
const ENGINES = { laya: { gate: 'web-test-laya-gate', verdict: 'web-test-laya-verdict', oracle: 'web-test-laya-oracle', tag: 'laya' },
  jev: { gate: 'web-test-jev-gate', verdict: 'web-test-jev-verdict', oracle: 'web-test-jev-oracle', tag: 'jev' } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-scripts-'));

function run(script, args, home) {
  return new Promise((resolve) => {
    const env = { ...process.env, USERPROFILE: home, HOME: home, JEV_ENABLED: '1', LAYA_URL: process.env.LAYA_URL || 'http://localhost:8000' };
    const t0 = Date.now();
    const c = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => c.kill(), 60000);
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim(), ms: Date.now() - t0 }); });
  });
}
const kv = (line) => Object.fromEntries([...String(line).matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

const runs = fs.readdirSync(path.join(root, 'ess-test-runs')).sort();
const out = { at: new Date().toISOString(), runs: runs.length, gate: {}, verdict: {}, oracle: {} };

for (const [engine, S] of Object.entries(ENGINES)) {
  const home = fs.mkdtempSync(path.join(tmp, `home-${engine}-`));
  // ---- gate: every step of every run is a READ step (the tickets are read-only), so any dispute/write is a false alarm
  const g = { steps: 0, write: 0, disputed: 0, read: 0, engineOn: 0, runs: 0, ms: [] };
  for (const d of runs) {
    const dir = path.join(tmp, `${engine}-gate-${d}`); fs.mkdirSync(dir, { recursive: true });
    const res = JSON.parse(fs.readFileSync(path.join(root, 'ess-test-runs', d, 'results.json'), 'utf8'));
    for (const c of res.cases) for (const s of c.steps || []) { delete s.writes; delete s.gate; }
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(res));
    const r = await run(path.join(SK(S.gate), 'gate.mjs'), [dir], home);
    const line = r.out.split(/\r?\n/).filter((l) => l.startsWith('gate:')).pop() || '';
    const k = kv(line); g.runs++; g.steps += Number(k.steps || 0); g.write += Number(k.write || 0); g.disputed += Number(k.disputed || 0); g.read += Number(k.read || 0);
    if (k[S.tag] === 'on') g.engineOn++; g.ms.push(r.ms);
    g.lastLine = line;
  }
  g.medianRunMs = median(g.ms); delete g.ms; out.gate[engine] = g;

  // ---- verdict + oracle on each real step (skip steps whose recorded `actual` is empty)
  for (const kind of ['verdict', 'oracle']) {
    const rows = [];
    for (const d of runs) {
      const dir = path.join(tmp, `${engine}-${kind}-${d}`); fs.mkdirSync(dir, { recursive: true });
      const res = JSON.parse(fs.readFileSync(path.join(root, 'ess-test-runs', d, 'results.json'), 'utf8'));
      const truth = {};
      for (const c of res.cases) for (const s of c.steps || []) { truth[`${c.id}-${s.n}`] = s.status; for (const f of ['status', 'verdict', 'gate', 'actual', 'at']) if (f !== 'actual') delete s[f]; }
      fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(res));
      for (const c of res.cases) for (const s of c.steps || []) {
        const actual = JSON.parse(fs.readFileSync(path.join(root, 'ess-test-runs', d, 'results.json'), 'utf8')).cases.find((x) => x.id === c.id).steps.find((x) => x.n === s.n).actual;
        if (!actual || !s.expected) continue;
        const args = kind === 'verdict' ? [dir, c.id, String(s.n), '--actual', actual] : [dir, c.id, String(s.n), '--observed', actual];
        const r = await run(path.join(SK(S[kind]), `${kind}.mjs`), args, home);
        const k = kv(r.out.split(/\r?\n/)[0] || '');
        rows.push({ run: d.slice(0, 5) + d.slice(-4), step: `${c.id}-S${s.n}`, truth: truth[`${c.id}-${s.n}`], status: k[kind === 'verdict' ? 'verdict' : 'oracle'], by: k.by, p: k.p === '-' ? null : Number(k.p), review: k.review === 'true', ms: r.ms });
      }
    }
    const decided = rows.filter((r) => r.status && r.status !== 'review' && r.status !== 'not_ready');
    out[kind][engine] = {
      steps: rows.length,
      decidedByEngineOrRule: decided.length, byRule: rows.filter((r) => r.by === 'rule').length, byEngine: rows.filter((r) => r.by === S.tag).length,
      toAgent: rows.filter((r) => r.status === 'review').length, flaggedReview: rows.filter((r) => r.review).length,
      agreeWithFinal: decided.filter((r) => r.status === r.truth).length, wrongFinal: decided.filter((r) => r.status !== r.truth).length,
      medianStepMs: median(rows.map((r) => r.ms)), rows,
    };
  }
  console.log(engine, 'gate', JSON.stringify(out.gate[engine]), '\n   verdict', JSON.stringify({ ...out.verdict[engine], rows: undefined }), '\n   oracle', JSON.stringify({ ...out.oracle[engine], rows: undefined }));
}
fs.writeFileSync(path.join(here, 'results', 'live-scripts.json'), JSON.stringify(out, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
