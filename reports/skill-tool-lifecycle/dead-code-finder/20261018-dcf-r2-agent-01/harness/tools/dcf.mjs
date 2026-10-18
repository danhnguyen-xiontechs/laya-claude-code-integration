// dead-code-finder: cases, prompts, wrapper (B), grader.
import fs from 'node:fs';
import path from 'node:path';
import { SCRATCH, PY, JEV_SRC, JEV_RUN, FIXTURES, copyTree } from '../common.mjs';

const slug = 'dcf';
const expId = '20261018-dcf-agent-01';
const OWN = path.join(FIXTURES, 'out2', 'repos');
const KEYS = path.join(FIXTURES, 'out2', 'keys');
const DEMO = path.join(JEV_SRC, 'examples', 'dead_code_demo');
const PYBIN = PY;

// ---- gold: items {id, class: dead|decoy|neutral, file, match}; match = identifier (symbol mode) or text (line mode), '|' = alternatives
const demoGold = () => {
  const g = JSON.parse(fs.readFileSync(path.join(DEMO, 'gold.json'), 'utf8'));
  const cls = { dead: 'dead', 'alive-decoy': 'decoy', 'test-only': 'decoy', 'junk-debug': 'dead', 'junk-comment-code': 'dead', 'junk-intentional-output': 'decoy', 'junk-comment-example': 'decoy', 'junk-comment-disabled': 'decoy', 'junk-dead-branch': 'neutral' };
  return g.items.map((i) => ({ id: i.id, class: cls[i.class], file: i.file, match: i.symbol ?? i.match }));
};
// neutral additions found while hand-reviewing the unlisted items of the agent answers: `sys` in pluglib/compat.py is only used by the dead PY2
const EXTRA_NEUTRAL = { 'dcf-03-pluglib': [{ id: 'N5', class: 'neutral', file: 'pluglib/compat.py', match: 'sys' }] };
const ownGold = (id) => [...JSON.parse(fs.readFileSync(path.join(KEYS, `${id}.json`), 'utf8')), ...(EXTRA_NEUTRAL[id] ?? [])];
// the demo's own gold labels the module as 'demo_pkg.legacy_report'; the agent will name the file, so the module item matches on the file name
// neutral (transitively dead, found while hand-reviewing the unlisted items of the first agent answers): `json` in core.py is only used by the dead OldOrderAdapter; `compute_total` in legacy_report.py only by the dead monthly_report
// J09/J10 are multi-line commented-out blocks: the demo key names one line of each, agents list the lines separately, so every line of the block is accepted (grader granularity, applied to both arms; found when the first answers came back)
const BLOCK = { J09: 'subtotal += price|subtotal = 0|for name, price in order.items', J10: '_ROUTES.clear()|print(_ROUTES)' };
const fixDemo = (items) => [...items.map((i) => (i.id === 'D11' ? { ...i, match: 'legacy_report' } : BLOCK[i.id] ? { ...i, match: BLOCK[i.id] } : i)),
  { id: 'N3', class: 'neutral', file: 'demo_pkg/core.py', match: 'old implementation, replaced by' },
  { id: 'N1', class: 'neutral', file: 'demo_pkg/core.py', match: 'json' },
  { id: 'N2', class: 'neutral', file: 'demo_pkg/legacy_report.py', match: 'compute_total' }];

const demoBuild = (dst) => {
  copyTree(DEMO, dst, (s, e) => ['run', '__pycache__', '.pytest_cache', '.dead-code'].includes(e.name) || e.name === 'gold.json' || e.name === '.dead-code.json');
  // the demo's .dead-code.json only excluded run/ and gold.json, which are not in this copy
};
const ownBuild = (id) => (dst) => copyTree(path.join(OWN, id), dst, (s, e) => ['__pycache__', '.pytest_cache', '.dead-code'].includes(e.name));

