#!/usr/bin/env node
// bench.mjs — benchmark harness for subagent-model-router.
//
//   node bench.mjs validate                  every check fails on the fixture and passes with solution/
//   node bench.mjs prepare <task> <tier> [--run <name>]   fresh work dir; prints the subagent prompt
//   node bench.mjs check <task> <tier> [--run <name>] [--agent <agentId>]
//                                            runs the check, records pass + the subagent's cost
//   node bench.mjs route [--provider jev] [--k 3]  routes every task prompt (rules + provider) and
//                                            caches the raw answers in results/route-<provider>.json
//   node bench.mjs score [--run <name>]      scores the routers on the recorded runs (offline)
//
// Work dirs live under ~/.subagent-model-router/bench/<run>/<task>/<tier>/ (outside the repo).
// Runs are recorded in results/runs-<run>.jsonl (task, tier, pass, cost; no prompt or code).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TIERS, ruleFeatures, ruleTier, combine, consistency, orderings, askOnce, loadConfig, nextTier } from '../scripts/router.mjs';
import { tierOf, usageCost } from '../scripts/pricing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASKS = path.join(HERE, 'tasks');
const RESULTS = path.join(HERE, 'results');
const WORK_ROOT = path.join(os.homedir(), '.subagent-model-router', 'bench');

export const listTasks = () => fs.readdirSync(TASKS).filter((d) => fs.existsSync(path.join(TASKS, d, 'task.json'))).sort();
export const loadTask = (id) => JSON.parse(fs.readFileSync(path.join(TASKS, id, 'task.json'), 'utf8'));

export function prepare(id, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(TASKS, id, 'files'), dir, { recursive: true });
  return dir;
}

export function runCheck(id, dir) {
  const r = spawnSync(process.execPath, [path.join(TASKS, id, 'check.mjs')], { cwd: dir, encoding: 'utf8', timeout: 180000, env: { ...process.env } });
  return r.status === 0;
}

/** The prompt a subagent receives: the work dir plus the task. */
export function subagentPrompt(task, dir) {
  return `Work only inside the directory ${dir.replace(/\\/g, '/')} (it is the project root; do not read or write outside it). Use Node.js (\`node\`), no npm installs.\n\n${task.prompt}\n\nWhen done, reply with one short line saying what you did.`;
}

/** Cost of a subagent from its transcript (this session's subagents/agent-<id>.jsonl). */
export function agentCost(agentId) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const find = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const r = find(p); if (r) return r; } else if (e.name === `agent-${agentId}.jsonl`) return p;
    }
    return null;
  };
  const f = find(root);
  if (!f) return null;
  const seen = new Set();
  let cost = 0, turns = 0, model = null, output = 0;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    let l; try { l = JSON.parse(line); } catch { continue; }
    if (l.type !== 'assistant' || !l.message?.usage) continue;
    const id = l.message.id ?? l.requestId;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = tierOf(l.message.model);
    model = l.message.model; turns++; output += l.message.usage.output_tokens ?? 0;
    cost += usageCost(t, l.message.usage);
  }
  return { cost, turns, model, output };
}

const argOf = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const workDir = (run, id, tier) => path.join(WORK_ROOT, run, id, tier);

