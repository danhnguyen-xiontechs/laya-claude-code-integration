#!/usr/bin/env node
// label-outcomes.mjs — outcome labels from real use: joins the router log with the subagent transcripts.
//
//   node label-outcomes.mjs [--log ~/.subagent-model-router/log.jsonl] [--root ~/.claude/projects]
//                           [--out ~/.subagent-model-router/labels.jsonl] [--since 2026-10-20]
//
// Join: a hook row's tool_use_id = the subagent's meta.json toolUseId (layout in mine-history.mjs).
// Signals per spawn, all read from the transcripts (nothing is asked of a model):
//   status     the Agent tool result in the main thread (completed / failed / ...), resolvedModel = ranTier.
//              A background spawn reports async_launched, which is neither: only verify and retry decide it
//   verify     the subagent's own test/build commands: how many ran, and whether the LAST one failed
//              (tool_result is_error with an "Exit code N" line, N ≠ 0)
//   retry      a later spawn in the same main session with the same prompt hash or description;
//              escalated when it ran on a higher tier
// outcome: fail  = status not completed, last verification failed, or escalated
//          pass  = completed, and the last verification passed
//          unverified = completed, no verification ran (lookups, reviews, plans): no tier label
// Bounds: pass on tier T → T was enough (maxNeeded); fail on T → needs more than T (minNeeded = next tier).
// A router pick cheaper than a passing ranTier is a saving CANDIDATE only: that cheaper tier never ran.
//
// Writes OUTSIDE the repo, no prompt text (taskHash only); prints a summary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonl, walk } from './mine-history.mjs';
import { tierOf } from './pricing.mjs';
import { TIERS, nextTier, consistency, DEFAULT_LOG } from './router.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const LOG = args.log ?? DEFAULT_LOG;
const ROOT = args.root ?? path.join(os.homedir(), '.claude', 'projects');
const OUT = args.out ?? path.join(os.homedir(), '.subagent-model-router', 'labels.jsonl');

const rank = (t) => TIERS.indexOf(t);
const hashOf = (task) => crypto.createHash('sha1').update(String(task ?? '')).digest('hex').slice(0, 12);
// Test/build commands, anywhere in the line (agents often prefix `cd <dir> &&`).
const VERIFY = /\b(npm (run )?(test|build)|pnpm (test|build)|yarn (test|build)|node --test|npx (vitest|jest|tsc)|vitest|jest|tsc\b|pytest|dotnet (test|build)|go (test|build)|cargo (test|build)|mvn (test|verify)|gradlew? (test|build)|check\.mjs)\b/;
const SHELL = new Set(['Bash', 'PowerShell']);

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text ?? '').join('\n') : '');
export const exitOf = (b) => {
  const m = /Exit code (-?\d+)/.exec(text(b.content));
  return b.is_error ? (m ? Number(m[1]) : null) : 0;
};

/** Verification runs inside one subagent transcript. */
export function verifyRuns(lines) {
  const uses = {};
  for (const l of lines) if (l.type === 'assistant') for (const b of l.message?.content ?? []) if (b.type === 'tool_use') uses[b.id] = b;
  const runs = [];
  for (const l of lines) {
    if (l.type !== 'user' || !Array.isArray(l.message?.content)) continue;
    for (const b of l.message.content) {
      const u = b.type === 'tool_result' && uses[b.tool_use_id];
      if (!u || !SHELL.has(u.name) || !VERIFY.test(u.input?.command ?? '')) continue;
      runs.push({ exit: exitOf(b) });
    }
  }
  return runs;
}

/** Agent spawns in one main-thread transcript, in order, with their tool results. */
export function spawnsOf(lines) {
  const out = [];
  const byId = {};
  for (const l of lines) {
    if (l.type === 'assistant') for (const b of l.message?.content ?? []) {
      if (b.type !== 'tool_use' || !/^(Agent|Task)$/.test(b.name)) continue;
      const s = { id: b.id, t: l.timestamp, hash: hashOf(b.input?.prompt), description: b.input?.description ?? null, model: b.input?.model ?? null };
      out.push(s); byId[b.id] = s;
    }
    if (l.type === 'user' && Array.isArray(l.message?.content)) for (const b of l.message.content) {
      const s = b.type === 'tool_result' && byId[b.tool_use_id];
      if (!s) continue;
      const r = l.toolUseResult && typeof l.toolUseResult === 'object' ? l.toolUseResult : {};
      s.status = r.status ?? (b.is_error ? 'error' : null);
      s.ranTier = tierOf(r.resolvedModel) ?? tierOf(s.model);
    }
  }
  return out;
}

