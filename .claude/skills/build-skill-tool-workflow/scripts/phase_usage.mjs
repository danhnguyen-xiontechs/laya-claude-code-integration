#!/usr/bin/env node
// Real token use of the workflow itself: one Claude Code session per phase (P1 plan, P2 build, P3 measure,
// P4 review + fix) plus the control session's slice of the round, listed in manifest.json phases[]. Each
// transcript is summed with transcript_usage.mjs (its subagents included, e.g. the Opus review subagent of P4).
// A missing transcript gives nulls, never an estimate.
//
// Usage: node phase_usage.mjs <experimentDir>
// Reads:  manifest.json phases[] { phase, cwd | transcript, from?, to?, pick?, sessionId?, model, smartTrimMode }
//   transcript  explicit session .jsonl (relative to the experiment folder, or ~/...)
//   cwd         the session's working directory; its transcripts are found under ~/.claude/projects/<cwd with every character other
//               than a letter or digit replaced by ->/*.jsonl (override the root with CLAUDE_PROJECTS_DIR). All files there are
//               summed (a phase worktree holds the phase session plus any headless `claude -p` runs it started),
//               unless pick is "busiest": then only the file with the most turns in [from, to] (the control row,
//               whose folder holds many other sessions).
//   from / to   ISO times; only turns inside the window count (the control row: round start → report time)
// Writes: evidence/phase-usage.json, read by build_tool_report.mjs ("Workflow cost per phase")
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptUsage } from './transcript_usage.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node phase_usage.mjs <experimentDir>');
  process.exit(2);
}
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
} catch {
  console.error(`manifest.json missing or invalid in ${dir}`);
  process.exit(2);
}
const KEYS = ['modelTurns', 'peakContext', 'cacheRead', 'cacheWrite', 'input', 'output'];
const projectsRoot = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const projectDirOf = (cwd) => path.join(projectsRoot, cwd.replace(/[^A-Za-z0-9]/g, '-'));
const resolveTranscript = (p) => (!p ? null : path.resolve(dir, p.replace(/^~(?=[\/])/, os.homedir())));
const window = (ph) => ({
  from: ph.from ? Date.parse(ph.from) : -Infinity,
  to: ph.to ? Date.parse(ph.to) : Infinity,
});

function filesFor(ph) {
  if (ph.transcript) {
    const t = resolveTranscript(ph.transcript);
    return t && fs.existsSync(t) ? [t] : [];
  }
  if (!ph.cwd) return [];
  const pd = projectDirOf(ph.cwd);
  if (!fs.existsSync(pd)) return [];
  const files = fs.readdirSync(pd).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(pd, f));
  if (ph.pick !== 'busiest') return files;
  const w = window(ph);
  const scored = files.map((f) => ({ f, n: transcriptUsage(f, { ...w, subagents: false }).modelTurns })).filter((x) => x.n > 0);
  scored.sort((a, b) => b.n - a.n);
  return scored.length ? [scored[0].f] : [];
}

const phases = (manifest.phases ?? []).map((ph) => {
  const base = { phase: ph.phase, sessionId: ph.sessionId ?? null, model: ph.model ?? null, smartTrimMode: ph.smartTrimMode ?? null,
    transcript: ph.transcript ?? null, cwd: ph.cwd ?? null, from: ph.from ?? null, to: ph.to ?? null };
  const files = filesFor(ph);
  const us = files.map((f) => transcriptUsage(f, window(ph))).filter((u) => u.modelTurns > 0);
  if (!us.length) return { ...base, measured: false, ...Object.fromEntries(KEYS.map((k) => [k, null])) };
  const sum = (k) => us.reduce((a, u) => a + (u[k] ?? 0), 0);
  return {
    ...base, measured: true, files: us.length, modelsSeen: [...new Set(us.flatMap((u) => u.models ?? []))],
    modelTurns: sum('modelTurns'), subagentTurns: sum('subagentTurns'), peakContext: Math.max(...us.map((u) => u.peakContext ?? 0)),
    cacheRead: sum('cacheReadTokens'), cacheWrite: sum('cacheWriteTokens'), input: sum('inputTokens'), output: sum('outputTokens'),
    source: us.map((u) => u.source).join(' | '),
  };
});
const measured = phases.filter((p) => p.measured);
// totals over measured phases only; peakContext is the max, the rest are sums; all null when nothing was measured
const totals = Object.fromEntries(KEYS.map((k) => [k, measured.length
  ? k === 'peakContext' ? Math.max(...measured.map((p) => p[k])) : measured.reduce((a, p) => a + p[k], 0)
  : null]));
totals.allTokens = measured.length ? totals.cacheRead + totals.cacheWrite + totals.input + totals.output : null;
const out = { experimentId: manifest.experimentId ?? null, phases, measuredPhases: measured.length, missingPhases: phases.filter((p) => !p.measured).map((p) => p.phase), totals, generatedAt: new Date().toISOString() };
fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(dir, 'evidence', 'phase-usage.json'), JSON.stringify(out, null, 2));
const m = (x) => (x == null ? '—' : `${(x / 1e6).toFixed(2)}M`);
console.log(`phase-usage.json: ${measured.length}/${phases.length} phases measured${out.missingPhases.length ? ` (missing ${out.missingPhases.join(',')})` : ''} · all ${m(totals.allTokens)} · cache read ${m(totals.cacheRead)} · write ${m(totals.cacheWrite)} · peak ctx ${totals.peakContext ?? '—'}`);