function validate() {
  let bad = 0;
  for (const id of listTasks()) {
    const dir = prepare(id, path.join(os.tmpdir(), 'smr-validate', id));
    const before = runCheck(id, dir);
    fs.cpSync(path.join(TASKS, id, 'solution'), dir, { recursive: true });
    const after = runCheck(id, dir);
    const ok = !before && after;
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'BAD'} ${id}  fixture:${before ? 'pass' : 'fail'}  solution:${after ? 'pass' : 'fail'}`);
  }
  process.exit(bad ? 1 : 0);
}

async function routeAll() {
  const provider = argOf('provider', 'jev');
  const k = Number(argOf('k', 3));
  const cfg = loadConfig({ overrides: { mode: 'shadow', provider, k, policy: 'gate+sc', log: '' } });
  const out = {};
  for (const id of listTasks()) {
    const task = loadTask(id);
    const prompt = subagentPrompt(task, '<workdir>');
    const rule = ruleTier(ruleFeatures(prompt, task.type));
    const t0 = Date.now();
    const answers = provider === 'none' ? [] : await Promise.all(orderings(k).map((order) => askOnce({ task: prompt, type: task.type, order, cfg })));
    out[id] = { kind: task.kind, rule: rule.tier, why: rule.why, answers, wallMs: Date.now() - t0 };
    console.log(`${id.padEnd(18)} rule ${rule.tier.padEnd(6)} ${provider} ${answers.map((a) => a.tier ?? a.error).join(',')}  ${Date.now() - t0}ms`);
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `route-${provider}.json`), JSON.stringify(out, null, 2));
}

/** Routers scored on recorded runs. Each returns a tier (or null = keep default = opus here). */
export const ROUTERS = {
  'always-opus': () => 'opus',
  'always-sonnet': () => 'sonnet',
  'rules-only': (r) => combine('rules', r.rule, []),
  'jev-only': (r) => combine('jev', r.rule, r.answers),
  'jev+gate': (r) => combine('gate', r.rule, r.answers),
  'jev+sc(k)': (r) => combine('sc', r.rule, r.answers),
  'jev+gate+sc': (r) => combine('gate+sc', r.rule, r.answers),
};

export function score(runs, routes) {
  // runs: { [task]: { [tier]: { pass, cost } } }; label = cheapest passing tier
  const label = (t) => TIERS.find((tier) => runs[t]?.[tier]?.pass) ?? 'none';
  const tasks = Object.keys(runs).filter((t) => TIERS.every((tier) => runs[t][tier]) && routes[t]);
  const opusCost = tasks.reduce((s, t) => s + runs[t].opus.cost, 0);
  const rows = [];
  for (const [name, fn] of Object.entries(ROUTERS)) {
    let pass = 0, cost = 0, cPass = 0, cCost = 0, escal = 0, exact = 0, under = 0;
    for (const t of tasks) {
      const tier = fn(routes[t]) ?? 'opus';
      const run = runs[t][tier];
      if (run.pass) pass++;
      cost += run.cost;
      if (tier === label(t)) exact++;
      if (label(t) !== 'none' && TIERS.indexOf(tier) < TIERS.indexOf(label(t))) under++;
      // cascade: start at tier; on a failed check retry once at the next tier (cost of both)
      cCost += run.cost;
      if (run.pass) cPass++;
      else { const n = nextTier(tier); if (n) { escal++; cCost += runs[t][n].cost; if (runs[t][n].pass) cPass++; } }
    }
    const lat = Object.values(routes).map((r) => r.wallMs ?? 0).sort((a, b) => a - b);
    rows.push({ router: name, n: tasks.length, pass, passRate: pass / tasks.length, costVsOpus: cost / opusCost, exact, under,
      cascadePass: cPass / tasks.length, cascadeCostVsOpus: cCost / opusCost, escalationRate: escal / tasks.length,
      latencyP50Ms: name.startsWith('jev') ? lat[Math.floor(lat.length / 2)] : 0 });
  }
  return { tasks, labels: Object.fromEntries(tasks.map((t) => [t, label(t)])), rows };
}

/** Runs of one or more run names ("pilot,hf"); the last record of a task × tier wins. */
export function loadRuns(run) {
  const runs = {};
  for (const name of String(run).split(',')) {
    const f = path.join(RESULTS, `runs-${name}.jsonl`);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      (runs[r.task] ??= {})[r.tier] = r;
    }
  }
  return runs;
}

/**
 * Haiku-first labelling runs only up to the first passing tier. Fill the tiers above it, assuming
 * monotonicity (a tier that passes implies every higher tier passes), at the mean measured cost of
 * that tier. Imputed cells carry imputed: true. Tiers below a failure are never imputed.
 */
export function imputeAbove(runs) {
  const mean = {};
  for (const tier of TIERS) {
    const cs = Object.values(runs).map((t) => t[tier]).filter((r) => r && typeof r.cost === 'number' && !r.imputed).map((r) => r.cost);
    mean[tier] = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
  }
  const out = {};
  for (const [task, byTier] of Object.entries(runs)) {
    out[task] = { ...byTier };
    let passedBelow = false;
    for (const tier of TIERS) {
      if (out[task][tier]) { passedBelow ||= out[task][tier].pass; continue; }
      if (passedBelow && mean[tier] != null) out[task][tier] = { task, tier, pass: true, cost: mean[tier], imputed: true };
    }
  }
  return { runs: out, mean };
}

async function main() {
  const [cmd, id, tier] = process.argv.slice(2);
  const run = argOf('run', 'pilot');
  if (cmd === 'validate') return validate();
  if (cmd === 'route') return routeAll();
  if (cmd === 'prepare') {
    const dir = prepare(id, workDir(run, id, tier));
    console.log(subagentPrompt(loadTask(id), dir));
    return;
  }
  if (cmd === 'check') {
    const pass = runCheck(id, workDir(run, id, tier));
    const agent = argOf('agent');
    const c = agent ? agentCost(agent) : null;
    const rec = { t: new Date().toISOString(), run, task: id, kind: loadTask(id).kind, tier, pass, cost: c?.cost ?? null, turns: c?.turns ?? null, output: c?.output ?? null, model: c?.model ?? null, agent: agent ?? null };
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.appendFileSync(path.join(RESULTS, `runs-${run}.jsonl`), JSON.stringify(rec) + '\n');
    console.log(JSON.stringify(rec));
    return;
  }
  if (cmd === 'score') {
    const routes = JSON.parse(fs.readFileSync(path.join(RESULTS, `route-${argOf('provider', 'jev')}.json`), 'utf8'));
    let runs = loadRuns(run);
    let mean = null;
    if (process.argv.includes('--impute')) ({ runs, mean } = imputeAbove(runs));
    const s = score(runs, routes);
    const imputed = Object.values(runs).flatMap((t) => Object.values(t)).filter((r) => r.imputed).length;
    console.log(JSON.stringify({ ...s, imputedCells: imputed, meanCostPerTier: mean }, null, 2));
    return;
  }
  console.error('usage: bench.mjs validate | prepare <task> <tier> | check <task> <tier> [--agent id] | route | score');
  process.exit(2);
}

if (process.argv[1]?.endsWith('bench.mjs')) main();
