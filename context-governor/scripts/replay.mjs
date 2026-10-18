// Offline replay gate (design §5). Reads the transcripts of one day, runs the same core.decide
// over each main-loop turn, and prints notes, peak context and cache read per session.
// Usage: node scripts/replay.mjs --date 2026-10-18 --control <sessionId-prefix> [--projects <dir>]
// Avoided cache read is an upper bound (see design §5). Exit 0 only when all four pass conditions hold.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, contextOf, decide, emptyState } from '../src/core.ts';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const date = arg('date', '2026-10-18');
const control = arg('control', '');
const projects = arg('projects', join(homedir(), '.claude', 'projects'));

function jsonlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonlFiles(p));
    else if (name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/** Assistant turns of one transcript file, deduplicated by message.id, in file order. */
function turnsOf(file, isSubagent) {
  const seen = new Set();
  const turns = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== 'assistant' || !rec.message?.usage) continue;
    if (!String(rec.timestamp ?? '').startsWith(date)) continue;
    const id = rec.message.id ?? rec.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    const u = rec.message.usage;
    turns.push({ usage: u, agentId: isSubagent ? (rec.agentId ?? file) : undefined, model: rec.message.model ?? null });
  }
  return turns;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Main sessions are top-level *.jsonl; their subagent files live under <session>/subagents/.
const mainSessions = [];
for (const dir of readdirSync(projects)) {
  const pdir = join(projects, dir);
  if (!statSync(pdir).isDirectory()) continue;
  for (const name of readdirSync(pdir)) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.replace(/\.jsonl$/, '');
    const subs = join(pdir, id, 'subagents');
    const subFiles = (() => { try { return jsonlFiles(subs); } catch { return []; } })();
    const main = turnsOf(join(pdir, name), false);
    if (!main.length && !subFiles.length) continue;
    mainSessions.push({ id, main, subs: subFiles.flatMap((f) => turnsOf(f, true)) });
  }
}

const cfg = DEFAULTS;
const firstTurnCtx = mainSessions.filter((s) => s.main.length).map((s) => contextOf(s.main[0].usage) ?? 0);
const base = median(firstTurnCtx);

const report = [];
for (const s of mainSessions) {
  let st = emptyState();
  const notes = [];
  let peak = 0;
  let cacheRead = 0;
  const ctxs = [];
  s.main.forEach((t, i) => {
    const ctx = contextOf(t.usage) ?? 0;
    ctxs.push(ctx);
    peak = Math.max(peak, ctx);
    cacheRead += t.usage.cache_read_input_tokens ?? 0;
    const d = decide(st, { context: ctx, artifact: null }, cfg);
    st = d.state;
    for (const n of d.notes) notes.push({ turn: i + 1, context: ctx, kind: n });
  });
  let subNotes = 0;
  let subFlagged = 0;
  for (const t of s.subs) {
    const d = decide(emptyState(), { context: contextOf(t.usage) ?? 0, agentId: t.agentId, artifact: null }, cfg);
    subNotes += d.notes.length;
    if (d.flagged) subFlagged += 1;
  }
  const strong = notes.find((n) => n.kind === 'strong');
  // Upper bound (design §5, amended 2026-10-18 by the user): t* is the first crossing of
  // strongTokens from below (a stretch that starts at or above it has no t* until it drops
  // below and crosses again); avoided(t) = max(0, min(ctx(t), ctx(t*)) - base) for t > t*.
  const thr = cfg.strongTokens ?? 200000;
  const tStar = ctxs.findIndex((c, i) => i > 0 && c >= thr && ctxs[i - 1] < thr);
  let avoided = 0;
  if (tStar >= 0) {
    for (let i = tStar + 1; i < ctxs.length; i++) avoided += Math.max(0, Math.min(ctxs[i], ctxs[tStar]) - base);
  }
  report.push({ id: s.id, turns: s.main.length, peak, cacheRead, notes, subTurns: s.subs.length, subNotes, subFlagged, avoided, tStar: tStar >= 0 ? tStar + 1 : null, strongFired: !!strong });
}

console.log(`date ${date}  sessions ${report.length}  base(median first-turn ctx) ${Math.round(base)}`);
for (const r of report) {
  const noteStr = r.notes.map((n) => `${n.kind}@t${n.turn}(${Math.round(n.context / 1000)}k)`).join(' ') || '-';
  console.log(`${r.id.slice(0, 8)} turns ${r.turns} peak ${Math.round(r.peak / 1000)}k cacheRead ${Math.round(r.cacheRead / 1e6)}M notes ${r.notes.length} [${noteStr}] sub ${r.subTurns} subNotes ${r.subNotes} subFlagged ${r.subFlagged}`);
}

const ctl = report.find((r) => control && r.id.startsWith(control));
const checks = [];
if (ctl) {
  checks.push(['1 control gets strong note', ctl.strongFired]);
  console.log(`control t* ${ctl.tStar ?? 'none'} avoided ${Math.round(ctl.avoided / 1e6)}M of cacheRead ${Math.round(ctl.cacheRead / 1e6)}M`);
  const ratio = ctl.cacheRead ? ctl.avoided / ctl.cacheRead : 0;
  checks.push([`2 avoided upper bound >= 30% of control cacheRead (${(ratio * 100).toFixed(1)}%)`, ratio >= 0.3]);
} else {
  checks.push([`1-2 control session ${control || '(no --control given)'} not found`, false]);
}
checks.push(['3 each main session <= 5 notes', report.every((r) => r.notes.length <= 5)]);
checks.push(['4 subagent turns get 0 notes', report.every((r) => r.subNotes === 0)]);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
process.exitCode = checks.every(([, ok]) => ok) ? 0 : 1;
