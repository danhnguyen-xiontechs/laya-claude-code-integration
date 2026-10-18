#!/usr/bin/env node
// gate.mjs — offline gate for 20261018-cte-r3-gate-01 (design.md sections 3-5, frozen).
//   node gate.mjs check   → leak check of D:/cte-r3/tasks.json against gold (writes leaks.json)
//   node gate.mjs index   → build engine indexes per snapshot, timed (writes index-times.json)
//   node gate.mjs run     → every engine on every unit, writes raw.json (paths, local only) + scores
//   node gate.mjs score   → filter + metrics; writes local results.json and the public gate-offline.json (ids + numbers)
// Options: --data D:/cte-r3  --explore <path to explore.mjs>  --only e01,e02  --engines rg,codemap,ck,cksem,repomap
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('data', 'D:/cte-r3');
const HOME = os.homedir();
const BIN = {
  rg: process.env.RG_BIN || `${HOME}/AppData/Local/copilot/pkg/win32-x64/1.0.73/ripgrep/bin/win32-x64/rg.exe`,
  codemap: process.env.CODEMAP_BIN || `${HOME}/tools/codemap/codemap.exe`,
  ck: process.env.CK_BIN || `${HOME}/tools/ck/ck.exe`,
  py: `${HOME}/tools/repomapper/src/.venv/Scripts/python.exe`,
  repomap: `${HOME}/tools/repomapper/src/repomap.py`,
  explore: arg('explore', path.resolve(HERE, '../../../../../.claude/worktrees/cte-r3/.claude/skills/codebase-task-explorer/scripts/explore.mjs')),
};
const K = 8, TIMEOUT = 30000;
const ENV = { ...process.env, HF_HOME: process.env.HF_HOME || 'E:/hf-cache', DO_NOT_TRACK: '1', CODEMAP_BIN: BIN.codemap, DECISION_PROVIDER: '' };
const STOP = new Set('the and for with that this from when where what which into have has are was were not but all any can its our out should would could does did how why who only also than then them they their there here been being about after before over under more most some such very just like want wants need needs make made show shows shown list lists get gets set sets use used using start look code file files find where'.split(' '));

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const write = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 2));
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
// ck prints absolute paths (\?D:...): make them repo-relative like the other engines
const rel = (dir, p) => norm(path.relative(path.resolve(dir), p.replace(/^\\\\\?\\/, '')));
const words = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
const pascal = (q) => q.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');

function sh(bin, args, cwd, timeout = TIMEOUT) {
  const t0 = Date.now();
  const r = spawnSync(bin, args, { cwd, env: ENV, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout, windowsHide: true });
  return { ok: r.status === 0 && !r.error, status: r.status, timedOut: r.error?.code === 'ETIMEDOUT', out: r.stdout || '', err: (r.stderr || '') + (r.error ? String(r.error.message) : ''), ms: Date.now() - t0 };
}

