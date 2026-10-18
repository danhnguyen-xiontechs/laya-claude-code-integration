#!/usr/bin/env node
// Real token use of the workflow itself: one Claude Code session per phase (P1 plan, P2 build, P3 measure,
// P4 review + fix), listed in manifest.json phases[]. Each transcript is summed with transcript_usage.mjs
// (its subagents included, e.g. the Opus review subagent of P4). A missing transcript gives nulls, never an estimate.
//
// Usage: node phase_usage.mjs <experimentDir>
// Reads:  manifest.json phases[] { phase, sessionId, transcript, model, smartTrimMode }
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
const resolveTranscript = (p) => (!p ? null : path.resolve(dir, p.replace(/^~(?=[\/])/, os.homedir())));

const phases = (manifest.phases ?? []).map((ph) => {
  const transcript = resolveTranscript(ph.transcript);
  const base = { phase: ph.phase, sessionId: ph.sessionId ?? null, model: ph.model ?? null, smartTrimMode: ph.smartTrimMode ?? null, transcript: ph.transcript ?? null };
  if (!transcript || !fs.existsSync(transcript)) return { ...base, measured: false, ...Object.fromEntries(KEYS.map((k) => [k, null])) };
  const u = transcriptUsage(transcript);
  return {
    ...base, measured: true, modelsSeen: u.models, modelTurns: u.modelTurns, subagentTurns: u.subagentTurns, peakContext: u.peakContext,
    cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens, input: u.inputTokens, output: u.outputTokens, source: u.source,
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
