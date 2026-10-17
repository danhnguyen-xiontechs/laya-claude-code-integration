#!/usr/bin/env node
// grade.mjs — checks each case's final answer against the hard invariants in design.md (the checks, not the agent's
// own claim), then writes runs/A-claude/r1/results.json and runs/B-claude-jev/r1/results.json (case-result schema).
// Reads: evidence/answers/<case>.<A|B>.txt and evidence/run-index.json (written by collect.mjs).
// Usage: node grade.mjs
import fs from 'node:fs';
import path from 'node:path';

const EXP = import.meta.dirname;
const CASES = {
  '03-api-dto': {
    ids: ['S-1', 'S-2', 'S-3'],
    gold: { order: ['S-1 before S-2'], notSameWave: ['S-1/S-3'] },
    invariants: [
      ['S-1 is in an earlier wave than S-2', (w) => before(w, 'S-1', 'S-2')],
      ['S-1 and S-3 are not in the same wave', (w) => notSame(w, 'S-1', 'S-3')],
    ],
  },
  '04-migration': {
    ids: ['S-1', 'S-2', 'S-3'],
    gold: { notSameWave: ['S-1/S-2', 'S-1/S-3'] },
    invariants: [
      ['S-1 and S-2 are not in the same wave', (w) => notSame(w, 'S-1', 'S-2')],
      ['S-1 and S-3 are not in the same wave', (w) => notSame(w, 'S-1', 'S-3')],
    ],
  },
  '06-explicit': {
    ids: ['S-1', 'S-2', 'S-3', 'S-4'],
    gold: { order: ['S-1 before S-2', 'S-1 before S-3'] },
    invariants: [
      ['S-1 is in an earlier wave than S-2 (explicit link)', (w) => before(w, 'S-1', 'S-2')],
      ['S-1 is in an earlier wave than S-3 (text reference)', (w) => before(w, 'S-1', 'S-3')],
    ],
  },
  '07-cycle': {
    ids: ['S-1', 'S-2', 'S-3', 'S-4', 'S-5'],
    gold: { cycle: ['S-1', 'S-2', 'S-3'], blocked: ['S-4'], independent: ['S-5'] },
    invariants: [
      ['cycle members S-1, S-2, S-3 are in no wave', (w) => ['S-1', 'S-2', 'S-3'].every((id) => !inWaves(w, id))],
      ['cycle members S-1, S-2, S-3 are listed in needs_decision', (w, d) => ['S-1', 'S-2', 'S-3'].every((id) => d.includes(id))],
      ['S-4 (depends on the cycle) is in no wave', (w) => !inWaves(w, 'S-4')],
      ['S-5 (independent) is in a wave', (w) => inWaves(w, 'S-5')],
    ],
  },
};

const inWaves = (w, id) => w.some((wave) => wave.includes(id));
const waveIndex = (w, id) => w.findIndex((wave) => wave.includes(id));
// a is scheduled before b: b is either not scheduled (deferred), or a is scheduled in an earlier wave
const before = (w, a, b) => !inWaves(w, b) || (inWaves(w, a) && waveIndex(w, a) < waveIndex(w, b));
// a and b do not share a wave
const notSame = (w, a, b) => !(inWaves(w, a) && inWaves(w, b) && waveIndex(w, a) === waveIndex(w, b));

/** The last JSON object in the text that has a waves array (agents often add prose or code fences). */
function findAnswer(text) {
  for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    for (let j = text.lastIndexOf('}'); j > i; j = text.lastIndexOf('}', j - 1)) {
      try {
        const o = JSON.parse(text.slice(i, j + 1));
        if (Array.isArray(o?.waves)) return o;
      } catch { /* not this span */ }
    }
  }
  return null;
}

const index = JSON.parse(fs.readFileSync(path.join(EXP, 'evidence', 'run-index.json'), 'utf8'));
const runs = { A: { id: 'A-claude', cases: [] }, B: { id: 'B-claude-jev', cases: [] } };
const grades = {};

