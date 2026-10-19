// Phase 0A verifier. Independent of build.mjs: re-reads the source files on disk and recounts from raw-sources.json.
// Run: node verify.mjs   (exit code 1 on any failure). No model is called.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = 'D:/Laya';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const fromRoot = (rel) => path.join(ROOT, rel);
const raw = readJ(path.join(OUT, 'raw-sources.json'));
const cov = readJ(path.join(OUT, 'coverage.json'));
const split = readJ(path.join(OUT, 'split.json'));
const norm = readJ(path.join(OUT, 'tasks.normalized.json')).tasks;
const summaryMd = fs.readFileSync(path.join(OUT, 'summary.md'), 'utf8');
const TIERS = ['haiku', 'sonnet', 'opus'];
const OUTCOME = new Set(['bench-run', 'agent01-case', 'agent01-derived-first-attempt', 'r2-case', 'r2-derived-first-attempt', 'r3-attempt', 'r4-run']);
const fails = [];
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fails.push(msg); };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
const empty = () => ({ runs: 0, pass: 0, fail: 0, unscored: 0, costRecorded: 0 });
const pickCount = (c) => ({ runs: c.runs, pass: c.pass, fail: c.fail, unscored: c.unscored, costRecorded: c.costRecorded });

// A. every source file still matches the hash recorded at build time
for (const s of raw.sources) ok(sha(fs.readFileSync(fromRoot(s.file))) === s.sha256, `source changed since build: ${s.file}`);
for (const [f, h] of Object.entries(split.sourceSha256)) ok(sha(fs.readFileSync(fromRoot(f))) === h, `split source hash mismatch: ${f}`);

