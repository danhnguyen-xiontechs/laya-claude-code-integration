#!/usr/bin/env node
// Per-phase and per-request usage of one haiku-build run, from the main session transcript and its
// subagent transcripts (<session>/subagents/*.jsonl). One API message is split over several transcript
// lines, so every message is counted once by message.id.
//
// Phase windows come from manifest.phases[] ({ phase, from, to }, ISO, from inclusive, to exclusive).
// A turn outside every window is counted as "unassigned", never dropped. A window with no turns is null.
//
// Per request (the 100k rule): input = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
// of one message, the same formula as contextOf() in haiku-100k/hooks/register.ts. Counted over every Haiku
// message of the run (main session and haiku-case subagents). The hook keeps no log, so this transcript is
// the only record.
//
// Usage: node usage_by_phase.mjs <session.jsonl> <manifest.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HAIKU_LIMIT = 100_000;

export const classOf = (model = '') => (/haiku/i.test(model) ? 'haiku' : /opus/i.test(model) ? 'opus' : /sonnet/i.test(model) ? 'sonnet' : 'other');
export const contextOf = (u = {}) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

const emptyTotals = () => ({ turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function subagentFiles(mainFile) {
  const dir = path.join(mainFile.replace(/\.jsonl$/, ''), 'subagents');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)) : [];
}

/** Every assistant message once, with its time, class, usage, and the subagent file it came from (null = main). */
function readMessages(files) {
  const seen = new Set();
  const out = [];
  for (const { file, sub } of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'assistant' || !e.message?.usage) continue;
      const id = e.message.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ t: Date.parse(e.timestamp ?? ''), cls: classOf(e.message.model), usage: e.message.usage, sub });
    }
  }
  return out;
}

const windowTimes = (p) => ({ phase: p.phase, from: Date.parse(p.from), to: Date.parse(p.to) });
// A window is closed only when both ends parse and from < to. An open window (no `to`) is never treated as covering time.
const isClosed = (w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.from < w.to;

/** Every pair of closed windows that overlap. Open windows are reported by openWindows(), not here. */
export function overlaps(phases) {
  const w = phases.map(windowTimes).filter(isClosed);
  const bad = [];
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length; j++) {
      const [a, b] = w[i].from <= w[j].from ? [w[i], w[j]] : [w[j], w[i]];
      if (b.from < a.to) bad.push([a.phase, b.phase]);
    }
  }
  return bad;
}

/** Phases whose window is not closed (missing or unparseable from/to, or from >= to). */
export const openWindows = (phases) => phases.filter((p) => !isClosed(windowTimes(p))).map((p) => p.phase);

/**
 * @param {{ mainFile: string, phases: {phase:string, from:string, to:string}[] }} args
 * @returns the per-phase rows, unassigned totals, overlaps and the per-request Haiku check.
 *          Missing transcript -> every number null and input_limit_verification 'not_measured'.
 */
export function usageByPhase({ mainFile, phases = [] }) {
  const bad = overlaps(phases);
  const open = openWindows(phases);
  // Why the Haiku verdict cannot be pass (checked before any usage is read). Priority: no transcript, then open windows, overlaps, no windows.
  const blocked = !mainFile || !fs.existsSync(mainFile) ? 'no_transcript'
    : open.length ? 'open_window'
    : bad.length ? 'overlap'
    : phases.length === 0 ? 'no_windows'
    : null;
  const notMeasured = (reason) => ({ request_count: null, requests_over_100k: null, max_haiku_input_tokens: null, input_limit_verification: 'not_measured', reason });
  if (blocked === 'no_transcript') {
    return { phases: phases.map((p) => ({ phase: p.phase, turns: null, byClass: null, opusCalls: null })), unassigned: null, overlaps: bad, open_windows: open, haiku: notMeasured(blocked) };
  }
  const subs = subagentFiles(mainFile).map((file) => ({ file, sub: file }));
  const msgs = readMessages([{ file: mainFile, sub: null }, ...subs]);

  // one subagent = one Agent call; an Opus call is a subagent whose first message is Opus
  const subStart = new Map();
  for (const m of msgs) if (m.sub && !subStart.has(m.sub)) subStart.set(m.sub, m);

  const win = phases.map((p) => ({ phase: p.phase, from: Date.parse(p.from), to: Date.parse(p.to) }));
  const rows = win.map((w) => ({ phase: w.phase, turns: 0, byClass: { haiku: emptyTotals(), opus: emptyTotals(), sonnet: emptyTotals(), other: emptyTotals() }, opusCalls: 0 }));
  const unassigned = emptyTotals();

  const add = (tot, m) => {
    tot.turns++;
    tot.input += m.usage.input_tokens ?? 0;
    tot.output += m.usage.output_tokens ?? 0;
    tot.cacheRead += m.usage.cache_read_input_tokens ?? 0;
    tot.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
  };
  for (const m of msgs) {
    const i = win.findIndex((w) => m.t >= w.from && m.t < w.to);
    if (i < 0) { add(unassigned, m); continue; }
    rows[i].turns++;
    add(rows[i].byClass[m.cls], m);
  }
  for (const [file, first] of subStart) {
    if (first.cls !== 'opus') continue;
    const i = win.findIndex((w) => first.t >= w.from && first.t < w.to);
    if (i >= 0) rows[i].opusCalls++;
  }

  const haiku = msgs.filter((m) => m.cls === 'haiku');
  const over = haiku.filter((m) => contextOf(m.usage) > HAIKU_LIMIT).length;
  const max = haiku.length ? Math.max(...haiku.map((m) => contextOf(m.usage))) : null;
  // fail wins: a request over the limit is a fact even when a window is still open.
  // pass needs closed, non-overlapping windows, at least one measured Haiku request, and zero over the limit.
  const reason = blocked ?? (haiku.length === 0 ? 'no_haiku_usage' : null);
  const verification = over > 0 ? 'fail' : reason ? 'not_measured' : 'pass';

  return {
    phases: rows.map((r) => (r.turns === 0
      ? { phase: r.phase, turns: null, byClass: null, opusCalls: null }
      : { phase: r.phase, turns: r.turns, byClass: r.byClass, opusCalls: r.opusCalls })),
    unassigned: unassigned.turns ? unassigned : null,
    overlaps: bad,
    open_windows: open,
    haiku: { request_count: haiku.length, requests_over_100k: haiku.length ? over : null, max_haiku_input_tokens: max, input_limit_verification: verification, reason },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, manifestFile] = process.argv.slice(2);
  if (!file || !manifestFile) {
    console.error('usage: usage_by_phase.mjs <session.jsonl> <manifest.json>');
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const u = usageByPhase({ mainFile: file, phases: manifest.phases ?? [] });
  const out = path.join(path.dirname(manifestFile), 'evidence', 'phase-usage.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(u, null, 2));
  const why = u.haiku.reason ? ` (${u.haiku.reason})` : '';
  console.log(`usage: ${u.haiku.request_count ?? 'null'} Haiku requests, max ${u.haiku.max_haiku_input_tokens ?? 'null'} input, verification ${u.haiku.input_limit_verification}${why}; open windows ${u.open_windows.length}; overlaps ${u.overlaps.length}; -> ${path.relative(process.cwd(), out)}`);
}
