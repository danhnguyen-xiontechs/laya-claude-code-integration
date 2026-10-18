#!/usr/bin/env node
// grade.mjs — 20261018-sbp-r2-agent-01: collects each case agent's real token usage (subagent_usage.mjs, with
// --forbid on arm A), saves its hand-back answer verbatim and the first planner output it saw, grades the
// answer against the gold invariants below, and writes runs/<arm>/<rep>/results.json.
// The gold lives only here; this file was written after all 12 case agents had finished.
// Usage: SBP_SCRATCH=<scratch>\sbp2 node grade.mjs <subagentsDir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXP = import.meta.dirname;
const ID = '20261018-sbp-r2-agent-01';
const USAGE = path.resolve(EXP, '..', '..', '..', '..', '.claude', 'skills', 'build-skill-tool-workflow', 'scripts', 'subagent_usage.mjs');
const SCRATCH = process.env.SBP_SCRATCH;
const SUB = process.argv[2];
if (!SCRATCH || !SUB) { console.error('Usage: SBP_SCRATCH=... node grade.mjs <subagentsDir>'); process.exit(2); }

const inW = (w, id) => w.some((x) => x.includes(id));
const wi = (w, id) => w.findIndex((x) => x.includes(id));
const before = (a, b) => (w) => !inW(w, b) || (inW(w, a) && wi(w, a) < wi(w, b));
const notSame = (a, b) => (w) => !(inW(w, a) && inW(w, b) && wi(w, a) === wi(w, b));
const held = (id) => (w, d) => d.includes(id);
const unscheduled = (id) => (w) => !inW(w, id);
const scheduled = (id) => (w) => inW(w, id);

const CASES = {
  'h1-payroll': { n: 12, inv: [
    ['P-1 before P-2 (P-2 reads the column P-1 adds)', before('P-1', 'P-2')],
    ['P-1 and P-9 not in the same wave (two migrations)', notSame('P-1', 'P-9')],
    ['P-3 before P-4 (endpoint producer → consumer)', before('P-3', 'P-4')],
    ['P-3 before P-12 (text reference)', before('P-3', 'P-12')],
    ['P-5 before P-6 (explicit link)', before('P-5', 'P-6')],
    ['P-6 and P-11 not in the same wave (same template file)', notSame('P-6', 'P-11')],
    ['P-7 (depends on FIN-12 outside the batch) in needs_decision', held('P-7')],
    ['P-7 not scheduled', unscheduled('P-7')],
    ['P-8 (incomplete) in needs_decision', held('P-8')],
    ['P-10 (independent) scheduled', scheduled('P-10')],
  ] },
  'h2-portal': { n: 11, inv: [
    ['Q-1 and Q-2 (mutual: link one way, text the other) not scheduled', (w) => !inW(w, 'Q-1') && !inW(w, 'Q-2')],
    ['Q-1 and Q-2 in needs_decision', (w, d) => d.includes('Q-1') && d.includes('Q-2')],
    ['Q-3 (builds on the cycle) not scheduled', unscheduled('Q-3')],
    ['Q-4 before Q-5 (endpoint producer → consumer)', before('Q-4', 'Q-5')],
    ['Q-4 before Q-6 (endpoint producer → consumer)', before('Q-4', 'Q-6')],
    ['Q-4 and Q-7 not in the same wave (both change TimesheetDto)', notSame('Q-4', 'Q-7')],
    ['Q-5 and Q-8 not in the same wave (same fixture)', notSame('Q-5', 'Q-8')],
    ['Q-11 (incomplete) in needs_decision', held('Q-11')],
    ['Q-9 (independent) scheduled', scheduled('Q-9')],
  ] },
  'h3-hr': { n: 10, inv: [
    ['R-1 (incomplete) in needs_decision', held('R-1')],
    ['R-1 before R-2 (R-2 depends on the incomplete R-1)', before('R-1', 'R-2')],
    ['R-3 and R-4 not in the same wave (two migrations)', notSame('R-3', 'R-4')],
    ['R-3 before R-5 (R-5 reads the column R-3 adds)', before('R-3', 'R-5')],
    ['R-6 (depends on HR-404 outside the batch) in needs_decision', held('R-6')],
    ['R-6 not scheduled', unscheduled('R-6')],
    ['R-6 before R-7 (text reference)', before('R-6', 'R-7')],
    ['R-8 before R-9 (endpoint producer → consumer)', before('R-8', 'R-9')],
    ['R-10 (independent) scheduled', scheduled('R-10')],
  ] },
};
const REPS = ['r1', 'r2'];
const ARMS = { A: 'A-claude', B: 'B-claude-jev' };
const keyOf = (c, a, r) => `${c}.${a}.${r}`;
const dirOf = (k) => path.join(SCRATCH, 'work', k);
const keys = Object.keys(CASES).flatMap((c) => REPS.flatMap((r) => Object.keys(ARMS).map((a) => keyOf(c, a, r))));

