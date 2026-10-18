// collect_p3.mjs — builds the P3 raw results from the run state (run_cascade.mjs) and the subagent transcripts.
// Writes runs/<arm>/rep<n>/results.json (one per arm and repetition, six cases each), evidence/answers/<case>.<arm>.r<n>.txt
// (each hand-back saved verbatim from the SubagentHandback call) and evidence/cost.json (price-weighted, pricing.mjs).
// Usage: node scripts/collect_p3.mjs <scratchpad r4-bench dir>
import fs from 'node:fs';
import path from 'node:path';
import { usageCost } from '../../../../../.claude/skills/subagent-model-router/scripts/pricing.mjs';

const EXP = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(process.argv[2]);
const EXPERIMENT = '20261018-model-router-r4-weakcheck-01';
const CASES = ['c1-money', 'w1-ranges', 'w2-limiter', 'w3-template', 'w4-csv', 'w5-pages'];
const ARMS = { A: 'A-claude', B: 'B-claude-none' };
const subUsage = JSON.parse(fs.readFileSync(path.join(EXP, 'evidence', 'subagent-usage.json'), 'utf8'));
const fwd = (p) => p.split(path.sep).join('/');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const cost = { perCase: {} };

for (const caseId of CASES) {
  for (const arm of ['A', 'B']) {
    for (const rep of [1, 2]) {
      const name = `${caseId}.${arm}.r${rep}`;
      const runDir = path.join(ROOT, name);
      const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
      const f = state.final;
      const attemptRows = state.attempts.map((a) => {
        const work = fwd(path.join(runDir, `a${a.n}`));
        const su = subUsage[work];
        if (!su?.transcript) throw new Error(`no transcript for ${work}: ${su?.error}`);
        const u = su.usage;
        const models = u.models ?? [];
        const modelOk = models.every((m) => m.includes(a.tier === 'haiku' ? 'haiku' : 'sonnet'));
        const usd = usageCost(a.tier, {
          input_tokens: u.inputTokens, output_tokens: u.outputTokens,
          cache_read_input_tokens: u.cacheReadTokens, cache_creation_input_tokens: u.cacheWriteTokens,
        });
        // handback text, verbatim from the SubagentHandback call
        const hb = readJsonl(su.transcript).flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []).filter((c) => c.type === 'tool_use' && c.name === 'SubagentHandback'));
        const answer = hb.length ? hb[hb.length - 1].input?.message ?? JSON.stringify(hb[hb.length - 1].input) : null;
        return { attempt: a.n, tier: a.tier, usage: u, usd, modelOk, models, answer, visible: a.visible, transcript: su.transcript };
      });
      const totals = attemptRows.reduce((t, r) => ({
        inputTokens: t.inputTokens + r.usage.inputTokens, outputTokens: t.outputTokens + r.usage.outputTokens,
        cacheReadTokens: t.cacheReadTokens + r.usage.cacheReadTokens, cacheWriteTokens: t.cacheWriteTokens + r.usage.cacheWriteTokens,
        modelTurns: t.modelTurns + (r.usage.modelTurns ?? 0), toolCalls: t.toolCalls + (r.usage.toolCalls ?? 0),
        usd: t.usd + r.usd,
      }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, modelTurns: 0, toolCalls: 0, usd: 0 });
      const answerRel = `evidence/answers/${name}.txt`;
      fs.mkdirSync(path.join(EXP, 'evidence', 'answers'), { recursive: true });
      fs.writeFileSync(path.join(EXP, answerRel), attemptRows.map((r) => r.answer ?? '(no SubagentHandback found)').join('\n\n--- attempt break ---\n\n') + '\n');
      const stat = fs.statSync(runDir);
      const strictPass = !!f.strict;
      const deviations = [];
      if (attemptRows.some((r) => !r.modelOk)) deviations.push('model in transcript did not match the tier');
      const result = {
        status: strictPass ? 'pass' : 'fail',
        caseId,
        observedOutcome: `hidden strict ${strictPass ? 'pass' : 'fail'}; visible ${f.visible ? 'pass' : 'fail'}; silentMiss ${f.silentMiss}; tier ${attemptRows.map((r) => r.tier).join('>')}; attempts ${attemptRows.length}`,
        correct: strictPass,
        silentMiss: !!f.silentMiss,
        usage: {
          inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens, cacheWriteTokens: totals.cacheWriteTokens,
          modelTurns: totals.modelTurns, toolCalls: totals.toolCalls,
          cost: +totals.usd.toFixed(6), costKind: 'estimated',
          source: 'subagent transcript usage (transcript_usage.mjs) priced with pricing.mjs list prices',
        },
        errors: [],
        deviations,
        evidenceRefs: [answerRel],
        startedAt: stat.birthtime.toISOString(),
        finishedAt: stat.mtime.toISOString(),
      };
      // per-run results files are written below; keep the row keyed by arm and rep
      (cost.perCase[`${arm}.r${rep}`] ??= []).push({ caseId, usd: totals.usd, attempts: attemptRows.map(({ answer, ...r }) => r) });
      const runId = `rep${rep}`;
      const out = path.join(EXP, 'runs', ARMS[arm], runId, 'results.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { experimentId: EXPERIMENT, arm, runId, startedAt: null, finishedAt: null, cases: [] };
      existing.cases = existing.cases.filter((c) => c.caseId !== caseId).concat({ schemaVersion: 1, experimentId: EXPERIMENT, arm, runId, ...result });
      existing.cases.sort((x, y) => CASES.indexOf(x.caseId) - CASES.indexOf(y.caseId));
      existing.startedAt = existing.cases.map((c) => c.startedAt).sort()[0];
      existing.finishedAt = existing.cases.map((c) => c.finishedAt).sort().at(-1);
      fs.writeFileSync(out, JSON.stringify(existing, null, 2) + '\n');
    }
  }
}