const cases = [
  { id: 'dcf-01-demo', build: demoBuild, gold: fixDemo(demoGold()), note: "the demo of the JEV repo (in-sample: Jev's authors tuned on it)" },
  { id: 'dcf-02-ordersapi', build: ownBuild('dcf-02-ordersapi'), gold: ownGold('dcf-02-ordersapi') },
  { id: 'dcf-03-pluglib', build: ownBuild('dcf-03-pluglib'), gold: ownGold('dcf-03-pluglib') },
  { id: 'dcf-04-shopapp', build: ownBuild('dcf-04-shopapp'), gold: ownGold('dcf-04-shopapp') },
].map((c) => {
  const dead = c.gold.filter((g) => g.class === 'dead').length;
  return { ...c, goldSummary: { dead, decoys: c.gold.filter((g) => g.class === 'decoy').length, rule: 'no wrong item (decoy or unlisted) and at least 75% of the dead items' } };
});

const BASE = `This is a small Python project (tests in tests/). Python for running anything: ${PYBIN} (plain \`python\` is not installed).
Your task: find the code that can safely be deleted: unused functions, classes, methods, constants, imports, commented-out code and leftover debug prints. Be careful: code that looks unused but is reached indirectly (registered by a decorator or a base class, found by name or string, referenced from config or an entry point, an override, public API, used by tests) must NOT be deleted, and deliberate program output is not a debug leftover.
Public API means names exported in __all__ or declared as entry points. Do not change any project file. Hand back one JSON object {"delete": [{"file": "relative/path.py", "what": "symbol name (Class.method for methods), or the exact commented-out / debug line"}]} listing only items you are confident can go, and nothing else.`;
const A_SENTENCE = 'No dead-code tool is available in this task: decide yourself from the code. Do not look for or use any skill, script or helper from the repository or the machine.';
const B_SENTENCE = 'A dead-code scanner is available: run `node tool.mjs` in the work folder (it takes no arguments). It reads the whole project with static rules (decorators, strings, config, entry points, overrides, public API) and a small judgment model (Jev) ranks what is left into tiers (A = very likely dead, B = needs a look, C = kept) and prints its report. The tiers are suggestions only; the tool never deletes anything; if it fails, continue without it.';

const wrapperB = ({ caseId, rep, logs }) => `#!/usr/bin/env node
// Neutral wrapper, arm B: runs the real dead-code-finder scan (Jev live) on this folder, prints the report.md the skill says
// to read, and appends one decision line (tiers, Jev cost/latency, per-candidate tier with and without Jev) to the run log.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CASE = ${JSON.stringify(caseId)}, REP = ${rep};
const here = import.meta.dirname;
const env = { ...process.env, PYTHONPATH: ${JSON.stringify(JEV_RUN)}, PYTHONIOENCODING: 'utf-8' };
const out = path.join(here, '.dead-code', 'run');
const log = (o) => { fs.mkdirSync(${JSON.stringify(logs)}, { recursive: true }); fs.appendFileSync(path.join(${JSON.stringify(logs)}, CASE + '.B.r' + REP + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), case: CASE, arm: 'B', rep: REP, ...o }) + '\\n'); };
const r = spawnSync(${JSON.stringify(PYBIN)}, ['-m', 'jev_skills.dead_code', 'scan', '.', '-o', out], { cwd: here, encoding: 'utf8', env });
if (r.status !== 0) { log({ status: 'error', error: 'scan failed' }); console.log('tool failed: ' + (r.stderr || '').split('\\n').slice(-3).join(' ')); process.exit(0); }
const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
console.log((r.stdout || '').trim().replace(/[A-Za-z]:\\\\[^ ]*[\\\\/]/g, '') + '\\n\\n' + report);
const cands = fs.readFileSync(path.join(out, 'candidates.jsonl'), 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l));
const answered = cands.filter((c) => c.jev && c.jev.status === 'ok').length;
const m = /JEV (\\d+) sent, \\$([0-9.]+), (\\d+) ms/.exec(r.stdout || '');
log({
  status: !m || +m[1] === 0 ? 'rules-only' : answered > 0 ? 'ok' : 'jev-unavailable', sent: m ? +m[1] : 0, answered, cost: m ? +m[2] : null, latencyMs: m ? +m[3] : null, requests: +((/JEV: (\\d+) request/.exec(report) || [])[1] || 0),
  tiers: { A: cands.filter((c) => c.tier === 'A').length, B: cands.filter((c) => c.tier === 'B').length, C: cands.filter((c) => c.tier === 'C').length },
  changedByJev: cands.filter((c) => c.tier_no_jev !== c.tier).length,
  candidates: cands.map((c) => ({ id: c.id, file: c.file, symbol: c.symbol ?? null, kind: c.kind, tierNoJev: c.tier_no_jev, tier: c.tier, jev: c.jev?.label ?? null, p: c.jev?.p ?? null, jevStatus: c.jev?.status ?? null })),
});
fs.copyFileSync(path.join(out, 'report.md'), path.join(${JSON.stringify(logs)}, CASE + '.B.r' + REP + '.report.md'));
`;

