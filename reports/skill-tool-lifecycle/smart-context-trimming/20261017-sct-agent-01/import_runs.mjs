#!/usr/bin/env node
// Grades every finished work dir and writes runs/<arm>/<runId>/results.json for build_tool_report.mjs.
//   pass  = the real command (raw, no filter) exits 0 AND the protected files (tests / Legacy.cs) are unchanged
//   usage = real API usage of that case's subagent transcript (transcript_usage.mjs), found by its work dir path
//   engine calls = the B filter log (_logs/<case>.jsonl)
// Usage: node import_runs.mjs <workRoot> <subagentsDir> [--rep 1]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [root, subDir] = process.argv.slice(2).map((p) => path.resolve(p));
const repArg = process.argv.includes('--rep') ? Number(process.argv[process.argv.indexOf('--rep') + 1]) : null;
const here = import.meta.dirname;
const usageScript = path.resolve(here, '../../../../.claude/skills/build-skill-tool-workflow/scripts/transcript_usage.mjs');
const tasks = JSON.parse(fs.readFileSync(path.join(root, 'tasks.json'), 'utf8')).filter((t) => !repArg || t.rep === repArg);

const hashOf = (dir, rels) => {
  const h = crypto.createHash('sha256');
  for (const rel of rels) {
    const p = path.join(dir, rel);
    const files = fs.statSync(p).isDirectory() ? fs.readdirSync(p).sort().map((f) => path.join(p, f)) : [p];
    for (const f of files) h.update(f.slice(dir.length)).update(fs.readFileSync(f));
  }
  return h.digest('hex');
};
// first user message of each subagent transcript -> file
const transcripts = fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => {
  const p = path.join(subDir, f);
  const firstLine = fs.readFileSync(p, 'utf8').split('\n').find((l) => l.includes('"type":"user"')) ?? '';
  return { p, firstLine };
});
const findTranscript = (dir) => {
  const key = JSON.stringify(dir).slice(1, -1); // path as it appears inside JSON (escaped backslashes)
  const hits = transcripts.filter((t) => t.firstLine.includes(key + '\\n') || t.firstLine.includes(key + '\\r'));
  return hits.length === 1 ? hits[0].p : null;
};

const byRun = {};
for (const t of tasks) {
  const raw = spawnSync(t.command.endsWith('build') ? 'dotnet build --nologo' : 'node --test', { cwd: t.dir, shell: true, encoding: 'utf8', maxBuffer: 64 << 20 });
  const protectedOk = hashOf(t.dir, t.protect) === t.protectHash;
  const tr = findTranscript(t.dir);
  const u = tr ? JSON.parse(spawnSync(process.execPath, [usageScript, tr, '--no-subagents'], { encoding: 'utf8' }).stdout) : null;
  const logFile = path.join(root, '_logs', `${path.basename(t.dir)}.jsonl`);
  const flog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const jevCalls = flog.filter((l) => l.jev?.called);
  const status = !tr ? 'blocked' : raw.status === 0 && protectedOk ? 'pass' : 'fail';
  const trimmed = flog.filter((l) => l.action === 'trim');
  const runId = `r${t.rep}`;
  const caseRes = {
    experimentId: '20261017-sct-agent-01', caseId: t.caseId, arm: t.arm, runId, status,
    goldOutcome: `${t.command.split(' ').pop()} passes; ${t.protect.join(', ')} unchanged`,
    observedOutcome: [
      raw.status === 0 ? 'suite green' : 'still failing',
      protectedOk ? null : 'PROTECTED FILES CHANGED',
      t.arm === 'B' ? `${trimmed.length}/${flog.length} runs trimmed${jevCalls.length ? `, jev: ${[...new Set(jevCalls.map((l) => l.jev.strategy ?? l.jev.error))].join('/')}` : ', rules only'}` : null,
      tr ? null : 'no transcript found',
    ].filter(Boolean).join(' · '),
    usage: u && {
      inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens,
      modelTurns: u.modelTurns, toolCalls: u.toolCalls, elapsedMs: u.elapsedMs,
      providerCalls: t.arm === 'B' ? jevCalls.length : 0,
      fallbackCount: t.arm === 'B' ? flog.filter((l) => l.jev?.called && !l.jev?.strategy).length : 0,
      providerLatencyMs: jevCalls.length ? jevCalls.reduce((a, l) => a + (l.jev.latencyMs ?? 0), 0) / jevCalls.length : null,
      source: 'subagent transcript (haiku, effort xhigh)',
    },
    evidenceRefs: [],
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  };
  const ev = path.join(here, 'evidence', 'filter-logs');
  if (flog.length) {
    fs.mkdirSync(ev, { recursive: true });
    fs.copyFileSync(logFile, path.join(ev, path.basename(logFile)));
    caseRes.evidenceRefs.push(`../../../evidence/filter-logs/${path.basename(logFile)}`);
  }
  (byRun[`${t.arm}|${runId}`] ??= []).push(caseRes);
  console.log(`${path.basename(t.dir)}: ${status} · ${caseRes.observedOutcome} · tokens ${u ? u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens : '—'}`);
}
for (const [k, cases] of Object.entries(byRun)) {
  const [arm, runId] = k.split('|');
  const d = path.join(here, 'runs', arm === 'A' ? 'A-claude' : 'B-claude-jev', runId);
  fs.mkdirSync(d, { recursive: true });
  const ts = cases.map((c) => c.finishedAt).sort();
  fs.writeFileSync(path.join(d, 'results.json'), JSON.stringify({ experimentId: '20261017-sct-agent-01', arm, runId, startedAt: ts[0], finishedAt: ts.at(-1), cases }, null, 2));
}
