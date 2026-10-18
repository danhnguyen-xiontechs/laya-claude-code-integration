// acceptance-criteria-coverage: cases, prompts, wrapper (B), grader.
import fs from 'node:fs';
import path from 'node:path';
import { SCRATCH, PY, JEV_SRC, JEV_RUN, FIXTURES, copyTree } from '../common.mjs';

const slug = 'acc';
const expId = '20261018-acc-agent-01';
const OWN = path.join(FIXTURES, 'out3', 'repos');
const KEYS = path.join(FIXTURES, 'out3', 'keys');
const DEMO = path.join(JEV_SRC, 'examples', 'ac_coverage_demo');
const PYBIN = PY;

// accepted verdicts per criterion (the answer key: kept in scratch, never copied into a work folder)
const DEMO_GOLD = { 'AC-01': ['Covered'], 'AC-02': ['Partial'], 'AC-03a': ['Covered'], 'AC-03b': ['Covered'], 'AC-04': ['Missing', 'Unclear'], 'AC-05': ['Missing'], 'AC-06': ['Covered'] };
const ownGold = (id) => JSON.parse(fs.readFileSync(path.join(KEYS, `${id}.json`), 'utf8'));

const demoBuild = (dst) => copyTree(DEMO, dst, (s, e) => ['run', '__pycache__', '.pytest_cache', '.tool-output'].includes(e.name) || e.name === 'gold.json');
const ownBuild = (id) => (dst) => copyTree(path.join(OWN, id), dst, (s, e) => ['__pycache__', '.pytest_cache'].includes(e.name));

const cases = [
  { id: 'acc-01-registration', build: demoBuild, gold: DEMO_GOLD, note: "the demo of the JEV repo (in-sample: Jev's authors tuned on it)" },
  { id: 'acc-02-cart', build: ownBuild('acc-02-cart'), gold: ownGold('acc-02-cart') },
  { id: 'acc-03-uploads', build: ownBuild('acc-03-uploads'), gold: ownGold('acc-03-uploads') },
  { id: 'acc-04-booking', build: ownBuild('acc-04-booking'), gold: ownGold('acc-04-booking') },
].map((c) => ({ ...c, goldSummary: Object.fromEntries(Object.entries(c.gold).map(([k, v]) => [k, v.join('|')])) }));

const BASE = `A story's acceptance criteria are in criteria.json; the code is in the package folder next to it and the tests are in tests/ (pytest). Python for running anything: ${PYBIN} (plain \`python\` is not installed).
Your task: for every criterion decide how well the existing tests cover it, using only what the tests actually assert:
- Covered: tests directly assert every condition the criterion states.
- Partial: a test exercises the criterion's scenario but some condition it states is not asserted.
- Missing: no test exercises the scenario (a test whose name suggests the criterion but whose assertions check something else does not count).
- Unclear: you cannot tell.
Judge what the tests assert, not whether they currently pass (execution status is not part of the verdict). Do not change any project file. You may run the tests. Hand back one JSON object with one entry per criterion id, {"AC-01": {"coverage": "Covered|Partial|Missing|Unclear", "tests": ["tests/test_x.py::test_name"], "gap": "one short sentence, or empty"}, ...}, and nothing else.`;
const A_SENTENCE = 'No acceptance-criteria coverage tool is available in this task: decide yourself from the tests. Do not look for or use any skill, script or helper from the repository or the machine.';
const B_SENTENCE = 'An acceptance-criteria coverage tool is available: run `node tool.mjs` in the work folder (it takes no arguments). It finds candidate tests for every criterion and a small judgment model (Jev) labels each (criterion, test) pair direct_coverage / partial_coverage / name_only / unrelated / insufficient_evidence, marking a pair `skippable` when it is very sure the test is unrelated. The labels are suggestions only: read the tests yourself and decide; never mark Covered because of a label alone; if the tool fails, continue without it.';