// ---- grading
const norm = (s) => String(s ?? '').trim();
const normFile = (f, workDir) => norm(f).replaceAll('\\', '/').replace(workDir.replaceAll('\\', '/'), '').replace(/^\.?\/+/, '');
const stripKw = (w) => norm(w).replace(/^`+|`+$/g, '').replace(/^(def|class|import|from)\s+/i, '').replace(/\s*=\s*$/, '').trim();
const isIdent = (s) => /^[\w.]+$/.test(s);
// an answer entry that names a symbol (as opposed to quoting a line of code): `name`, `a.b`, `name()`, `def f(args)`, `class C(Base)`
const entryIdent = (what) => {
  const w = norm(what).replace(/^`+|`+$/g, '');
  const m = /^(?:(?:def|class)\s+)?([\w.]+)(?:\(\))?:?$/.exec(w) ?? /^(?:def|class)\s+([\w.]+)\(.*\):?$/.exec(w) ?? /^import\s+([\w.]+)$/.exec(w);
  return m ? m[1] : null;
};
const lastPart = (s) => s.split('.').at(-1).toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function sameFile(item, entry, workDir) {
  const file = normFile(entry.file, workDir);
  return file === item.file || file.endsWith('/' + item.file) || item.file.endsWith('/' + file);
}
function hits(item, entry, workDir) {
  if (!sameFile(item, entry, workDir)) return false;
  const what = norm(entry.what).replace(/^`+|`+$/g, '');
  const ei = entryIdent(what);
  return item.match.split('|').some((m) => {
    const gi = stripKw(m);
    if (isIdent(gi)) {                                   // the key names a symbol
      if (ei) return lastPart(ei) === lastPart(gi);
      return new RegExp(`(?<!\\w)${esc(gi)}(?!\\w)`, 'i').test(what);   // the answer quotes a line: whole-word match
    }
    return what.toLowerCase().includes(m.toLowerCase());  // the key is a line of text
  });
}
function findAnswer(text) {
  if (!text) return null;
  for (let i = text.lastIndexOf('{'); i >= 0; i = text.lastIndexOf('{', i - 1)) {
    for (let j = text.lastIndexOf('}'); j > i; j = text.lastIndexOf('}', j - 1)) {
      try { const o = JSON.parse(text.slice(i, j + 1)); if (Array.isArray(o?.delete)) return o; } catch { /* next */ }
    }
  }
  return null;
}
export function gradeAnswer(c, answer, workDir) {
  const ans = findAnswer(answer);
  if (!ans) return null;
  const dead = c.gold.filter((g) => g.class === 'dead');
  const found = new Set(); const decoyHits = []; const neutral = []; const unlisted = [];
  for (const e of ans.delete) {
    if (!e || typeof e !== 'object') continue;
    let matched = false;
    for (const g of c.gold) {
      if (!hits(g, e, workDir)) continue;
      matched = true;
      if (g.class === 'dead') found.add(g.id); else if (g.class === 'decoy') decoyHits.push(g.id); else neutral.push(g.id);
    }
    if (!matched) {
      const ei = entryIdent(norm(e.what));
      const owner = ei && ei.includes('.') ? ei.split('.').slice(0, -1).join('.') : null;   // Class.method of a class that is itself dead
      if (owner && c.gold.some((g) => g.class !== 'decoy' && sameFile(g, e, workDir) && isIdent(stripKw(g.match.split('|')[0])) && lastPart(stripKw(g.match.split('|')[0])) === lastPart(owner))) { neutral.push('member:' + ei); matched = true; }
    }
    if (!matched) unlisted.push(`${normFile(e.file, workDir)}:${norm(e.what)}`.slice(0, 80));
  }
  const need = Math.ceil(0.75 * dead.length);
  const wrong = decoyHits.length + unlisted.length;
  return { listed: ans.delete.length, deadFound: found.size, deadTotal: dead.length, need, decoyHits, neutral, unlisted, wrong, missed: dead.filter((g) => !found.has(g.id)).map((g) => g.id) };
}
function grade(c, { answer, workDir }) {
  const g = gradeAnswer(c, answer, workDir);
  if (!g) return { status: 'error', observed: 'no parseable answer with a delete array', criteria: [], errors: ['no parseable answer'] };
  const criteria = [
    { criterionId: 'no-wrong-deletion', status: g.wrong === 0 ? 'pass' : 'fail', notes: g.wrong === 0 ? '' : `decoys: ${g.decoyHits.join(',') || '-'}; unlisted: ${g.unlisted.join('; ') || '-'}` },
    { criterionId: 'recall-75', status: g.deadFound >= g.need ? 'pass' : 'fail', notes: `${g.deadFound}/${g.deadTotal} dead items found (need ${g.need}); missed ${g.missed.join(',') || '-'}` },
  ];
  const status = criteria.every((x) => x.status === 'pass') ? 'pass' : 'fail';
  return { status, observed: `${g.deadFound}/${g.deadTotal} dead found, ${g.decoyHits.length} decoy(s) listed${g.decoyHits.length ? ' (' + g.decoyHits.join(',') + ')' : ''}, ${g.unlisted.length} unlisted wrong${g.unlisted.length ? ' (' + g.unlisted.join('; ') + ')' : ''}, ${g.neutral.length} neutral; missed ${g.missed.join(',') || '-'}`, criteria, detail: g };
}

