// Builds runs/<arm>/<rN>/results.json and evidence/cost.json from evidence/subagent-usage.json, grades.json, run-index.json.
import fs from 'node:fs';
import path from 'node:path';
const here = import.meta.dirname;
const J = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const usage = J('evidence/subagent-usage.json'), grades = J('evidence/grades.json'), idx = J('evidence/run-index.json');
const EXP = '20261018-model-router-r2-agent-01';
const cost = { perCase: [], totals: {} };
for (const rep of [1, 2]) for (const arm of ['A', 'B']) {
  const rows = idx.filter((e) => e.rep === rep && e.arm === arm);
  const cases = rows.map((e) => {
    const key = path.basename(e.dir), u = usage[key], g = grades[key];
    const us = u.usage;
    const model = u.models.join(',');
    cost.perCase.push({ case: e.case, arm, rep, model, pass: g.pass, costUsd: u.costUsd, tokens: us.inputTokens + us.outputTokens + us.cacheReadTokens + us.cacheWriteTokens, escalated: false, forbiddenCalls: u.forbiddenCalls });
    return {
      experimentId: EXP, caseId: e.case, arm, runId: `r${rep}`, startedAt: u.first, finishedAt: u.last,
      status: g.pass ? 'pass' : 'fail',
      observedOutcome: `ran on ${model}${arm === 'B' ? ` (router: rule ${e.route.rule.tier}, Jev ${e.route.answers.map((a) => a.tier).join('/')} -> ${e.route.tier})` : ' (default)'}; check ${g.pass ? 'passed' : 'failed'}; list cost $${u.costUsd.toFixed(4)}`,
      correct: g.pass,
      usage: { inputTokens: us.inputTokens, outputTokens: us.outputTokens, cacheReadTokens: us.cacheReadTokens, cacheWriteTokens: us.cacheWriteTokens, modelTurns: us.modelTurns, toolCalls: us.toolCalls, providerCalls: arm === 'B' ? e.route.answers.length : 0, fallbackCount: 0, providerLatencyMs: arm === 'B' ? e.route.latencyMs : null, elapsedMs: Date.parse(u.last) - Date.parse(u.first), cost: Number(u.costUsd.toFixed(6)), costKind: 'estimated', source: 'subagent transcript, list-price weighted (scripts/pricing.mjs)' },
      evidenceRefs: [`evidence/texts/${e.case}.${arm}.r${rep}.txt`, `evidence/answers/${e.case}.${arm}.r${rep}.txt`, ...(arm === 'B' ? [`evidence/routes/${e.case}.B.r${rep}.json`] : [])],
    };
  });
  const dir = path.join(here, 'runs', arm === 'A' ? 'A-claude' : 'B-claude-jev', `r${rep}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ experimentId: EXP, arm, runId: `r${rep}`, startedAt: cases[0].startedAt, finishedAt: cases.at(-1).finishedAt, cases }, null, 2));
}
for (const arm of ['A', 'B']) {
  const rs = cost.perCase.filter((c) => c.arm === arm);
  cost.totals[arm] = { costUsd: rs.reduce((s, c) => s + c.costUsd, 0), tokens: rs.reduce((s, c) => s + c.tokens, 0), passed: rs.filter((c) => c.pass).length, n: rs.length, escalations: 0 };
}
cost.totals.relCostBvsA = cost.totals.B.costUsd / cost.totals.A.costUsd;
fs.writeFileSync(path.join(here, 'evidence/cost.json'), JSON.stringify(cost, null, 2));
console.log(JSON.stringify(cost.totals, null, 1));
for (const c of ['e1-locate','e2-count','r1-rename','f1-paginate','d3-maplimit','d5-deps']) {
  const f = (a) => cost.perCase.filter((x) => x.case === c && x.arm === a).reduce((s, x) => s + x.costUsd, 0);
  console.log(c.padEnd(12), 'A', f('A').toFixed(3), 'B', f('B').toFixed(3));
}