// 1. real usage (+ forbidden-tool check) from the subagent transcripts
const run = (extra, ks) => {
  const r = spawnSync(process.execPath, [USAGE, SUB, ...extra, ...ks.map(dirOf)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  return JSON.parse(r.stdout);
};
const uA = run(['--forbid', 'story-batch-planner|plan\\.mjs'], keys.filter((k) => k.includes('.A.')));
const uB = run([], keys.filter((k) => k.includes('.B.')));
const usage = { ...uA, ...uB };
const scrub = (s) => s.replaceAll(SCRATCH, '<scratch>').replace(/C:\\\\Users\\\\ADMIN|C:\\Users\\ADMIN|C:\/Users\/ADMIN/g, '<home>');
const ev = (...p) => path.join(EXP, 'evidence', ...p);
for (const d of ['answers', 'texts', '_logs']) fs.mkdirSync(ev(d), { recursive: true });
fs.writeFileSync(ev('subagent-usage.json'), scrub(JSON.stringify(usage, null, 2)));

// 2. answer (SubagentHandback input) and first planner/batch output seen, per transcript
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const txt = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : '');
function findAnswer(text) {
  for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    for (let j = text.lastIndexOf('}'); j > i; j = text.lastIndexOf('}', j - 1)) {
      try { const o = JSON.parse(text.slice(i, j + 1)); if (Array.isArray(o?.waves)) return o; } catch { /* next */ }
    }
  }
  return null;
}
const runs = {}, grades = {};
for (const k of keys) {
  const [c, a, r] = k.split('.');
  const u = usage[dirOf(k)];
  const now = new Date().toISOString();
  let answer = null, first = null, model = null, t0 = null, t1 = null;
  if (u?.transcript) {
    const L = lines(u.transcript);
    const ts = L.map((e) => Date.parse(e.timestamp ?? '')).filter((x) => !Number.isNaN(x));
    t0 = ts.length ? new Date(Math.min(...ts)).toISOString() : null; t1 = ts.length ? new Date(Math.max(...ts)).toISOString() : null;
    model = L.find((e) => e.type === 'assistant' && e.message?.model)?.message.model ?? null;
    for (const e of L) for (const b of e.message?.content ?? []) {
      if (b?.type === 'tool_use' && /handback/i.test(b.name)) answer = typeof b.input === 'string' ? b.input : (b.input?.report ?? b.input?.message ?? b.input?.result ?? JSON.stringify(b.input));
      if (!first && b?.type === 'tool_result' && (a === 'A' ? /"stories"/ : /Story batch plan|planner failed/).test(txt(b.content))) first = txt(b.content);
    }
    if (answer == null) for (const e of L) if (e.type === 'assistant') { const t = (e.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim(); if (t) answer = t; }
  }
  if (answer != null) fs.writeFileSync(ev('answers', `${k}.txt`), answer);
  if (first != null) fs.writeFileSync(ev('texts', `${k}.txt`), scrub(first));
  const spec = CASES[c];
  const ans = answer ? findAnswer(answer) : null;
  const crit = [], errors = [];
  let status, observed, w = [], nd = [];
  if (!u?.transcript) { status = 'blocked'; observed = 'no transcript found for this work folder'; errors.push('no transcript'); }
  else if (a === 'A' && u.forbiddenCalls > 0) { status = 'blocked'; observed = `arm A used the planner (${u.forbiddenCalls} calls): contaminated`; errors.push('contaminated'); }
  else if (!ans) { status = 'error'; observed = 'no answer with a waves array'; errors.push('no parseable answer'); }
  else {
    w = ans.waves; nd = Array.isArray(ans.needs_decision) ? ans.needs_decision.map(String) : [];
    const flat = w.flat();
    crit.push({ criterionId: 'each-id-once-in-waves', status: new Set(flat).size === flat.length ? 'pass' : 'fail', notes: '' });
    crit.push({ criterionId: 'every-story-placed', status: new Set([...flat, ...nd]).size >= spec.n ? 'pass' : 'fail', notes: '' });
    spec.inv.forEach(([label, fn], i) => crit.push({ criterionId: `inv-${i + 1}`, status: fn(w, nd) ? 'pass' : 'fail', notes: label }));
    const failed = crit.filter((x) => x.status === 'fail');
    status = failed.length ? 'fail' : 'pass';
    observed = `${w.length} waves: ${w.map((x) => x.join(',')).join(' | ')}; needs_decision ${nd.join(',') || '-'}${failed.length ? `; FAILS: ${failed.map((x) => x.notes || x.criterionId).join('; ')}` : ''}`;
  }
  const logF = path.join(SCRATCH, '_logs', `${k}.jsonl`);
  const log = a === 'B' && fs.existsSync(logF) ? fs.readFileSync(logF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (log.length) fs.writeFileSync(ev('_logs', `${k}.jsonl`), log.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const lat = log.flatMap((l) => l.jev_shadow?.latencyMs ?? []).sort((x, y) => x - y);
  const U = u?.usage;
  const res = {
    experimentId: ID, caseId: c, arm: a, runId: r, startedAt: t0 ?? now, finishedAt: t1 ?? now, status,
    observedOutcome: observed, correct: status === 'pass' ? true : status === 'fail' ? false : null, criteriaResults: crit,
    usage: U ? { inputTokens: U.inputTokens, outputTokens: U.outputTokens, cacheReadTokens: U.cacheReadTokens, cacheWriteTokens: U.cacheWriteTokens, modelTurns: U.modelTurns, toolCalls: U.toolCalls, elapsedMs: U.elapsedMs ?? null,
      providerCalls: a === 'B' ? log.reduce((n, l) => n + (l.jev_shadow?.calls ?? 0), 0) : null, providerLatencyMs: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null,
      source: 'subagent transcript (subagent_usage.mjs), all tokens of the case agent session' } : {},
    evidenceRefs: ['texts', 'answers'].filter((d) => fs.existsSync(ev(d, `${k}.txt`))).map((d) => `../../../evidence/${d}/${k}.txt`),
    errors, deviations: a === 'B' && log.length > 1 ? [`planner wrapper ran ${log.length} times`] : [],
  };
  ((runs[a] ||= {})[r] ||= []).push(res);
  grades[k] = { status, model, forbiddenCalls: u?.forbiddenCalls ?? null, tokens: U ? U.inputTokens + U.outputTokens + U.cacheReadTokens + U.cacheWriteTokens : null, waves: w, needs_decision: nd, failed: crit.filter((x) => x.status === 'fail').map((x) => x.notes) };
}
for (const [a, byRep] of Object.entries(runs)) for (const [r, cases] of Object.entries(byRep)) {
  const dir = path.join(EXP, 'runs', ARMS[a], r); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ experimentId: ID, arm: a, runId: r, startedAt: cases.map((x) => x.startedAt).sort()[0], finishedAt: cases.map((x) => x.finishedAt).sort().at(-1), cases }, null, 2));
}
fs.writeFileSync(ev('grades.json'), JSON.stringify(grades, null, 2));
for (const [k, g] of Object.entries(grades)) console.log(`${k.padEnd(18)} ${g.status.padEnd(5)} tok=${g.tokens} forbid=${g.forbiddenCalls ?? '-'} model=${g.model} ${g.failed.length ? 'FAILS: ' + g.failed.join('; ') : ''}`);
