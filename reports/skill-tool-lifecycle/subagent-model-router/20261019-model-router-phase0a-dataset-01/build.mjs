// Phase 0A builder. Reads the source files (read-only) and writes only into this folder.
// No model is called. Run: node build.mjs   then   node verify.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = 'D:/Laya';
const SR = `${ROOT}/.claude/skills/subagent-model-router`;
const RP = `${ROOT}/reports/skill-tool-lifecycle/subagent-model-router`;
const R4 = `${RP}/20261018-model-router-r4-weakcheck-01`;
const R5 = `${RP}/20261019-model-router-r5-jev-policy-01`;
const VERSION = '0A-v1';
const TIERS = ['haiku', 'sonnet', 'opus'];
const MIN_N = 3;
const OUTCOME_TYPES = ['bench-run', 'agent01-case', 'agent01-derived-first-attempt', 'r2-case', 'r2-derived-first-attempt', 'r3-attempt', 'r4-run'];
const TYPE_MAP = {
  design: 'planning/spec', debug: 'bugfix', explore: 'explore (read-only)', fix: 'bugfix', refactor: 'refactor', test: 'coding (tests)',
  control: 'coding (r4 control)', weak: 'coding (r4 weak-check)', Bug: 'bugfix (post-hoc)', Task: 'coding (post-hoc)',
};

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const sources = new Map(); // every file read -> sha256 (rel path)
const readBuf = (f) => { const b = fs.readFileSync(f); sources.set(rel(f), sha(b)); return b; };
const readText = (f) => readBuf(f).toString('utf8');
const readJSON = (f) => JSON.parse(readText(f));
const readJSONL = (f) => readText(f).split('\n').filter((l) => l.trim()).map((l, i) => ({ ...JSON.parse(l), _line: i + 1 }));
const bool = (v) => (typeof v === 'boolean' ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const tierOf = (s) => (/haiku/.test(s) ? 'haiku' : /sonnet/.test(s) ? 'sonnet' : /opus/.test(s) ? 'opus' : null);
const tierFromOutcome = (s) => { const m = String(s ?? '').match(/tier (haiku|sonnet|opus)/); return m ? m[1] : null; };
const blank = () => ({ runs: 0, pass: 0, fail: 0, unscored: 0, costRecorded: 0 });
const anomalies = [];

const { consistency } = await import(pathToFileURL(`${SR}/scripts/router.mjs`).href);

// ---------- 0A.2 Extract: one record per source row, undeduplicated ----------
const raw = [];
const push = (r) => {
  const rec = { id: `R${String(raw.length + 1).padStart(4, '0')}`, conditional: false, aggregate: false, aggregateOf: [], duplicateOf: [], ...r };
  raw.push(rec);
  return rec;
};

// bench tasks
const BENCH = `${SR}/bench/tasks`;
const benchIds = fs.readdirSync(BENCH).sort();
const benchCheckClass = (src) => (/nodeTest\(/.test(src) && /hiddenTests\(/.test(src) ? 'automatic: tests (nodeTest + hiddenTests)'
  : src.includes('readAnswer(') ? 'automatic: answer-only (readAnswer)'
    : src.includes('mutationCheck(') ? 'automatic: mutation check (mutationCheck)' : 'unknown');
// extra non-test checks in check.mjs; each covers only the criterion it tests (none mapped yet)
const benchExtras = (src) => [/grepWork\(/.test(src) && 'grep for leftover identifier', /readFileSync\(/.test(src) && 'source-text regex check', /env: \{ TZ/.test(src) && 'multi-timezone run'].filter(Boolean);
for (const id of benchIds) {
  const tj = readJSON(`${BENCH}/${id}/task.json`);
  const check = readText(`${BENCH}/${id}/check.mjs`);
  if (tj.id && tj.id !== id) anomalies.push(`bench folder ${id} has task.json id ${tj.id}`);
  push({ recordType: 'task-def', suite: 'bench', taskId: id, source: rel(`${BENCH}/${id}/task.json`), checkSource: rel(`${BENCH}/${id}/check.mjs`),
    kindVerbatim: tj.kind, typeVerbatim: tj.type, description: tj.prompt, acceptanceCriteria: null, checkClass: benchCheckClass(check), checkExtras: benchExtras(check) });
}

// bench runs (8 files). *esc files are escalation attempts, conditional on a haiku failure.
const RESULTS = `${SR}/bench/results`;
for (const f of fs.readdirSync(RESULTS).filter((x) => /^runs-.*\.jsonl$/.test(x)).sort()) {
  const p = `${RESULTS}/${f}`;
  for (const r of readJSONL(p)) {
    push({ recordType: 'bench-run', suite: 'bench', source: rel(p), line: r._line, taskId: r.task, kindVerbatim: r.kind, run: r.run,
      tier: r.tier, pass: bool(r.pass), cost: num(r.cost), conditional: /esc\.jsonl$/.test(f) });
  }
}

// JEV route answers (k=3 votes per task) and rules-only route
const jevAll = readJSON(`${RESULTS}/route-jev.json`);
for (const id of Object.keys(jevAll).sort()) {
  const e = jevAll[id];
  push({ recordType: 'route-jev', suite: 'bench', source: rel(`${RESULTS}/route-jev.json`), taskId: id, kindVerbatim: e.kind, rule: e.rule,
    voteTiers: e.answers.map((a) => a.tier), jevTierPrediction: consistency(e.answers).tier, voteCostUsd: e.answers.map((a) => num(a.cost)) });
}
const noneAll = readJSON(`${RESULTS}/route-none.json`);
for (const id of Object.keys(noneAll).sort()) {
  push({ recordType: 'route-none', suite: 'bench', source: rel(`${RESULTS}/route-none.json`), taskId: id, rule: noneAll[id].rule });
}

// agent-01 and r2 (same six tasks, distinct measurements). escalated = haiku failed first, final tier shown.
for (const [suite, dir] of [['agent01', '20261018-model-router-agent-01'], ['r2', '20261018-model-router-r2-agent-01']]) {
  const f = `${RP}/${dir}/evidence/cost.json`;
  const c = readJSON(f);
  c.perCase.forEach((x, i) => {
    const tier = tierOf(x.model);
    const esc = x.escalated === true;
    if (esc && x.arm !== 'B') anomalies.push(`${suite} arm ${x.arm} escalated: ${x.case} rep ${x.rep}`);
    push({ recordType: `${suite}-case`, suite, source: rel(f), line: i + 1, taskId: x.case, arm: x.arm, rep: x.rep, tier,
      pass: bool(x.pass), cost: num(x.costUsd), conditional: esc, escalated: esc });
    if (esc) {
      push({ recordType: `${suite}-derived-first-attempt`, suite, source: rel(f), line: i + 1, taskId: x.case, arm: x.arm, rep: x.rep, tier: 'haiku',
        pass: null, cost: null, conditional: false, derived: true, note: 'escalation flag only: haiku first attempt failed its check (inferred). Pass not recorded, so not scored' });
    }
  });
}

// r3 attempts (34 rows) with per-rep grades. first-attempt pass = grade starts with PASS; escalation pass = grade ends with PASS.
{
  const f = `${RP}/20261018-model-router-r3-agent-01/evidence/cost.json`;
  const gf = `${RP}/20261018-model-router-r3-agent-01/evidence/grades.json`;
  const c = readJSON(f);
  const g = readJSON(gf);
  c.rows.forEach((x, i) => {
    const first = x.attempt === 'first';
    const grade = g.grades[x.case]?.[x.arm]?.[Number(String(x.rep).replace(/\D/g, '')) - 1] ?? null;
    if (grade === null) anomalies.push(`r3 no grade: ${x.case} ${x.arm} ${x.rep}`);
    const pass = grade === null ? null : first ? /^PASS/.test(grade) : /PASS$/.test(grade);
    push({ recordType: 'r3-attempt', suite: 'r3', source: rel(f), line: i + 1, taskId: x.case, arm: x.arm, rep: x.rep, attempt: x.attempt,
      tier: x.tier, pass, grade, cost: num(x.usd), conditional: !first });
  });
}

// r4 weak-check cases: task definitions (case.json, task.md bullets, check, strict hidden test)
const R4CASES = `${R4}/cases`;
for (const id of fs.readdirSync(R4CASES).sort()) {
  const cj = readJSON(`${R4CASES}/${id}/case.json`);
  const md = readText(`${R4CASES}/${id}/task.md`);
  const chk = `${R4CASES}/${id}/check.mjs`;
  readText(chk);
  const strict = `${R4CASES}/${id}/hidden/strict.mjs`;
  const hasStrict = fs.existsSync(strict);
  if (hasStrict) readText(strict);
  if (cj.id !== id) anomalies.push(`r4 folder ${id} has case.json id ${cj.id}`);
  const criteria = md.split('\n').filter((l) => /^- /.test(l)).map((l) => l.slice(2).trim());
  push({ recordType: 'task-def', suite: 'r4', taskId: id, source: rel(`${R4CASES}/${id}/case.json`), checkSource: rel(chk),
    hiddenSource: hasStrict ? rel(strict) : null, kindVerbatim: cj.kind, typeVerbatim: cj.type, description: md.trim(),
    acceptanceCriteria: criteria, checkClass: hasStrict ? 'automatic: visible check + hidden strict tests' : 'automatic: visible check only',
    visibleCheckWeak: cj.kind === 'weak' });
}
// r4 runs: 2 arms x 2 reps x 6 cases. ref/ solutions are not read.
for (const arm of ['A-claude', 'B-claude-none']) {
  for (const rep of ['rep1', 'rep2']) {
    const p = `${R4}/runs/${arm}/${rep}/results.json`;
    const r = readJSON(p);
    r.cases.forEach((c, i) => {
      const attempts = Number((String(c.observedOutcome).match(/attempts (\d+)/) || [])[1] ?? 1);
      push({ recordType: 'r4-run', suite: 'r4', source: rel(p), line: i + 1, taskId: c.caseId, arm: c.arm ?? r.arm, rep,
        tier: tierFromOutcome(c.observedOutcome), pass: bool(c.correct), status: c.status, silentMiss: bool(c.silentMiss),
        cost: num(c.usage?.cost), costKind: c.usage?.costKind ?? null, conditional: attempts > 1, attempts });
    });
  }
}

// real stories (21). Text copy is the only one used as input; hindsight copy is checked for identity, and its risk field is not copied.
const REAL = `${SR}/real`;
const storiesT = readJSON(`${REAL}/stories-text.json`);
const storiesH = readJSON(`${REAL}/stories-hindsight.json`);
const truth = readJSON(`${REAL}/truth-effort.json`);
const govT = readJSON(`${REAL}/gov-text.json`);
const govH = readJSON(`${REAL}/gov-hindsight.json`);
const hById = Object.fromEntries(storiesH.map((s) => [s.id, s]));
let hindsightIdentical = 0;
for (const s of storiesT) {
  const textRec = push({ recordType: 'real-story', suite: 'real', source: rel(`${REAL}/stories-text.json`), taskId: s.id,
    description: s.task, summary: s.summary, acceptanceCriteria: null, checkClass: 'none' });
  const h = hById[s.id];
  const same = Boolean(h) && h.summary === s.summary && h.task === s.task;
  if (same) hindsightIdentical++;
  push({ recordType: 'real-story', suite: 'real', source: rel(`${REAL}/stories-hindsight.json`), taskId: s.id, identicalToText: same,
    duplicateOf: same ? [textRec.id] : [], note: 'hindsight copy; summary and task compared, risk field not copied (post-hoc)' });
}
for (const t of truth) {
  push({ recordType: 'real-truth', suite: 'real', source: rel(`${REAL}/truth-effort.json`), taskId: t.id, typeVerbatim: t.type,
    leakage: 'post-hoc PR data; not a model input', prs: t.prs, files: t.files, lines: t.lines, contract: t.contract, migration: t.migration, security: t.security });
}
for (const p of govT.profiles) {
  push({ recordType: 'real-gov-text', suite: 'real', source: rel(`${REAL}/gov-text.json`), taskId: p.story_id, governorTier: p.model_tier,
    reasonCodes: p.reason_codes ?? null, jevShadowTier: p.jev_shadow?.jev_tier ?? null, note: 'governor prediction, not an outcome' });
}
for (const p of govH.profiles) {
  push({ recordType: 'real-gov-hindsight', suite: 'real', source: rel(`${REAL}/gov-hindsight.json`), taskId: p.story_id, governorTier: p.model_tier,
    leakage: 'derived from truth-effort risk; not a model input' });
}

// round-5 workflow runs: aggregates over bench r5 attempts (linked in step 4 below)
for (const arm of ['A-claude', 'B-claude-jev']) {
  for (const rep of ['rep1', 'rep2']) {
    const p = `${R5}/runs/${arm}/${rep}/results.json`;
    const r = readJSON(p);
    for (const c of r.cases) {
      push({ recordType: 'r5-workflow', suite: 'r5', source: rel(p), taskId: c.caseId, arm, rep, status: c.status, cost: num(c.costUsd),
        aggregate: true, note: c.note ?? null });
    }
  }
}
// round-5 label sets (two files, same content expected)
const labelRecs = [];
for (const f of ['offline-score.json', 'bench-score-checked-jev.json']) {
  const o = readJSON(`${R5}/evidence/${f}`);
  const rec = push({ recordType: 'r5-label-set', suite: 'r5', source: rel(`${R5}/evidence/${f}`), labels: o.labels, tasks: o.tasks,
    note: 'round-5 label set. Not an outcome and not minimum_sufficient_tier. Provenance is not stated in the file.' });
  if (labelRecs.length && JSON.stringify(labelRecs[0].labels) === JSON.stringify(o.labels)) rec.duplicateOf = [labelRecs[0].id];
  labelRecs.push(rec);
}

// ---------- 0A.4 Dedupe: link aggregates and check cross-source duplicates ----------
const benchRuns = raw.filter((r) => r.recordType === 'bench-run');
const aggLinks = [];
for (const w of raw.filter((r) => r.recordType === 'r5-workflow')) {
  const L = w.arm === 'A-claude' ? 'A' : 'B';
  const n = w.rep.replace('rep', '');
  const hits = benchRuns.filter((b) => b.taskId === w.taskId
    && (b.source.endsWith(`runs-r5${L}${n}.jsonl`) || b.source.endsWith(`runs-r5${L}${n}esc.jsonl`)));
  const sum = hits.reduce((s, b) => s + (b.cost ?? 0), 0);
  const matched = hits.length > 0 && w.cost !== null && Math.abs(sum - w.cost) < 1e-6;
  if (matched) w.aggregateOf = hits.map((b) => b.id);
  aggLinks.push({ id: w.id, taskId: w.taskId, arm: w.arm, rep: w.rep, benchRows: hits.length, matched });
}
const outcomeRecs = raw.filter((r) => OUTCOME_TYPES.includes(r.recordType) && !r.aggregate && r.duplicateOf.length === 0);
const crossSourceCostDup = [];
for (let i = 0; i < outcomeRecs.length; i++) {
  for (let j = i + 1; j < outcomeRecs.length; j++) {
    const a = outcomeRecs[i];
    const b = outcomeRecs[j];
    if (a.source === b.source || a.taskId !== b.taskId || a.tier !== b.tier) continue;
    if (a.cost !== null && b.cost !== null && Math.abs(a.cost - b.cost) < 1e-6) crossSourceCostDup.push([a.id, b.id]);
  }
}

// ---------- 0A.3 Normalize: one record per task ----------
function tally(outs) {
  const t = {};
  for (const tier of TIERS) t[tier] = { independent: blank(), conditional: blank() };
  for (const r of outs) {
    if (!TIERS.includes(r.tier)) { anomalies.push(`outcome without tier: ${r.id}`); continue; }
    const c = t[r.tier][r.conditional ? 'conditional' : 'independent'];
    c.runs++;
    if (r.pass === true) c.pass++; else if (r.pass === false) c.fail++; else c.unscored++;
    if (r.cost !== null) c.costRecorded++;
  }
  return t;
}
function countRule(tal) {
  const i = TIERS.findIndex((t) => { const c = tal[t].independent; return c.runs >= MIN_N && c.fail === 0 && c.unscored === 0; });
  if (i < 0) return { candidate: null, countRuleMet: false, cheaperTiers: [] };
  const cheaper = TIERS.slice(0, i);
  const cheaperTiers = cheaper.map((t) => ({ tier: t, runs: tal[t].independent.runs, fail: tal[t].independent.fail }));
  return { candidate: TIERS[i], countRuleMet: cheaperTiers.every((c) => c.runs >= MIN_N && c.fail >= 1), cheaperTiers };
}
const labelMap = labelRecs[0]?.labels ?? {};
const tasks = [
  ...raw.filter((r) => r.recordType === 'task-def'),
  ...raw.filter((r) => r.recordType === 'real-story' && r.source.endsWith('stories-text.json')),
].map((d) => ({ suite: d.suite, taskId: d.taskId, rec: d }));
const norm = tasks.map(({ suite, taskId, rec }) => {
  const recs = raw.filter((r) => r.taskId === taskId);
  const tal = tally(recs.filter((r) => OUTCOME_TYPES.includes(r.recordType) && !r.aggregate && r.duplicateOf.length === 0));
  const cr = countRule(tal);
  const jev = recs.find((r) => r.recordType === 'route-jev');
  const realTruth = recs.find((r) => r.recordType === 'real-truth');
  const gov = recs.find((r) => r.recordType === 'real-gov-text');
  const typeVerbatim = suite === 'real' ? realTruth?.typeVerbatim ?? null : rec.typeVerbatim;
  const anyCost = Object.values(tal).some((t) => t.independent.costRecorded + t.conditional.costRecorded > 0);
  const reasons = ['criteria-coverage-unknown'];
  if (!cr.countRuleMet) reasons.push('count-rule-not-met');
  return {
    taskId,
    suite,
    sources: [...new Set(recs.map((r) => r.source))],
    kindVerbatim: rec.kindVerbatim ?? null,
    typeVerbatim,
    typeIsPostHoc: suite === 'real',
    taskType: TYPE_MAP[rec.kindVerbatim ?? typeVerbatim] ?? null,
    description: rec.description,
    acceptanceCriteria: rec.acceptanceCriteria ?? null,
    checkClass: rec.checkClass ?? 'none',
    checkExtras: rec.checkExtras ?? [],
    criteriaCoverage: 'unknown',
    outcomes: tal,
    costRecorded: anyCost,
    ruleTier: jev?.rule ?? null,
    voteTiers: jev?.voteTiers ?? null,
    jevTierPrediction: jev?.jevTierPrediction ?? null,
    governorTierText: gov?.governorTier ?? null,
    priorLabelR5: labelMap[taskId] ?? null,
    priorLabelUsedAsMinimumSufficient: false,
    minimumSufficientTier: 'unknown',
    countRuleCandidate: cr.candidate,
    countRuleMet: cr.countRuleMet,
    cheaperTiers: cr.cheaperTiers,
    reasonsNotConcludable: reasons,
    heldOutEligible: suite === 'real',
  };
});

// ---------- split (0A.4) ----------
const split = {};
for (const n of norm) {
  split[n.taskId] = n.suite === 'real'
    ? { split: 'reserve-unlabelled', group: `real:${n.taskId}`, heldOutEligible: true, reason: 'no outcomes or cost; reserve for 0B; grouped by story' }
    : { split: 'prior-rounds', group: `${n.suite}:${n.taskId}`, heldOutEligible: false,
      reason: n.suite === 'r4' ? 'round-4 weak-check evaluation already used this case' : 'bench outcomes already used in earlier rounds and the round-5 decision' };
}
const sortedPairs = Object.keys(split).sort().map((k) => [k, split[k].split]);
const assignmentsSha256 = sha(Buffer.from(JSON.stringify(sortedPairs)));
const groupCount = (s) => Object.values(split).filter((x) => x.split === s).length;

// ---------- coverage (0A.5) ----------
const countBy = (arr, f) => arr.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const sumTier = (tier, bucket) => norm.reduce((s, n) => {
  const c = n.outcomes[tier][bucket];
  return { runs: s.runs + c.runs, pass: s.pass + c.pass, fail: s.fail + c.fail, unscored: s.unscored + c.unscored, costRecorded: s.costRecorded + c.costRecorded };
}, blank());
const tierTotals = Object.fromEntries(TIERS.map((t) => [t, { independent: sumTier(t, 'independent'), conditional: sumTier(t, 'conditional') }]));
const tasksWithIndependentRuns = Object.fromEntries(TIERS.map((t) => [t, norm.filter((n) => n.outcomes[t].independent.runs > 0).length]));
const jevRows = norm.filter((n) => n.jevTierPrediction !== null);
const coverage = {
  version: VERSION,
  tasks: { total: norm.length, bySuite: countBy(norm, (n) => n.suite) },
  taskTypeVerbatim: {
    benchKind: countBy(norm.filter((n) => n.suite === 'bench'), (n) => n.kindVerbatim),
    benchTypeVerbatim: countBy(norm.filter((n) => n.suite === 'bench'), (n) => n.typeVerbatim),
    r4Kind: countBy(norm.filter((n) => n.suite === 'r4'), (n) => n.kindVerbatim),
    realTypePostHoc: countBy(norm.filter((n) => n.suite === 'real'), (n) => n.typeVerbatim),
  },
  taskTypeMapped: countBy(norm, (n) => n.taskType),
  checkClass: countBy(norm, (n) => `${n.suite}: ${n.checkClass}`),
  hasAutomaticCheck: norm.filter((n) => n.checkClass !== 'none' && n.checkClass !== 'unknown').length,
  checkExtras: norm.filter((n) => n.checkExtras.length).map((n) => ({ taskId: n.taskId, extras: n.checkExtras })),
  criteriaOnlyNoCheck: norm.filter((n) => (n.checkClass === 'none' || n.checkClass === 'unknown') && n.acceptanceCriteria).length,
  neither: norm.filter((n) => (n.checkClass === 'none' || n.checkClass === 'unknown') && !n.acceptanceCriteria).length,
  criteriaCoverageMapped: 0,
  perTier: {
    haiku: null, sonnet: null, opus: null,
  },
  tasksWithIndependentRuns,
  costRecordedTasks: norm.filter((n) => n.costRecorded).length,
  tierTotals,
  jev: {
    tasksWithRouteJev: jevRows.length,
    jevEqualsRule: jevRows.filter((n) => n.jevTierPrediction === n.ruleTier).length,
    jevTierCounts: countBy(jevRows, (n) => n.jevTierPrediction),
    ruleTierCounts: countBy(jevRows, (n) => n.ruleTier),
  },
  minimumSufficientTier: {
    concludable: norm.filter((n) => n.minimumSufficientTier !== 'unknown').length,
    notConcludable: norm.filter((n) => n.minimumSufficientTier === 'unknown').length,
    countRuleMetTasks: norm.filter((n) => n.countRuleMet).map((n) => ({ taskId: n.taskId, candidate: n.countRuleCandidate, cheaperTiers: n.cheaperTiers })),
    blockedByCriteriaCoverage: norm.length,
  },
  heldOut: { tasks: groupCount('held-out') },
  reserveUnlabelled: { tasks: groupCount('reserve-unlabelled') },
  priorRounds: { tasks: groupCount('prior-rounds') },
  perTask: norm.map((n) => ({
    taskId: n.taskId, suite: n.suite, checkClass: n.checkClass, criteriaCoverage: n.criteriaCoverage, costRecorded: n.costRecorded,
    outcomes: Object.fromEntries(TIERS.map((t) => [t, { independent: { runs: n.outcomes[t].independent.runs, pass: n.outcomes[t].independent.pass, fail: n.outcomes[t].independent.fail }, conditional: { runs: n.outcomes[t].conditional.runs, pass: n.outcomes[t].conditional.pass, fail: n.outcomes[t].conditional.fail } }])),
    countRuleCandidate: n.countRuleCandidate, countRuleMet: n.countRuleMet, minimumSufficientTier: n.minimumSufficientTier, reasonsNotConcludable: n.reasonsNotConcludable,
  })),
  dedupe: {
    r5WorkflowAggregates: { rows: aggLinks.length, matchedToBench: aggLinks.filter((a) => a.matched).length, detail: aggLinks },
    realHindsightIdentical: hindsightIdentical,
    r5LabelSetsIdentical: labelRecs.length === 2 && labelRecs[1].duplicateOf.length === 1,
    crossSourceCostDuplicates: crossSourceCostDup,
  },
  anomalies,
};
for (const t of TIERS) {
  coverage.perTier[t] = { independent: tierTotals[t].independent, conditional: tierTotals[t].conditional, tasksWithIndependentRuns: tasksWithIndependentRuns[t] };
}

// ---------- write ----------
const write = (name, obj) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(obj, null, 2)}\n`);
write('raw-sources.json', {
  version: VERSION,
  note: 'One record per source row, undeduplicated. Dedupe links are in duplicateOf / aggregateOf. Bench output text omitted (size). r4 ref/ solutions not read. Other skills folders not read.',
  sources: [...sources].map(([file, s]) => ({ file, sha256: s })),
  records: raw,
});
write('tasks.normalized.json', { version: VERSION, count: norm.length, tasks: norm });
write('split.json', {
  version: VERSION,
  rule: 'Group = bench task id, r4 case id, or real story id. No repo-change grouping is available in the sources, so the story is the group.',
  groups: { 'held-out': groupCount('held-out'), 'prior-rounds': groupCount('prior-rounds'), 'reserve-unlabelled': groupCount('reserve-unlabelled') },
  assignmentsSha256,
  assignments: split,
  sourceSha256: Object.fromEntries([...sources].sort()),
  contamination: [
    'held-out is empty: every task with outcomes (18 bench, 6 r4) was already used in earlier rounds or the round-5 decision.',
    'real stories have no outcomes and no cost; they are an unlabelled reserve for 0B.',
    'real hindsight governor profiles and the risk field derive from truth-effort PR data; they are not model inputs and are not used in any tier field.',
    'route-jev answers were produced by JEV on the bench tasks before round 5; they are predictions, not outcomes.',
    'round-5 label sets are not outcomes; they are kept as prior labels and are not used as minimum_sufficient_tier.',
  ],
  dedupe: 'See coverage.json dedupe. Workflow aggregates are kept as aggregates, not counted as runs.',
});
write('coverage.json', coverage);

const t = (n) => `${tierTotals[n].independent.runs} runs (${tierTotals[n].independent.pass} pass, ${tierTotals[n].independent.fail} fail, ${tierTotals[n].independent.unscored} unscored); conditional ${tierTotals[n].conditional.runs}`;
fs.writeFileSync(path.join(OUT, 'summary.md'), `# Phase 0A summary (${VERSION})

Status: built by build.mjs, checked by verify.mjs. No model was called. Gate 0A is for the user. Phase 0B has not started.

## What the set holds
- ${norm.length} tasks: ${coverage.tasks.bySuite.bench ?? 0} bench, ${coverage.tasks.bySuite.r4 ?? 0} r4 weak-check cases, ${coverage.tasks.bySuite.real ?? 0} real stories (no outcomes).
- Held-out: ${coverage.heldOut.tasks} tasks. Every task with outcomes was already used in earlier rounds (split.json).
- Reserve for 0B (unlabelled): ${coverage.reserveUnlabelled.tasks} real stories.

## Coverage
- Automatic check present: ${coverage.hasAutomaticCheck} tasks. Criteria only (no check): ${coverage.criteriaOnlyNoCheck}. Neither: ${coverage.neither}.
- Criteria mapped to checks: ${coverage.criteriaCoverageMapped} of ${norm.length} (unknown for all).
- haiku: ${t('haiku')}
- sonnet: ${t('sonnet')}
- opus: ${t('opus')}
- Tasks with recorded cost: ${coverage.costRecordedTasks} of ${norm.length}. Real stories have no cost.

## minimum_sufficient_tier
- Concludable for ${coverage.minimumSufficientTier.concludable} of ${norm.length} tasks. The reason is criteria coverage, which is unknown for every task.
- Count-rule candidates (not labels, shown only for Gate 0A): ${coverage.minimumSufficientTier.countRuleMetTasks.map((c) => `${c.taskId} -> ${c.candidate}`).join(', ') || 'none'}.

## Caveats
- Round-5 label sets (${Object.values(labelMap).length} tasks, all haiku) are kept as prior labels. They are not minimum_sufficient_tier.
- Escalation rows are conditional on a haiku failure and are counted separately.
- Round-5 workflow rows are aggregates. ${aggLinks.filter((a) => a.matched).length} of ${aggLinks.length} matched bench attempts within 1e-6.
- Bench task outputs are not in raw-sources.json (size).
- Not in scope: other skills' report folders, story-batch-planner/real, r4 ref/ solutions.
`);
console.log(JSON.stringify({ tasks: norm.length, raw: raw.length, sources: sources.size, heldOut: coverage.heldOut.tasks, reserve: coverage.reserveUnlabelled.tasks, anomalies: anomalies.length, aggMatched: `${aggLinks.filter((a) => a.matched).length}/${aggLinks.length}`, crossSourceCostDup: crossSourceCostDup.length, assignmentsSha256 }, null, 1));