export function label(row, sub, spawns, runs) {
  const i = spawns.findIndex((s) => s.id === row.tool_use_id);
  const me = spawns[i] ?? {};
  const ranTier = me.ranTier ?? tierOf(sub?.meta?.model) ?? null;
  const later = i >= 0 ? spawns.slice(i + 1).filter((s) => s.hash === me.hash || (me.description && s.description === me.description)) : [];
  const retry = later[0] ?? null;
  const escalated = !!(retry && ranTier && rank(retry.ranTier) > rank(ranTier));
  const last = runs.at(-1);
  const lastFailed = !!(last && last.exit !== 0);
  const done = me.status === 'completed' || me.status === 'async_launched';
  const failed = (me.status && !done) || lastFailed || escalated;
  const outcome = failed ? 'fail' : runs.length && last.exit === 0 ? 'pass' : done ? 'unverified' : 'unknown';
  const jev = consistency(row.answers ?? []);
  const picks = { rule: row.rule?.tier ?? null, jev: jev.tier, final: row.tier ?? null };
  const judge = (t) => {
    if (!t || !ranTier) return null;
    if (outcome === 'pass') return rank(t) < rank(ranTier) ? 'cheaper (unproven)' : rank(t) === rank(ranTier) ? 'same' : 'over';
    if (outcome === 'fail') return ranTier === 'opus' ? 'top tier failed' : rank(t) <= rank(ranTier) ? 'under' : 'above';
    return null;
  };
  return {
    t: row.t, session: row.session, tool_use_id: row.tool_use_id, taskHash: row.taskHash, type: row.type, provider: row.provider, policy: row.policy,
    requestedModel: sub?.meta?.model ?? null, ranTier, status: me.status ?? null,
    verify: { runs: runs.length, lastExit: last?.exit ?? null }, retry: retry ? { tool_use_id: retry.id, ranTier: retry.ranTier ?? null, escalated } : null,
    outcome, maxNeeded: outcome === 'pass' ? ranTier : null, minNeeded: outcome === 'fail' && !escalated ? nextTier(ranTier) : outcome === 'fail' ? retry?.ranTier ?? null : null,
    picks, jevStable: jev.stable, verdict: Object.fromEntries(Object.entries(picks).map(([k, t]) => [k, judge(t)])),
    features: row.features ?? null,
  };
}

export function run({ log = LOG, root = ROOT, since } = {}) {
  const rows = readJsonl(log).filter((r) => r.source === 'hook' && r.tool_use_id && (!since || r.t >= since));
  const subs = {};
  for (const f of walk(root)) {
    if (!/[\\/]subagents[\\/]agent-[^\\/]+\.jsonl$/.test(f)) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { continue; }
    if (meta.toolUseId) subs[meta.toolUseId] = { file: f, meta, main: path.join(path.dirname(path.dirname(f))) + '.jsonl' };
  }
  const mains = {};
  const labels = [];
  let unmatched = 0;
  for (const row of rows) {
    const sub = subs[row.tool_use_id];
    if (!sub) { unmatched++; continue; }
    mains[sub.main] ??= fs.existsSync(sub.main) ? spawnsOf(readJsonl(sub.main)) : [];
    labels.push(label(row, sub, mains[sub.main], verifyRuns(readJsonl(sub.file))));
  }
  return { rows: rows.length, unmatched, labels };
}

export function summary({ rows, unmatched, labels }) {
  const count = (xs, key) => xs.reduce((a, x) => { const k = key(x) ?? '-'; a[k] = (a[k] || 0) + 1; return a; }, {});
  const graded = labels.filter((l) => l.outcome === 'pass' || l.outcome === 'fail');
  return {
    hookRows: rows, matched: labels.length, unmatched,
    outcome: count(labels, (l) => l.outcome),
    ranTier: count(labels, (l) => l.ranTier),
    byRouter: Object.fromEntries(['rule', 'jev', 'final'].map((k) => [k, count(graded.filter((l) => l.verdict[k]), (l) => `${l.outcome}: ${l.verdict[k]}`)])),
    jevRows: labels.filter((l) => l.provider !== 'none').length,
  };
}

if (process.argv[1]?.endsWith('label-outcomes.mjs')) {
  const r = run({ since: args.since });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, r.labels.map((x) => JSON.stringify(x)).join('\n') + (r.labels.length ? '\n' : ''));
  console.log(JSON.stringify(summary(r), null, 2));
  console.log(`(wrote ${r.labels.length} labels to ${OUT})`);
}