// price per arm, per run: sum of all attempts
const summary = {};
for (const arm of ['A', 'B']) {
  summary[arm] = { usd: 0, rawTokens: 0, firstAttemptUsd: 0, escalationUsd: 0, runs: 0 };
  for (const rep of [1, 2]) {
    for (const row of cost.perCase[`${arm}.r${rep}`] ?? []) {
      summary[arm].usd += row.usd;
      row.attempts.forEach((a) => {
        const u = a.usage;
        summary[arm].rawTokens += u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
        const usd = usageCost(a.tier, { input_tokens: u.inputTokens, output_tokens: u.outputTokens, cache_read_input_tokens: u.cacheReadTokens, cache_creation_input_tokens: u.cacheWriteTokens });
        if (a.attempt === 1) summary[arm].firstAttemptUsd += usd; else summary[arm].escalationUsd += usd;
      });
      summary[arm].runs++;
    }
  }
  summary[arm].usd = +summary[arm].usd.toFixed(6);
  summary[arm].firstAttemptUsd = +summary[arm].firstAttemptUsd.toFixed(6);
  summary[arm].escalationUsd = +summary[arm].escalationUsd.toFixed(6);
}
summary.priceChangePct = +(100 * (summary.B.usd / summary.A.usd - 1)).toFixed(1);
summary.perCase = Object.fromEntries(CASES.map((c) => [c, {
  A_usd: +((cost.perCase['A.r1'].find((r) => r.caseId === c)?.usd ?? 0) + (cost.perCase['A.r2'].find((r) => r.caseId === c)?.usd ?? 0)).toFixed(6),
  B_usd: +((cost.perCase['B.r1'].find((r) => r.caseId === c)?.usd ?? 0) + (cost.perCase['B.r2'].find((r) => r.caseId === c)?.usd ?? 0)).toFixed(6),
}]));
fs.writeFileSync(path.join(EXP, 'evidence', 'cost.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ A: summary.A, B: summary.B, priceChangePct: summary.priceChangePct }));
