// Offline replay gate (design §5, re-frozen 2026-10-18T14:01:32Z). Replays every main session's
// whole history (no date filter, UTC timestamps) through the same core.decide as the plugin.
// Usage: node scripts/replay.mjs --control <sessionId-prefix> [--projects <dir>] [--artifact <substring>] [--summary <file.json>]
// Exit 0 only when the four pass conditions hold; an invariant breach (avoided > cacheRead) throws and exits 1.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, contextOf, decide, emptyState } from '../src/core.ts';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const control = arg('control', '');
const projects = arg('projects', join(homedir(), '.claude', 'projects'));
const artifactKey = arg('artifact', '20261018-context-governor-01');
const summaryPath = arg('summary', '');
const HELD_OUT_DAY = '2026-10-17';
const NAMED = ['82e30143', 'b266357b', '5b84aa0f', '3e716326'];
const cfg = DEFAULTS;
const thr = cfg.strongTokens;

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

/** Assistant turns of one file, deduplicated by message.id, in file order; plus compact_boundary times. */
function parseFile(file, isSubagent) {
  const seen = new Set();
  const turns = [];
  const compacts = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type === 'system' && rec.subtype === 'compact_boundary' && rec.timestamp) {
      compacts.push(Date.parse(rec.timestamp));
      continue;
    }
    if (rec.type !== 'assistant' || !rec.message?.usage || !rec.timestamp) continue;
    const id = rec.message.id ?? rec.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    const writes = (rec.message.content ?? []).some((c) =>
      c?.type === 'tool_use' && WRITE_TOOLS.has(c.name) &&
      String(c.input?.file_path ?? '').replaceAll('\\', '/').includes(artifactKey));
    turns.push({
      ts: Date.parse(rec.timestamp),
      usage: rec.message.usage,
      ctx: contextOf(rec.message.usage) ?? 0,
      cr: rec.message.usage.cache_read_input_tokens ?? 0,
      writes,
      agentId: isSubagent ? (rec.agentId ?? file) : undefined,
    });
  }
  return { turns, compacts };
}

function jsonlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsonlFiles(p));
    else if (name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Main sessions are top-level *.jsonl; their subagent files live under <session>/subagents/.
const sessions = [];
for (const dir of readdirSync(projects)) {
  const pdir = join(projects, dir);
  if (!statSync(pdir).isDirectory()) continue;
  for (const name of readdirSync(pdir)) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.replace(/\.jsonl$/, '');
    const main = parseFile(join(pdir, name), false);
    const subFiles = (() => { try { return jsonlFiles(join(pdir, id, 'subagents')); } catch { return []; } })();
    if (!main.turns.length && !subFiles.length) continue;
    sessions.push({ id, main, subs: subFiles.flatMap((f) => parseFile(f, true).turns) });
  }
}
const withTurns = sessions.filter((s) => s.main.turns.length);
const B = median(withTurns.map((s) => s.main.turns[0].cr)); // B_cr, design §5

function analyse(s) {
  const T = s.main.turns;
  const ctx = T.map((t) => t.ctx);
  const cr = T.map((t) => t.cr);
  const cacheRead = cr.reduce((a, b) => a + b, 0);
  let tStar = -1;
  for (let i = 1; i < T.length; i++) if (ctx[i] >= thr && ctx[i - 1] < thr) { tStar = i; break; }
  let avoided = 0;
  if (tStar >= 0) for (let i = tStar + 1; i < T.length; i++) avoided += Math.max(0, Math.min(cr[i], cr[tStar]) - B);
  if (avoided > cacheRead) throw Object.assign(new Error(`invariant: avoided ${avoided} > cacheRead ${cacheRead} in ${s.id}`), { code: 2 });

  // Realized delay: the first compact_boundary after t* (else a drop below 100k), in turns.
  let c = -1;
  if (tStar >= 0) {
    const after = s.main.compacts.filter((ts) => ts > T[tStar].ts).sort((a, b) => a - b)[0];
    if (after !== undefined) c = T.findIndex((t, i) => i > tStar && t.ts >= after);
    else c = ctx.findIndex((x, i) => i > tStar && x < cfg.softTokens - cfg.rearmGapTokens);
  }
  const realizedDelay = tStar >= 0 && c >= 0 ? c - tStar : null;
  const realizedCr = realizedDelay === null ? null : cr.slice(tStar + 1, c + 1).reduce((a, b) => a + b, 0);

  // Notes: the same decide as the plugin, artifact = latest write so far (null before the first).
  let st = emptyState();
  let lastWrite = null;
  const notes = [];
  T.forEach((t, i) => {
    if (t.writes) lastWrite = t.ts;
    const d = decide(st, { context: t.ctx, artifact: lastWrite === null ? null : { mtimeMs: lastWrite } }, cfg);
    st = d.state;
    for (const n of d.notes) notes.push({ turn: i + 1, context: t.ctx, kind: n });
  });
  let subNotes = 0;
  let subFlagged = 0;
  let subCr = 0;
  for (const t of s.subs) {
    const d = decide(emptyState(), { context: t.ctx, agentId: t.agentId, artifact: null }, cfg);
    subNotes += d.notes.length;
    if (d.flagged) subFlagged += 1;
    subCr += t.cr;
  }
  return {
    id: s.id,
    first: new Date(Math.min(...T.map((t) => t.ts))).toISOString(),
    last: new Date(Math.max(...T.map((t) => t.ts))).toISOString(),
    turns: T.length,
    peak: Math.max(...ctx),
    cacheRead,
    tStar: tStar >= 0 ? tStar + 1 : null,
    avoided,
    ratio: cacheRead ? avoided / cacheRead : 0,
    realizedDelay,
    realizedCr,
    notes,
    subTurns: s.subs.length,
    subNotes,
    subFlagged,
    subCr,
    strongFired: notes.some((n) => n.kind === 'strong'),
  };
}