// ------------------------------------------------------------------ engines (design.md section 4)
export const ENGINES = {
  rg(task, dir) {
    const ws = words([task.task, ...task.queries].join(' '));
    const t0 = Date.now();
    const by = new Map();
    for (const w of ws) {
      const r = sh(BIN.rg, ['-c', '-i', '-F', '--glob', '*.cs', '--no-messages', '-e', w, '--', '.'], dir);
      for (const line of r.out.split('\n')) {
        const m = line.match(/^(.*):(\d+)$/);
        if (!m) continue;
        const p = norm(m[1]);
        const v = by.get(p) || { d: 0, n: 0 };
        v.d++; v.n += Number(m[2]);
        by.set(p, v);
      }
    }
    const order = [...by.entries()].map(([p, v]) => [p, 10 * v.d + Math.log2(1 + v.n)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p);
    return { ok: true, ms: Date.now() - t0, paths: order };
  },
  codemap(task, dir) {
    const r = sh(process.execPath, [BIN.explore, '--engine', 'codemap', '--provider', 'none', '--json', '--top', String(K), '--mode', task.mode === 'feature' ? 'feature' : 'bug', '--task', task.task, '--queries', task.queries.join('|'), '--root', dir], dir, TIMEOUT * 4);
    if (!r.ok) return { ok: false, ms: r.ms, timedOut: r.timedOut, err: r.err.slice(0, 300), paths: [] };
    const j = JSON.parse(r.out);
    return { ok: true, ms: r.ms, paths: j.top.map((c) => norm(c.path)), order: j.order, coverage: j.coverage?.status };
  },
  ck: (task, dir) => ckRun(task, dir, '--hybrid'),
  cksem: (task, dir) => ckRun(task, dir, '--sem'),
  repomap(task, dir) {
    const idents = [...new Set([...words(task.queries.join(' ')), ...task.queries.map(pascal)])].join(',');
    const r = sh(BIN.py, ['-I', BIN.repomap, '.', '--mentioned-idents', idents, '--map-tokens', '4096', '--exclude-unranked'], dir);
    if (!r.ok) return { ok: false, ms: r.ms, timedOut: r.timedOut, err: r.err.slice(-300), paths: [] };
    const text = r.out.replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
    const paths = [...text.matchAll(/(?:^|\n|\(')([^\n'"(]+?\.[A-Za-z0-9]+):\n\(Rank value/g)].map((m) => norm(m[1].trim()));
    return { ok: true, ms: r.ms, paths: [...new Set(paths)] };
  },
};

function ckRun(task, dir, mode) {
  const r = sh(BIN.ck, [mode, '--jsonl', '--no-snippet', '--topk', '400', '--threshold', '0', task.task, '.'], dir);
  if (!r.ok && !r.out) return { ok: false, ms: r.ms, timedOut: r.timedOut, err: r.err.slice(-300), paths: [] };
  const paths = [];
  for (const line of r.out.split('\n')) {
    try { const j = JSON.parse(line); const p = rel(dir, String(j.file || j.path || '')); if (p && !paths.includes(p)) paths.push(p); } catch { /* not a json line */ }
  }
  return { ok: true, ms: r.ms, paths };
}

// ------------------------------------------------------------------ metrics
export function recallAt(paths, gold, k = K) {
  const top = new Set(paths.slice(0, k).map((p) => p.toLowerCase()));
  const hit = gold.filter((g) => top.has(g.toLowerCase())).length;
  return { recall: hit / Math.min(gold.length, k), hit: hit > 0 };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ------------------------------------------------------------------ commands
const cmd = process.argv[2];
const only = arg('only', null)?.split(',');
const engines = (arg('engines', 'rg,codemap,ck,cksem,repomap')).split(',');
const units = () => read('units.json').filter((u) => !u.dropped && (!only || only.includes(u.id)));

if (cmd === 'check') {
  const tasks = read('tasks.json');
  const out = tasks.map((t) => {
    const u = read('units.json').find((x) => x.id === t.id);
    const text = [t.task, ...t.queries].join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');
    const leaks = u.gold.map((g) => path.basename(g, '.cs').toLowerCase()).filter((s) => s.length >= 6 && text.includes(s));
    const camel = [t.task, ...t.queries].join(' ').match(/\b[a-z]+[A-Z]\w*|\b[A-Z][a-z]+[A-Z]\w*|\w+[._/]\w+/g) || [];
    return { id: t.id, leak: leaks.length > 0, leakCount: leaks.length, identifierLike: camel.length };
  });
  write('leaks.json', out);
  console.log(out.map((x) => `${x.id} leak=${x.leak}${x.leak ? `(${x.leakCount})` : ''} identLike=${x.identifierLike}`).join('\n'));
} else if (cmd === 'index') {
  const times = fs.existsSync(path.join(DATA, 'index-times.json')) ? read('index-times.json') : {};
  for (const u of units()) {
    const dir = path.join(DATA, 'snap', u.id);
    times[u.id] = times[u.id] || {};
    if (engines.includes('codemap') && times[u.id].codemap == null) times[u.id].codemap = sh(BIN.codemap, ['find', '-json', '-limit', '1', 'warmup'], dir, 900000).ms;
    if ((engines.includes('ck') || engines.includes('cksem')) && times[u.id].ck == null) { const r = sh(BIN.ck, ['--index', '.'], dir, 3600000); times[u.id].ck = r.ok ? r.ms : `failed: ${r.err.slice(-200)}`; }
    if (engines.includes('repomap') && times[u.id].repomap == null) times[u.id].repomap = sh(BIN.py, ['-I', BIN.repomap, '.', '--map-tokens', '256'], dir, 900000).ms;
    write('index-times.json', times);
    console.log(u.id, JSON.stringify(times[u.id]));
  }
} else if (cmd === 'run') {
  const tasks = Object.fromEntries(read('tasks.json').map((t) => [t.id, t]));
  const raw = fs.existsSync(path.join(DATA, 'raw.json')) ? read('raw.json') : {};
  for (const u of units()) {
    const t = tasks[u.id];
    if (!t) continue;
    raw[u.id] = raw[u.id] || {};
    for (const e of engines) {
      const res = ENGINES[e](t, path.join(DATA, 'snap', u.id));
      raw[u.id][e] = { ...res, paths: res.paths.slice(0, 50) };
      console.log(u.id, e, res.ok ? 'ok' : 'FAILED', `${res.ms} ms`, `${res.paths.length} paths`);
      write('raw.json', raw);
    }
  }
} else if (cmd === 'score') {
  const raw = read('raw.json');
  const leaks = Object.fromEntries(read('leaks.json').map((x) => [x.id, x]));
  const us = units().filter((u) => raw[u.id] && !leaks[u.id]?.leak);
  const rows = us.map((u) => {
    const row = { id: u.id, date: u.date, gold: u.gold.length };
    for (const e of engines) {
      const r = raw[u.id][e];
      const m = r?.ok ? recallAt(r.paths, u.gold) : { recall: 0, hit: false };
      row[e] = { recall: r3(m.recall), hit: m.hit, ms: r?.ms ?? null, ok: !!r?.ok };
    }
    row.rgTop3Hit = recallAt(raw[u.id].rg?.paths || [], u.gold, 3).hit;
    return row;
  });
  // hardness filter (design.md section 3): no gold in rg top 3; at most 1 easy control (newest); up to 8, newest first
  const byNew = [...rows].sort((a, b) => (a.date < b.date ? 1 : -1));
  const hard = byNew.filter((r) => !r.rgTop3Hit);
  const easy = byNew.filter((r) => r.rgTop3Hit).slice(0, 1);
  const filtered = [...hard.slice(0, 8 - easy.length), ...easy];
  const summarize = (set) => Object.fromEntries(engines.map((e) => [e, {
    recall: r3(mean(set.map((r) => r[e].recall))), hit: set.filter((r) => r[e].hit).length, n: set.length,
    p50ms: median(set.map((r) => r[e].ms).filter((x) => x != null)), maxMs: Math.max(...set.map((r) => r[e].ms ?? 0)), failed: set.filter((r) => !r[e].ok).length,
  }]));
  const sumF = summarize(filtered), sumAll = summarize(rows);
  const cands = engines.filter((e) => !['rg', 'cksem'].includes(e)).map((e) => ({ e, ...sumF[e], passRecall: sumF[e].recall >= sumF.rg.recall + 0.15 - 1e-9, passLatency: sumF[e].p50ms < 5000 && sumF[e].maxMs < 15000 }));
  const winners = cands.filter((c) => c.passRecall && c.passLatency).sort((a, b) => b.recall - a.recall);
  const gate = { enough: filtered.length >= 5, rule: 'recall >= rg + 0.15 on filtered set; p50 < 5 s; max < 15 s', candidates: cands.map(({ e, recall, p50ms, maxMs, passRecall, passLatency }) => ({ engine: e, recall, p50ms, maxMs, passRecall, passLatency })), winner: filtered.length >= 5 ? winners[0]?.e || null : null };
  gate.pass = !!gate.winner;
  const pub = {
    experimentId: '20261018-cte-r3-gate-01', K, generatedAt: new Date().toISOString(),
    units: rows.length, leakDropped: Object.values(leaks).filter((x) => x.leak).map((x) => x.id),
    filtered: { ids: filtered.map((r) => r.id), easyControl: easy.map((r) => r.id), summary: sumF },
    all: { ids: rows.map((r) => r.id), summary: sumAll },
    rows: rows.map((r) => ({ ...r, date: undefined })),
    indexMs: fs.existsSync(path.join(DATA, 'index-times.json')) ? read('index-times.json') : null,
    gate,
  };
  write('results.json', pub);
  fs.writeFileSync(arg('out', path.join(HERE, '..', 'gate-offline.json')), JSON.stringify(pub, null, 2));
  console.log(JSON.stringify({ filtered: pub.filtered.ids, sumF, gate }, null, 1));
} else {
  console.error('usage: gate.mjs check|index|run|score [--only e01,..] [--engines rg,codemap,ck,cksem,repomap]');
  process.exit(2);
}