for (const [caseId, spec] of Object.entries(CASES)) for (const arm of ['A', 'B']) {
  const key = `${caseId}.${arm}`;
  const idx = index[key] ?? {};
  const answerFile = path.join(EXP, 'evidence', 'answers', `${key}.txt`);
  const text = fs.existsSync(answerFile) ? fs.readFileSync(answerFile, 'utf8') : null;
  const ans = text == null ? null : findAnswer(text);
  const started = idx.startedAt ?? null;
  const finished = idx.finishedAt ?? null;
  const now = new Date().toISOString(); // no transcript: the time of grading stands in (the schema needs a value)
  const base = { experimentId: '20261017-sbp-agent-01', caseId, arm, runId: 'r1', startedAt: started ?? now, finishedAt: finished ?? now };
  const errors = [];
  let status, observed, criteria = [], nd = [], w = [];
  if (!idx.transcript) {
    status = 'blocked'; observed = 'no subagent transcript found for this work folder'; errors.push('no transcript');
  } else if (!ans) {
    status = 'error'; observed = 'no final answer with a waves array'; errors.push('no parseable answer');
  } else {
    w = ans.waves; nd = Array.isArray(ans.needs_decision) ? ans.needs_decision : [];
    const flat = w.flat();
    const shape = Array.isArray(w) && w.every((x) => Array.isArray(x) && x.every((y) => typeof y === 'string')) && Array.isArray(ans.needs_decision);
    const known = [...flat, ...nd].every((id) => spec.ids.includes(id));
    const once = new Set(flat).size === flat.length;
    const placed = spec.ids.every((id) => flat.includes(id) || nd.includes(id));
    criteria.push({ criterionId: 'answer-shape', status: shape && known ? 'pass' : 'fail', notes: shape ? (known ? 'waves and needs_decision are arrays of batch ids' : 'unknown story id in the answer') : 'answer is not {waves: [[ids]], needs_decision: [ids]}' });
    criteria.push({ criterionId: 'each-id-once-in-waves', status: once ? 'pass' : 'fail', notes: once ? '' : 'a story appears in more than one wave' });
    criteria.push({ criterionId: 'every-story-placed', status: placed ? 'pass' : 'fail', notes: placed ? '' : 'a story is neither in waves nor in needs_decision' });
    spec.invariants.forEach(([label, fn], k) => {
      const ok = fn(w, nd);
      criteria.push({ criterionId: `inv-${k + 1}`, status: ok ? 'pass' : 'fail', notes: label });
    });
    const failed = criteria.filter((c) => c.status === 'fail');
    status = failed.length ? 'fail' : 'pass';
    const waveText = w.map((x, i) => `${i + 1}: ${x.join(', ') || '-'}`).join(' | ') || 'no waves';
    observed = `waves ${waveText}${nd.length ? `; needs_decision ${nd.join(', ')}` : ''}${failed.length ? `; fails: ${failed.map((c) => c.notes).join('; ')}` : ''}`;
  }
  const u = idx.usage;
  const usage = u ? {
    inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens,
    modelTurns: u.modelTurns, toolCalls: u.toolCalls, elapsedMs: u.elapsedMs ?? null,
    providerCalls: arm === 'B' ? jevCalls(caseId) : null,
    providerLatencyMs: arm === 'B' ? jevMedianLatency(caseId) : null,
    source: 'subagent transcript (subagent_usage.mjs --no-subagents), all tokens of the case agent session',
  } : {};
  const res = {
    ...base, status, goldOutcome: spec.gold, observedOutcome: observed, correct: status === 'pass' ? true : status === 'fail' ? false : null,
    criteriaResults: criteria, usage, evidenceRefs: ['texts', 'answers'].map((d) => `evidence/${d}/${key}.txt`).filter((p) => fs.existsSync(path.join(EXP, p))).map((p) => `../../../${p}`),
    errors,
    deviations: arm === 'B' && jevInvalid(caseId) > 0 ? [`${jevInvalid(caseId)} Jev shadow answer(s) invalid or failed (see evidence/_logs)`] : [],
  };
  runs[arm].cases.push(res);
  grades[key] = { status, model: idx.model ?? null, criteria, waves: w, needs_decision: nd };
}

function jevLines(caseId) {
  const f = path.join(EXP, 'evidence', '_logs', `${caseId}.B.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function jevCalls(caseId) {
  const lines = jevLines(caseId);
  return lines.length ? lines.reduce((n, l) => n + (l.jev_shadow?.calls ?? 0), 0) : null;
}
function jevInvalid(caseId) {
  return jevLines(caseId).reduce((n, l) => n + (l.jev ?? []).filter((e) => e.valid === false).length, 0);
}
function jevMedianLatency(caseId) {
  const v = jevLines(caseId).flatMap((l) => l.jev_shadow?.latencyMs ?? []).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
}

for (const arm of ['A', 'B']) {
  const dir = path.join(EXP, 'runs', runs[arm].id, 'r1');
  fs.mkdirSync(dir, { recursive: true });
  const starts = runs[arm].cases.map((c) => c.startedAt).sort();
  const ends = runs[arm].cases.map((c) => c.finishedAt).sort();
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
    experimentId: '20261017-sbp-agent-01', arm, runId: 'r1', startedAt: starts[0], finishedAt: ends.at(-1), cases: runs[arm].cases,
  }, null, 2));
}
fs.mkdirSync(path.join(EXP, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(EXP, 'evidence', 'grades.json'), JSON.stringify(grades, null, 2));
for (const [k, v] of Object.entries(grades)) console.log(`${k}: ${v.status} model=${v.model ?? '-'} waves=${JSON.stringify(v.waves)} needs_decision=${JSON.stringify(v.needs_decision)}`);