const report = sessions.filter((s) => s.main.turns.length).map(analyse);
const ctl = report.find((r) => control && r.id.startsWith(control));
const heldCandidates = report
  .filter((r) => r.first.startsWith(HELD_OUT_DAY) && !NAMED.some((p) => r.id.startsWith(p)))
  .sort((a, b) => b.cacheRead - a.cacheRead);
const held = heldCandidates[0];
const shown = new Set([ctl?.id, ...NAMED.map((p) => report.find((r) => r.id.startsWith(p))?.id), held?.id].filter(Boolean));

const M = (x) => `${(x / 1e6).toFixed(1)}M`;
const K = (x) => `${Math.round(x / 1000)}k`;
console.log(`replay: ${report.length} main sessions (whole history, UTC), ${sessions.reduce((a, s) => a + s.subs.length, 0)} subagent turns, B_cr ${M(B)} (median first-turn cache_read), artifact key ${artifactKey}`);
console.log('session   first(UTC)       turns   peak  cacheRead      t*    avoided   ratio  realizedDelay  realizedCr  notes  subTurns  subCacheRead  subNotes');
for (const r of report.filter((x) => shown.has(x.id))) {
  const tag = ctl?.id === r.id ? '<- control' : r.id === held?.id ? '<- held-out' : '';
  console.log(`${r.id.slice(0, 8)}  ${r.first.slice(0, 16)}  ${String(r.turns).padStart(5)}  ${K(r.peak).padStart(5)}  ${M(r.cacheRead).padStart(9)}  ${String(r.tStar ?? '-').padStart(4)}  ${M(r.avoided).padStart(8)}  ${(r.ratio * 100).toFixed(1).padStart(5)}%  ${String(r.realizedDelay ?? '-').padStart(13)}  ${r.realizedCr === null ? '-' : M(r.realizedCr)}  ${String(r.notes.length).padStart(5)}  ${String(r.subTurns).padStart(8)}  ${M(r.subCr).padStart(12)}  ${r.subNotes} ${tag}`);
  console.log(`   notes: ${r.notes.map((n) => `${n.kind}@t${n.turn}(${K(n.context)})`).join(' ') || '-'}`);
}
console.log(`held-out (rule: largest cacheRead among ${HELD_OUT_DAY} UTC sessions, not a named one): ${held ? held.id.slice(0, 8) : 'none'}`);
const all = report.reduce((a, r) => ({ notes: a.notes + r.notes.length, subNotes: a.subNotes + r.subNotes, maxNotes: Math.max(a.maxNotes, r.notes.length) }), { notes: 0, subNotes: 0, maxNotes: 0 });
console.log(`all main sessions: ${report.length}, notes ${all.notes}, max notes in one session ${all.maxNotes}, subagent notes ${all.subNotes}`);

const checks = [];
if (ctl) {
  checks.push(['1 control gets strong note', ctl.strongFired]);
  checks.push([`2 control avoided/cacheRead >= 30% (${(ctl.ratio * 100).toFixed(1)}%; avoided ${M(ctl.avoided)} of ${M(ctl.cacheRead)})`, ctl.ratio >= 0.3]);
} else {
  checks.push([`1-2 control session ${control || '(no --control given)'} not found`, false]);
}
checks.push(['3 each main session <= 5 notes', report.every((r) => r.notes.length <= 5)]);
checks.push(['4 subagent turns get 0 notes', report.every((r) => r.subNotes === 0)]);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
const pass = checks.every(([, ok]) => ok);

if (summaryPath) {
  writeFileSync(summaryPath, JSON.stringify({
    rule: 'design §5 re-frozen 2026-10-18T14:01:32Z', B_cr: B, artifactKey, control: ctl?.id ?? null, held_out: held?.id ?? null,
    checks: checks.map(([name, ok]) => ({ name, ok })), pass, sessions: report,
  }, null, 2));
}
process.exitCode = pass ? 0 : 1;