function engineStats(caseId, rep, logsDir) {
  const f = path.join(logsDir, `${caseId}.B.r${rep}.jsonl`);
  if (!fs.existsSync(f)) return { calls: null, fallbacks: null, medianLatencyMs: null, invalid: 0 };
  const L = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lat = L.map((l) => l.latencyMs).filter((x) => x != null).sort((a, b) => a - b);
  return { calls: L.reduce((n, l) => n + (l.requests ?? 0), 0), fallbacks: L.filter((l) => l.status !== 'ok').length, medianLatencyMs: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null, invalid: L.reduce((n, l) => n + Math.max(0, (l.sent ?? 0) - (l.answered ?? 0)), 0), wrapperRuns: L.length };
}

export default {
  slug, expId, toolName: 'dead-code-finder', cases, wrapperB, engineStats, grade,
  prompt: (c, dir, arm) => `Work folder: ${dir}\n${BASE}\n${arm === 'A' ? A_SENTENCE : B_SENTENCE}`,
  forbid: 'jev_skills|dead-code-finder|dead_code|jev-src|\\.dead-code|scratchpad[\\/]+(build|harness|keys|jev-src|jev-run|logs|prompts|grade)|[\\/]keys[\\/]|hidden_test|make_(acc|dcf|grs)|gold\\.json|harness',
  // B: the report's own heading (the wrapper's source also contains the words 'tool failed', so a plain word match picked the source)
  firstOutputA: /def |class |import /, firstOutputB: /^# Dead code report/m,
};
