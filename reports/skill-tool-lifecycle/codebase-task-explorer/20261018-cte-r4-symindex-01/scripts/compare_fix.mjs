#!/usr/bin/env node
// compare.mjs — round 4 offline comparison (design.md sections 3-5, frozen): arms C-cm, C-rules, S-rules, S-cm, rg
// on ess-be r3 (D:/cte-r3), ess-be held-out (D:/cte-r4) and Laya (eval/tasks.json + r2 tasks-new.json).
// Local raw output with paths: D:/cte-r4/compare-raw-fix.json. Public: ../compare.json (ids and numbers only).
//   node compare.mjs [--skill <codebase-task-explorer dir>] [--sets r3,ho,laya]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SKILL = path.resolve(arg('skill', path.resolve(HERE, '../../../../../.claude/worktrees/cte-r3/.claude/skills/codebase-task-explorer')));
const LAYA_ROOT = path.resolve(SKILL, '../../..');
const SETS = arg('sets', 'r3,ho,laya').split(',');
process.env.CODEMAP_BIN = process.env.CODEMAP_BIN || `${os.homedir()}/tools/codemap/codemap.exe`;
process.env.DECISION_PROVIDER = '';
const RG = process.env.RG_BIN || `${os.homedir()}/AppData/Local/copilot/pkg/win32-x64/1.0.73/ripgrep/bin/win32-x64/rg.exe`;
const { explore } = await import(pathToFileURL(path.join(SKILL, 'scripts/explore.mjs')).href);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// rg reference: same adapter as round 3 (20261018-cte-r3-gate-01/scripts/gate.mjs)
const STOP = new Set('the and for with that this from when where what which into have has are was were not but all any can its our out should would could does did how why who only also than then them they their there here been being about after before over under more most some such very just like want wants need needs make made show shows shown list lists get gets set sets use used using start look code file files find where'.split(' '));
const words = (t) => [...new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
function rgOrder(task, dir) {
  const t0 = Date.now(), by = new Map();
  for (const w of words([task.task, ...task.queries].join(' '))) {
    const r = spawnSync(RG, ['-c', '-i', '-F', '--glob', '*.cs', '--no-messages', '-e', w, '--', '.'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const line of (r.stdout || '').split('\n')) {
      const m = line.match(/^(.*):(\d+)$/);
      if (!m) continue;
      const v = by.get(norm(m[1])) || { d: 0, n: 0 };
      v.d++; v.n += Number(m[2]);
      by.set(norm(m[1]), v);
    }
  }
  return { ms: Date.now() - t0, paths: [...by.entries()].map(([p, v]) => [p, 10 * v.d + Math.log2(1 + v.n)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([p]) => p) };
}

// recall: ess-be = files, Laya = groups (a group counts when any of its suffixes is in the top K)
const recallFiles = (list, gold, k) => { const top = new Set(list.slice(0, k).map((p) => p.toLowerCase())); const h = gold.filter((g) => top.has(g.toLowerCase())).length; return { recall: h / Math.min(gold.length, k), hit: h > 0 }; };
const recallGroups = (list, groups, k) => { const top = list.slice(0, k); const h = groups.filter((g) => g.some((rel) => top.some((p) => p.endsWith(rel)))).length; return { recall: h / groups.length, hit: h > 0 }; };

function essSet(dir, onlyIds) {
  const tasks = Object.fromEntries(readJson(path.join(dir, 'tasks.json')).map((t) => [t.id, t]));
  return readJson(path.join(dir, 'units.json')).filter((u) => !u.dropped && (!onlyIds || onlyIds.includes(u.id)))
    .map((u) => ({ id: u.id, root: path.join(dir, 'snap', u.id), task: tasks[u.id], gold: u.gold, kind: 'files' }));
}
function layaSet() {
  const a = readJson(path.join(SKILL, 'eval/tasks.json')).tasks;
  const b = readJson(path.resolve(HERE, '../../20261018-cte-r2-agent-01/tasks-new.json')).tasks;
  return [...a, ...b].map((t) => ({ id: t.id, root: LAYA_ROOT, task: t, gold: t.relevant, kind: 'groups' }));
}

const sets = {};
if (SETS.includes('r3')) sets.r3 = essSet('D:/cte-r3');
if (SETS.includes('ho')) sets.ho = essSet('D:/cte-r4');
if (SETS.includes('laya')) sets.laya = layaSet();
const r3Filtered = readJson('D:/cte-r3/results.json').filtered.ids;

const raw = {}, rows = {}, builds = {};
for (const [name, items] of Object.entries(sets)) {
  raw[name] = {}; rows[name] = [];
  for (const it of items) {
    const base = { task: it.task.task, mode: it.task.mode === 'feature' ? 'feature' : it.task.mode || 'bug', queries: it.task.queries, root: it.root, provider: 'none', orderBy: 'rules', gate: false, opts: { top: 30 } };
    if (!builds[it.root]) { const w = await explore({ ...base, engine: 'symindex' }); builds[it.root] = { buildMs: w.index?.buildMs ?? null, cached: w.index?.cached, files: w.index?.files, symbols: w.index?.symbols, astGrep: w.index?.astGrep }; }
    const c = await explore({ ...base, engine: 'codemap' });
    const s = await explore({ ...base, engine: 'symindex' });
    const lists = { 'C-cm': c.engineOrderTop, 'C-rules': c.top.map((x) => x.path), 'S-rules': s.top.map((x) => x.path), 'S-cm': s.engineOrderTop };
    const ms = { 'C-cm': c.elapsedMs, 'C-rules': c.elapsedMs, 'S-rules': s.elapsedMs, 'S-cm': s.elapsedMs };
    if (it.kind === 'files') { const g = rgOrder(it.task, it.root); lists.rg = g.paths.slice(0, 30); ms.rg = g.ms; }
    raw[name][it.id] = { lists, ms, symindexCached: s.index?.cached };
    const row = { id: it.id, gold: it.gold.length, filtered: name === 'r3' ? r3Filtered.includes(it.id) : true, symindexCached: !!s.index?.cached };
    for (const [arm, list] of Object.entries(lists)) {
      const k8 = it.kind === 'files' ? recallFiles(list, it.gold, 8) : recallGroups(list, it.gold, 8);
      row[arm] = { recall8: Math.round(k8.recall * 1000) / 1000, hit8: k8.hit, ms: ms[arm] };
      if (it.kind === 'groups') row[arm].recall5 = Math.round(recallGroups(list, it.gold, 5).recall * 1000) / 1000;
    }
    rows[name].push(row);
    console.error(`${name} ${it.id} C-rules ${row['C-rules'].recall8} (${ms['C-rules']} ms) S-rules ${row['S-rules'].recall8} (${ms['S-rules']} ms${s.index?.cached ? ', cached' : ''})`);
  }
}

const ARMS = ['C-cm', 'C-rules', 'S-rules', 'S-cm', 'rg'];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const summarize = (set) => Object.fromEntries(ARMS.filter((a) => set[0]?.[a]).map((a) => [a, {
  n: set.length, recall8: Math.round(1000 * set.reduce((s, r) => s + r[a].recall8, 0) / set.length) / 1000, hit8: set.filter((r) => r[a].hit8).length,
  ...(set[0][a].recall5 != null ? { recall5: Math.round(1000 * set.reduce((s, r) => s + r[a].recall5, 0) / set.length) / 1000 } : {}),
  p50ms: median(set.map((r) => r[a].ms)), maxMs: Math.max(...set.map((r) => r[a].ms)),
}]));
const summary = {
  r3Filtered: rows.r3 ? summarize(rows.r3.filter((r) => r.filtered)) : null,
  r3All: rows.r3 ? summarize(rows.r3) : null,
  heldOut: rows.ho ? summarize(rows.ho) : null,
  laya: rows.laya ? summarize(rows.laya) : null,
  pooledHeldOutLaya: rows.ho && rows.laya ? summarize([...rows.ho, ...rows.laya].map((r) => ({ 'S-rules': r['S-rules'], 'S-cm': r['S-cm'], 'C-rules': r['C-rules'], 'C-cm': r['C-cm'] }))) : null,
};

// criteria (design.md section 5)
const setsForGate = [['r3Filtered', summary.r3Filtered], ['heldOut', summary.heldOut], ['laya', summary.laya]].filter(([, s]) => s);
const sAll = Object.values(rows).flat();
const symMs = sAll.map((r) => r['S-rules'].ms);
const crit = {
  latency: { p50ms: median(symMs), maxMs: Math.max(...symMs), pass: median(symMs) < 2000 && Math.max(...symMs) < 5000 },
  firstBuild: { maxMs: Math.max(...Object.values(builds).map((b) => b.buildMs ?? 0)), pass: Math.max(...Object.values(builds).map((b) => b.buildMs ?? 0)) < 30000 },
  recallVsCodemapRules: setsForGate.map(([n, s]) => ({ set: n, S: s['S-rules'].recall8, C: s['C-rules'].recall8, pass: s['S-rules'].recall8 >= s['C-rules'].recall8 - 0.05 - 1e-9 })),
  hitVsCodemapRules: setsForGate.map(([n, s]) => ({ set: n, S: s['S-rules'].hit8, C: s['C-rules'].hit8, pass: s['S-rules'].hit8 >= s['C-rules'].hit8 - 1 })),
  heldOutVsRg: summary.heldOut ? { S: summary.heldOut['S-rules'].recall8, rg: summary.heldOut.rg.recall8, pass: summary.heldOut['S-rules'].recall8 >= summary.heldOut.rg.recall8 + 0.15 - 1e-9 } : null,
  defaultOrder: summary.pooledHeldOutLaya ? (summary.pooledHeldOutLaya['S-cm'].recall8 > summary.pooledHeldOutLaya['S-rules'].recall8 ? 'codemap' : 'rules') : null,
};
crit.pass = crit.latency.pass && crit.firstBuild.pass && crit.recallVsCodemapRules.every((x) => x.pass) && crit.hitVsCodemapRules.every((x) => x.pass) && (!crit.heldOutVsRg || crit.heldOutVsRg.pass);

fs.writeFileSync('D:/cte-r4/compare-raw-fix.json', JSON.stringify({ raw, builds }, null, 2));
const pub = { experimentId: '20261018-cte-r4-symindex-01', generatedAt: new Date().toISOString(), K: 8, summary, criteria: crit,
  builds: Object.fromEntries(Object.entries(builds).map(([root, b]) => [root === LAYA_ROOT ? 'laya' : path.basename(root), b])), rows };
fs.writeFileSync(path.join(HERE, '..', 'compare-fix.json'), JSON.stringify(pub, null, 2));
console.log(JSON.stringify({ summary, criteria: crit }, null, 1));