// B. extracted values equal the values on disk
const cache = {};
const jsonl = (rel) => (cache[rel] ??= fs.readFileSync(fromRoot(rel), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
const jsonF = (rel) => (cache[rel] ??= readJ(fromRoot(rel)));
const R3_GRADES = '.claude/../reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r3-agent-01/evidence/grades.json';
const r3Grades = readJ(fromRoot(R3_GRADES.replace('.claude/../', '')));
for (const r of raw.records) {
  if (r.recordType === 'bench-run') {
    const d = jsonl(r.source)[r.line - 1];
    eq([d.task, d.tier, d.pass, d.cost], [r.taskId, r.tier, r.pass, r.cost], `bench-run ${r.id}`);
  } else if (r.recordType === 'agent01-case' || r.recordType === 'r2-case') {
    const d = jsonF(r.source).perCase[r.line - 1];
    eq([d.case, d.arm, d.rep, d.pass, d.costUsd], [r.taskId, r.arm, r.rep, r.pass, r.cost], `${r.recordType} ${r.id}`);
  } else if (r.recordType === 'r3-attempt') {
    const d = jsonF(r.source).rows[r.line - 1];
    eq([d.case, d.arm, d.rep, d.attempt, d.usd], [r.taskId, r.arm, r.rep, r.attempt, r.cost], `r3-attempt ${r.id}`);
    const idx = Number(String(d.rep).replace(/\D/g, '')) - 1;
    const grade = r3Grades.grades[d.case][d.arm][idx];
    const pass = d.attempt === 'first' ? /^PASS/.test(grade) : /PASS$/.test(grade);
    eq(r.pass, pass, `r3 pass from grades ${r.id}`);
  } else if (r.recordType === 'r4-run') {
    const d = jsonF(r.source).cases[r.line - 1];
    eq([d.caseId, d.correct ?? null, d.usage?.cost ?? null], [r.taskId, r.pass, r.cost], `r4-run ${r.id}`);
  }
}

// B2. row counts against disk
const benchDir = '.claude/skills/subagent-model-router/bench/results';
const diskBench = fs.readdirSync(fromRoot(benchDir)).filter((f) => /^runs-.*\.jsonl$/.test(f))
  .reduce((s, f) => s + jsonl(`${benchDir}/${f}`).length, 0);
eq(raw.records.filter((r) => r.recordType === 'bench-run').length, diskBench, 'bench-run rows vs jsonl lines on disk');
const R5 = 'reports/skill-tool-lifecycle/subagent-model-router/20261019-model-router-r5-jev-policy-01/runs';
const diskR5 = ['A-claude', 'B-claude-jev'].flatMap((a) => ['rep1', 'rep2'].map((p) => jsonF(`${R5}/${a}/${p}/results.json`).cases.length)).reduce((s, n) => s + n, 0);
eq(raw.records.filter((r) => r.recordType === 'r5-workflow').length, diskR5, 'r5 workflow cases vs disk');

// C. recount outcomes (independent code path)
const per = {};
for (const r of raw.records) {
  if (!OUTCOME.has(r.recordType) || r.aggregate || (r.duplicateOf ?? []).length > 0) continue;
  ok(TIERS.includes(r.tier), `outcome without a tier: ${r.id}`);
  if (!TIERS.includes(r.tier)) continue;
  const b = (per[r.taskId] ??= { haiku: { independent: empty(), conditional: empty() }, sonnet: { independent: empty(), conditional: empty() }, opus: { independent: empty(), conditional: empty() } });
  const c = b[r.tier][r.conditional ? 'conditional' : 'independent'];
  c.runs++;
  if (r.pass === true) c.pass++; else if (r.pass === false) c.fail++; else c.unscored++;
  if (r.cost !== null && r.cost !== undefined) c.costRecorded++;
}
for (const id of Object.keys(per)) ok(norm.some((n) => n.taskId === id), `orphan outcomes for ${id}`);
for (const p of cov.perTask) {
  for (const t of TIERS) {
    const want = per[p.taskId]?.[t] ?? { independent: empty(), conditional: empty() };
    eq({ i: [p.outcomes[t].independent.runs, p.outcomes[t].independent.pass, p.outcomes[t].independent.fail], c: [p.outcomes[t].conditional.runs, p.outcomes[t].conditional.pass, p.outcomes[t].conditional.fail] },
      { i: [want.independent.runs, want.independent.pass, want.independent.fail], c: [want.conditional.runs, want.conditional.pass, want.conditional.fail] }, `perTask ${p.taskId} ${t}`);
  }
}
for (const t of TIERS) for (const bucket of ['independent', 'conditional']) {
  const sum = Object.values(per).reduce((s, b) => {
    const c = b[t][bucket];
    return { runs: s.runs + c.runs, pass: s.pass + c.pass, fail: s.fail + c.fail, unscored: s.unscored + c.unscored, costRecorded: s.costRecorded + c.costRecorded };
  }, empty());
  eq(pickCount(cov.tierTotals[t][bucket]), sum, `tierTotals ${t} ${bucket}`);
}
eq(cov.costRecordedTasks, norm.filter((n) => { const p = per[n.taskId]; return p && TIERS.some((t) => p[t].independent.costRecorded + p[t].conditional.costRecorded > 0); }).length, 'costRecordedTasks');
eq(TIERS.map((t) => norm.filter((n) => (per[n.taskId]?.[t].independent.runs ?? 0) > 0).length), TIERS.map((t) => cov.tasksWithIndependentRuns[t]), 'tasksWithIndependentRuns');

// D. check classes re-read from check.mjs on disk
const classify = (src) => (/nodeTest\(/.test(src) && /hiddenTests\(/.test(src) ? 'automatic: tests (nodeTest + hiddenTests)'
  : /readAnswer\(/.test(src) ? 'automatic: answer-only (readAnswer)'
    : /mutationCheck\(/.test(src) ? 'automatic: mutation check (mutationCheck)' : 'unknown');
for (const n of norm.filter((x) => x.suite === 'bench')) {
  const src = fs.readFileSync(fromRoot(`.claude/skills/subagent-model-router/bench/tasks/${n.taskId}/check.mjs`), 'utf8');
  eq(n.checkClass, classify(src), `bench check class ${n.taskId}`);
  ok(classify(src) !== 'unknown', `unclassified bench check ${n.taskId}`);
}
const R4 = 'reports/skill-tool-lifecycle/subagent-model-router/20261018-model-router-r4-weakcheck-01/cases';
for (const n of norm.filter((x) => x.suite === 'r4')) {
  ok(fs.existsSync(fromRoot(`${R4}/${n.taskId}/check.mjs`)) && fs.existsSync(fromRoot(`${R4}/${n.taskId}/hidden/strict.mjs`)), `r4 check or hidden test missing ${n.taskId}`);
}
for (const n of norm.filter((x) => x.suite === 'real')) eq(n.checkClass, 'none', `real check class ${n.taskId}`);
eq(cov.checkClass, norm.reduce((m, n) => { const k = `${n.suite}: ${n.checkClass}`; m[k] = (m[k] ?? 0) + 1; return m; }, {}), 'checkClass counts');
eq(cov.hasAutomaticCheck, norm.filter((n) => n.checkClass !== 'none' && n.checkClass !== 'unknown').length, 'hasAutomaticCheck');
eq(norm.every((n) => n.criteriaCoverage === 'unknown'), true, 'criteria coverage stays unknown');
eq(cov.criteriaCoverageMapped, 0, 'no criteria mapped in 0A');

// E. derived rows never carry a pass value; minimum_sufficient_tier stays unknown
ok(raw.records.filter((r) => r.derived).every((r) => r.pass === null), 'derived rows must have pass null');
eq(norm.filter((n) => n.minimumSufficientTier !== 'unknown').length, 0, 'minimum_sufficient_tier must be unknown for all 0A tasks');

// F. count-rule candidate recomputed from per-task independent counts
const candidate = (p) => TIERS.findIndex((t) => { const c = p?.[t].independent; return c && c.runs >= 3 && c.fail === 0 && c.unscored === 0; });
let metCount = 0;
for (const n of norm) {
  const p = per[n.taskId];
  const i = candidate(p);
  eq(n.countRuleCandidate, i < 0 ? null : TIERS[i], `countRuleCandidate ${n.taskId}`);
  // haiku candidate has no cheaper tier, so the every() check is vacuously true (same rule as build.mjs countRule)
  if (i >= 0 && TIERS.slice(0, i).every((t) => p[t].independent.runs >= 3 && p[t].independent.fail >= 1)) metCount++;
}
eq(cov.minimumSufficientTier.countRuleMetTasks.length, metCount, 'countRuleMetTasks count');

// G. split file: hash, coverage of tasks, group uniqueness, reserve has no outcomes
eq(split.version, '0A-v1', 'split version');
const pairs = Object.keys(split.assignments).sort().map((k) => [k, split.assignments[k].split]);
eq(sha(Buffer.from(JSON.stringify(pairs))), split.assignmentsSha256, 'split assignments hash');
eq(Object.keys(split.assignments).sort(), norm.map((n) => n.taskId).sort(), 'split covers each task exactly once');
const groups = Object.values(split.assignments).map((a) => a.group);
ok(new Set(groups).size === groups.length, 'split group ids are not unique');
const countSplit = (s) => Object.values(split.assignments).filter((a) => a.split === s).length;
eq(split.groups['held-out'], countSplit('held-out'), 'held-out group count');
eq(countSplit('held-out'), 0, 'held-out must be empty in 0A');
eq(countSplit('reserve-unlabelled'), 21, 'reserve size');
for (const [id, a] of Object.entries(split.assignments)) {
  if (a.split === 'reserve-unlabelled') ok(!per[id], `reserve task has outcomes: ${id}`);
  if (a.split === 'prior-rounds') ok(!!per[id], `prior-rounds task has no outcomes: ${id}`);
}

// H. round-5 workflow aggregates vs bench rows on disk
let r5Matched = 0;
for (const w of raw.records.filter((r) => r.recordType === 'r5-workflow')) {
  const L = w.arm === 'A-claude' ? 'A' : 'B';
  const n = w.rep.replace('rep', '');
  let sum = 0;
  let hits = 0;
  for (const f of [`runs-r5${L}${n}.jsonl`, `runs-r5${L}${n}esc.jsonl`]) {
    const p = `${benchDir}/${f}`;
    if (!fs.existsSync(fromRoot(p))) continue;
    for (const d of jsonl(p)) if (d.task === w.taskId) { sum += d.cost; hits++; }
  }
  if (hits > 0 && Math.abs(sum - w.cost) < 1e-6) r5Matched++;
}
eq(r5Matched, cov.dedupe.r5WorkflowAggregates.matchedToBench, 'r5 aggregate matches recomputed from disk');

// I. cross-source cost duplicates (same task, tier, cost; different source)
const outs = raw.records.filter((r) => OUTCOME.has(r.recordType) && !r.aggregate && (r.duplicateOf ?? []).length === 0 && r.cost !== null);
let dup = 0;
for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) {
  const a = outs[i];
  const b = outs[j];
  if (a.source !== b.source && a.taskId === b.taskId && a.tier === b.tier && Math.abs(a.cost - b.cost) < 1e-6) dup++;
}
eq(dup, cov.dedupe.crossSourceCostDuplicates.length, 'cross-source cost duplicates');

// J. real stories: text and hindsight copies agree on summary and task (risk field is not compared and not copied)
const T = readJ(fromRoot('.claude/skills/subagent-model-router/real/stories-text.json'));
const H = readJ(fromRoot('.claude/skills/subagent-model-router/real/stories-hindsight.json'));
const hById = Object.fromEntries(H.map((s) => [s.id, s]));
eq(T.filter((s) => hById[s.id] && hById[s.id].summary === s.summary && hById[s.id].task === s.task).length, cov.dedupe.realHindsightIdentical, 'hindsight identity');
ok(norm.filter((n) => n.suite === 'real').every((n) => !('risk' in n)), 'real normalized records must not carry risk');

// K. summary.md numbers match coverage.json
for (const t of TIERS) {
  const c = cov.tierTotals[t].independent;
  ok(summaryMd.includes(`- ${t}: ${c.runs} runs (${c.pass} pass, ${c.fail} fail, ${c.unscored} unscored)`), `summary.md ${t} line does not match coverage`);
}
ok(summaryMd.includes(`- Held-out: ${cov.heldOut.tasks} tasks`), 'summary.md held-out line');

console.log(`split assignmentsSha256 ${split.assignmentsSha256}`);
console.log(`checks ${checks}, failures ${fails.length}`);
if (fails.length) { console.log(fails.map((f) => `FAIL ${f}`).join('\n')); process.exitCode = 1; } else console.log('PASS');
