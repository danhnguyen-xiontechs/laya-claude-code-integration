#!/usr/bin/env node
// grade.mjs — scores each saved hand-back answer against gold (batch status + every story status), by script.
// Writes runs/A-claude/r{1,2}/results.json and runs/B-claude-jev/r{1,2}/results.json, evidence/grades.json, evidence/gold.json.
// Usage: node grade.mjs <SCRATCH>      (gold is read from <SCRATCH>/gold.json and copied into evidence only now)
import fs from 'node:fs';
import path from 'node:path';

const EXP = import.meta.dirname, ID = '20261018-integration-verifier-r2-agent-01';
const SCRATCH = process.argv[2];
if (!SCRATCH) { console.error('Usage: node grade.mjs <SCRATCH>'); process.exit(2); }
const gold = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'gold.json'), 'utf8'));
fs.writeFileSync(path.join(EXP, 'evidence', 'gold.json'), JSON.stringify(gold, null, 2));
const index = JSON.parse(fs.readFileSync(path.join(EXP, 'evidence', 'run-index.json'), 'utf8'));
const forbidden = JSON.parse(fs.readFileSync(path.join(EXP, 'evidence', 'forbidden.json'), 'utf8'));
const S = ['PASS', 'FAIL', 'BLOCKED', 'REVIEW_REQUIRED'];
const norm = (s) => S.find((x) => x === String(s).toUpperCase().trim().replace(/[\s-]+/g, '_'));

function parse(text) {
  const out = { batch: null, stories: {} };
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/[*`]/g, '').trim();
    let m = clean.match(/^BATCH\s*:\s*([A-Za-z_ -]+)/i);
    if (m) { out.batch = norm(m[1].split(/\s+[-—(]/)[0]); continue; }
    m = clean.match(/^(S\d+)\s*:\s*([A-Za-z_]+)/);
    if (m && norm(m[2])) out.stories[m[1]] = norm(m[2]);
  }
  return out;
}
const jevLog = (c, r) => { const f = path.join(EXP, 'evidence', '_logs', `${c}.B.r${r}.jsonl`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const runs = {};
const grades = {};
for (const [c, g] of Object.entries(gold)) for (const arm of ['A', 'B']) for (const r of [1, 2]) {
  const key = `${c}.${arm}.r${r}`, idx = index[key] ?? {};
  const f = path.join(EXP, 'evidence', 'answers', `${key}.txt`);
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  const got = text == null ? null : parse(text);
  const now = new Date().toISOString();
  const crit = [];
  let status, observed;
  const contaminated = arm === 'A' && (forbidden[key]?.forbiddenCalls ?? 0) > 0;
  if (!idx.transcript) { status = 'blocked'; observed = 'no subagent transcript for this work folder'; }
  else if (!got) { status = 'error'; observed = 'no hand-back answer'; }
  else {
    crit.push({ criterionId: 'batch-status', status: got.batch === g.batch ? 'pass' : 'fail', notes: `expected ${g.batch}, got ${got.batch ?? 'none'}` });
    for (const [id, want] of Object.entries(g.stories)) crit.push({ criterionId: `story-${id}`, status: got.stories[id] === want ? 'pass' : 'fail', notes: `expected ${want}, got ${got.stories[id] ?? 'none'}` });
    status = crit.every((x) => x.status === 'pass') ? 'pass' : 'fail';
    observed = `batch ${got.batch ?? '?'}; ${Object.keys(g.stories).map((id) => `${id} ${got.stories[id] ?? '?'}`).join(', ')}${status === 'fail' ? ` — wrong: ${crit.filter((x) => x.status === 'fail').map((x) => `${x.criterionId} (${x.notes})`).join('; ')}` : ''}`;
  }
  const u = idx.usage;
  const lg = arm === 'B' ? jevLog(c, r) : [];
  const calls = arm === 'B' ? lg.reduce((n, l) => n + (l.jev_calls ?? 0), 0) : null;
  const lat = arm === 'B' ? lg.flatMap((l) => l.jev.map((j) => j.latencyMs).filter((x) => typeof x === 'number')).sort((a, b) => a - b) : [];
  const res = { experimentId: ID, caseId: c, arm, runId: `r${r}`, startedAt: idx.startedAt ?? now, finishedAt: idx.finishedAt ?? now, status,
    goldOutcome: g, observedOutcome: observed, correct: status === 'pass' ? true : status === 'fail' ? false : null, criteriaResults: crit,
    usage: u ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, modelTurns: u.modelTurns, toolCalls: u.toolCalls, elapsedMs: u.elapsedMs ?? null,
      providerCalls: arm === 'B' ? calls : null, fallbackCount: arm === 'B' ? lg.reduce((n, l) => n + l.jev.filter((j) => j.error).length, 0) : null, providerLatencyMs: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null,
      source: 'subagent transcript (subagent_usage.mjs --no-subagents), all tokens of the case agent session' } : {},
    evidenceRefs: [`evidence/answers/${key}.txt`, `evidence/texts/${key}.txt`].filter((p) => fs.existsSync(path.join(EXP, p))).map((p) => `../../../${p}`),
    errors: [], deviations: contaminated ? ['arm A used the tool: contaminated, must be re-run'] : [] };
  (runs[`${arm}.r${r}`] ??= []).push(res);
  grades[key] = { status, got, workFolder: idx.workFolder, forbiddenCalls: arm === 'A' ? forbidden[key]?.forbiddenCalls ?? null : undefined, model: idx.model ?? null };
}
for (const [k, cases] of Object.entries(runs)) {
  const [arm, run] = k.split('.');
  const dir = path.join(EXP, 'runs', arm === 'A' ? 'A-claude' : 'B-claude-jev', run);
  fs.mkdirSync(dir, { recursive: true });
  const st = cases.map((x) => x.startedAt).sort(), en = cases.map((x) => x.finishedAt).sort();
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ experimentId: ID, arm, runId: run, startedAt: st[0], finishedAt: en.at(-1), cases }, null, 2));
}
fs.writeFileSync(path.join(EXP, 'evidence', 'grades.json'), JSON.stringify(grades, null, 2));
for (const [k, v] of Object.entries(grades)) console.log(`${k}: ${v.status} ${JSON.stringify(v.got)}${v.forbiddenCalls ? ` FORBIDDEN=${v.forbiddenCalls}` : ''}`);