const wrapperB = ({ caseId, rep, logs }) => `#!/usr/bin/env node
// Neutral wrapper, arm B: runs the real acceptance-criteria-coverage steps 4 and 5 (candidates, then classify with Jev
// live) on this folder and prints a digest of pack.json + results.json; appends one decision line to the run log.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CASE = ${JSON.stringify(caseId)}, REP = ${rep};
const here = import.meta.dirname;
const env = { ...process.env, PYTHONPATH: ${JSON.stringify(JEV_RUN)}, PYTHONIOENCODING: 'utf-8' };
const run = (a) => spawnSync(${JSON.stringify(PYBIN)}, ['-m', 'jev_skills.ac_coverage', ...a], { cwd: here, encoding: 'utf8', env });
const dir = path.join(here, '.tool-output', 'ac');
fs.mkdirSync(dir, { recursive: true });
const pack = path.join(dir, 'pack.json'), res = path.join(dir, 'results.json');
const log = (o) => { fs.mkdirSync(${JSON.stringify(logs)}, { recursive: true }); fs.appendFileSync(path.join(${JSON.stringify(logs)}, CASE + '.B.r' + REP + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), case: CASE, arm: 'B', rep: REP, ...o }) + '\\n'); };
const r1 = run(['candidates', '--criteria', 'criteria.json', '--tests', 'tests', '-o', pack]);
if (r1.status !== 0) { log({ status: 'error', error: 'candidates failed' }); console.log('tool failed (candidates): ' + (r1.stderr || '').split('\\n').slice(-3).join(' ')); process.exit(0); }
const r2 = run(['classify', '--pack', pack, '-o', res]);
if (r2.status !== 0) { log({ status: 'error', error: 'classify failed' }); console.log('tool failed (classify): ' + (r2.stderr || '').split('\\n').slice(-3).join(' ')); process.exit(0); }
const P = JSON.parse(fs.readFileSync(pack, 'utf8')), R = JSON.parse(fs.readFileSync(res, 'utf8'));
const byKey = Object.fromEntries(R.pairs.map((p) => [p.criterion + '|' + p.tid, p]));
const out = ['Acceptance-criteria coverage: candidate tests per criterion with Jev labels (suggestions only, read the tests yourself).', r1.stdout.trim(), r2.stdout.trim(), 'Files: .tool-output/ac/pack.json (test code), .tool-output/ac/results.json', ''];
for (const c of P.criteria) {
  out.push(c.id + ': ' + c.text);
  if (c.no_candidates) out.push('  no test shares a meaningful word with this criterion (grep for other names before calling it Missing)');
  for (const cand of c.candidates) {
    const t = P.tests[cand.tid], p = byKey[c.id + '|' + cand.tid] ?? {};
    out.push('  ' + cand.nodeid + '  (' + t.file + ':' + t.line + ')  jev=' + (p.label ?? 'none') + (p.p != null ? ' p=' + p.p.toFixed(2) : '') + (p.skippable ? '  skippable' : ''));
  }
}
console.log(out.join('\\n'));
log({
  status: R.status, error: R.error, requests: R.usage.requests, latencyMs: R.usage.latencyMs, cost: R.usage.cost, inputTokens: R.usage.input_tokens,
  pairs: R.pairs.length, labelled: R.pairs.filter((p) => p.label).length, skippable: R.skippableCount,
  labels: R.pairs.map((p) => ({ criterion: p.criterion, test: p.nodeid, label: p.label, p: p.p == null ? null : +p.p.toFixed(3), skippable: p.skippable })),
});
`;

function findAnswer(text) {
  if (!text) return null;
  for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    for (let j = text.lastIndexOf('}'); j > i; j = text.lastIndexOf('}', j - 1)) {
      try {
        const o = JSON.parse(text.slice(i, j + 1));
        if (o && typeof o === 'object' && Object.keys(o).some((k) => /^AC-/.test(k))) return o;
      } catch { /* not this span */ }
    }
  }
  return null;
}

function grade(c, { answer }) {
  const ans = findAnswer(answer);
  if (!ans) return { status: 'error', observed: 'no parseable answer with AC-* entries', criteria: [], errors: ['no parseable answer'] };
  const criteria = []; const bits = []; let falseCovered = 0; let right = 0;
  for (const [id, ok] of Object.entries(c.gold)) {
    const got0 = ans[id]?.coverage ?? null;
    const got = typeof got0 === 'string' ? ({ covered: 'Covered', partial: 'Partial', missing: 'Missing', unclear: 'Unclear' })[got0.trim().toLowerCase()] ?? got0 : got0;
    const pass = got != null && ok.includes(got);
    if (pass) right++;
    if (got === 'Covered' && !ok.includes('Covered')) falseCovered++;
    criteria.push({ criterionId: id, status: pass ? 'pass' : 'fail', notes: pass ? `${got}` : `answered ${got ?? 'nothing'}, gold ${ok.join('|')}` });
    bits.push(pass ? `${id} ${got}` : `${id} ${got ?? '-'} (gold ${ok.join('|')})`);
  }
  const n = Object.keys(c.gold).length;
  const status = right === n ? 'pass' : 'fail';
  return { status, observed: `${right}/${n} criteria right${falseCovered ? `, ${falseCovered} false Covered` : ''}: ${bits.join('; ')}`, criteria, right, n, falseCovered };
}

function engineStats(caseId, rep, logsDir) {
  const f = path.join(logsDir, `${caseId}.B.r${rep}.jsonl`);
  if (!fs.existsSync(f)) return { calls: null, fallbacks: null, medianLatencyMs: null, invalid: 0 };
  const L = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lat = L.map((l) => l.latencyMs).filter((x) => x != null).sort((a, b) => a - b);
  return {
    calls: L.reduce((n, l) => n + (l.requests ?? 0), 0), fallbacks: L.filter((l) => l.status !== 'ok').length,
    medianLatencyMs: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null, invalid: L.reduce((n, l) => n + ((l.pairs ?? 0) - (l.labelled ?? 0)), 0),
    wrapperRuns: L.length,
  };
}

export default {
  slug, expId, toolName: 'acceptance-criteria-coverage', cases, wrapperB, engineStats, grade,
  prompt: (c, dir, arm) => `Work folder: ${dir}\n${BASE}\n${arm === 'A' ? A_SENTENCE : B_SENTENCE}`,
  forbid: 'jev_skills|acceptance-criteria-coverage|ac_coverage|jev-src|scratchpad[\\/]+(build|harness|keys|jev-src|jev-run|logs|prompts|grade)|[\\/]keys[\\/]|hidden_test|make_(acc|dcf|grs)|gold\.json|harness',
  firstOutputA: /AC-0\d/, firstOutputB: /Acceptance-criteria coverage|tool disabled|tool failed/,
};
