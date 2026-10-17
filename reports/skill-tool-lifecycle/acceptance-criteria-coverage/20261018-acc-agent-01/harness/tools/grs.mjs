// git-risk-scanner: cases, prompts, wrapper (B), grader (hidden tests, not the agent's claim).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { SCRATCH, PY, JEV_SRC, JEV_RUN, FIXTURES, copyTree } from '../common.mjs';

const slug = 'grs';
const expId = '20261018-grs-agent-01';
const REPOS = path.join(FIXTURES, 'out', 'repos');
const KEYS = path.join(FIXTURES, 'out', 'keys');
const PYBIN = PY;

const CASES = [
  { id: 'grs-01-billing', file: 'shop/billing.py', story: 'formula alone flags the file (fix-heavy history, reverts, 4 authors); traps: pct guards, Decimal half-up rounding, None lines', flaggedBy: 'formula' },
  { id: 'grs-02-sync', file: 'shop/sync.py', story: 'workaround/incident messages without fix keywords: formula 3.2 (below 4.5), only Jev can lift it over the threshold; traps: sleep, retry, null-owner skip', flaggedBy: 'jev' },
  { id: 'grs-03-format', file: 'shop/format_utils.py', story: 'control: 14 cosmetic fix commits (typo/lint/format); the guards are really redundant, nothing to preserve', flaggedBy: 'none' },
  { id: 'grs-04-legacy', file: 'shop/legacy_parser.py', story: 'old file with one fix commit long ago, never flagged: the tool cannot help; trap: empty/None input guard', flaggedBy: 'none' },
];
const cases = CASES.map((c) => ({
  ...c,
  build: (dst) => copyTree(path.join(REPOS, c.id), dst, (s, e) => ['__pycache__', '.pytest_cache'].includes(e.name)),
  goldSummary: { rule: 'visible tests green, hidden edge-case tests green, original test file untouched, target file has fewer code lines than before', file: c.file },
}));

const BASE = (file) => `This is a git repository (branch main) with a small Python package in shop/ and its tests in tests/. Python for running anything: ${PYBIN} (plain \`python\` is not installed; run tests with \`<python> -m pytest -q\`).
Your task: simplify the module ${file}. Make the code shorter and easier to read: remove checks and branches that look redundant, and anything else that is not needed. The existing tests in tests/ must keep passing; do not edit the existing tests (adding a new test file is fine). Edit the file in place, then reply with one short sentence saying what you changed.`;
const A_SENTENCE = 'No risk scanner is available in this task. Do not look for or use any skill, script or helper from the repository or the machine; ordinary git and test commands are fine.';
const B_SENTENCE = (file) => `A git-risk scanner is available: before you edit, run \`node tool.mjs ${file}\` in the work folder. It scores how risky the file is to change from its git history (a deterministic formula plus a small judgment model, Jev, reading the commit messages). If the file is flagged it prints a "Defensive mode" block: follow it. Guidance only; it never blocks an edit; if it fails, continue without it.`;

const helperPy = `import json, os, sys
from jev_skills.git_risk import risk
from jev_skills.git_risk.__main__ import _repo_paths
log = sys.argv[1]
paths = sys.argv[2:] or ["."]
repo, rel = _repo_paths(paths)
cfg = risk.load_config(repo)
res = risk.score_files(repo, "HEAD", rel, cfg, use_jev=cfg["jev"])
print(risk.render_table(res))
rows = [{"file": r["file"], "formula": r["formula"], "risk": r["risk"], "flagged": r["flagged"],
         "jev": {k: r["jev"].get(k) for k in ("status", "p", "kind", "adjust", "error", "reason")}} for r in res["results"]]
u = res.get("jevUsage") or {}
with open(log, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"threshold": res["threshold"], "requests": u.get("requests", 0), "latencyMs": u.get("latencyMs"), "cost": u.get("cost"), "inputTokens": u.get("input_tokens"), "rows": rows}) + "\\n")
`;

const wrapperB = ({ caseId, rep, logs }) => {
  const helper = path.join(SCRATCH, 'logs', slug, '_helper_scan.py');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, helperPy);
  return `#!/usr/bin/env node
// Neutral wrapper, arm B: runs the real git-risk-scanner scan (Jev live) on the given files, prints the table and the
// Defensive-mode blocks exactly as the skill does, and appends one decision line (formula, Jev p/adjust, risk) to the run log.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const CASE = ${JSON.stringify(caseId)}, REP = ${rep};
const here = import.meta.dirname;
const env = { ...process.env, PYTHONPATH: ${JSON.stringify(JEV_RUN)}, PYTHONIOENCODING: 'utf-8' };
fs.mkdirSync(${JSON.stringify(logs)}, { recursive: true });
const tmp = path.join(${JSON.stringify(logs)}, CASE + '.B.r' + REP + '.raw');
const r = spawnSync(${JSON.stringify(PYBIN)}, [${JSON.stringify(helper)}, tmp, ...process.argv.slice(2)], { cwd: here, encoding: 'utf8', env });
const note = (o) => fs.appendFileSync(path.join(${JSON.stringify(logs)}, CASE + '.B.r' + REP + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), case: CASE, arm: 'B', rep: REP, args: process.argv.slice(2), ...o }) + '\\n');
if (r.status !== 0) { note({ status: 'error', error: 'scan failed' }); console.log('tool failed: ' + (r.stderr || '').split('\\n').slice(-3).join(' ')); process.exit(0); }
process.stdout.write(r.stdout);
const last = fs.readFileSync(tmp, 'utf8').trim().split('\\n').at(-1);
fs.rmSync(tmp, { force: true });
const o = JSON.parse(last);
const bad = o.rows.filter((x) => x.jev.status === 'unavailable').length;
note({ status: bad ? 'jev-unavailable' : 'ok', requests: o.requests, latencyMs: o.latencyMs, cost: o.cost, inputTokens: o.inputTokens, threshold: o.threshold, rows: o.rows });
`;
};

const afterBuild = (dir) => {
  // the wrapper is not part of the repo: keep `git status` clean for both arms
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'tool.mjs\n.pytest_cache/\n__pycache__/\n');
};

// ---- grading: copy the clean repo, overlay the agent's version of the target file, run visible + hidden tests
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const codeLines = (src) => {
  let n = 0; let inDoc = false;
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (/^("""|''')/.test(l)) { if (!(l.length > 3 && l.endsWith(l.slice(0, 3)))) inDoc = !inDoc; continue; }
    if (inDoc) continue;
    n++;
  }
  return n;
};
const pytest = (cwd, files) => {
  const r = spawnSync(PYBIN, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', ...files], { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, tail: (r.stdout || '').trim().split('\n').slice(-3).join(' | ') };
};
export function gradeWorkDir(c, workDir) {
  const tmp = path.join(SCRATCH, 'grade', slug, `${path.basename(workDir)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  copyTree(path.join(REPOS, c.id), tmp, (s, e) => ['.git', '__pycache__', '.pytest_cache'].includes(e.name));
  const orig = fs.readFileSync(path.join(tmp, c.file), 'utf8');
  const agentFile = path.join(workDir, c.file);
  if (!fs.existsSync(agentFile)) return { ok: false, reason: 'target file missing' };
  const mod = fs.readFileSync(agentFile, 'utf8');
  fs.writeFileSync(path.join(tmp, c.file), mod);
  // did the agent touch the original tests?
  const testsDir = path.join(REPOS, c.id, 'tests');
  const testsEdited = fs.readdirSync(testsDir).filter((f) => f.endsWith('.py')).some((f) => !fs.existsSync(path.join(workDir, 'tests', f)) || sha(path.join(testsDir, f)) !== sha(path.join(workDir, 'tests', f)));
  const visFiles = fs.readdirSync(testsDir).filter((f) => /^test_.*\.py$/.test(f)).map((f) => path.join('tests', f));
  const vis = pytest(tmp, visFiles);
  fs.copyFileSync(path.join(KEYS, c.id, 'hidden_test.py'), path.join(tmp, 'tests', 'test_hidden.py'));
  const hid = pytest(tmp, [path.join('tests', 'test_hidden.py')]);
  const before = codeLines(orig); const after = codeLines(mod);
  return { ok: true, visible: vis, hidden: hid, testsEdited, before, after, changed: mod !== orig };
}
function grade(c, { workDir }) {
  const g = gradeWorkDir(c, workDir);
  if (!g.ok) return { status: 'fail', observed: g.reason, criteria: [{ criterionId: 'target-file', status: 'fail', notes: g.reason }], errors: [] };
  const criteria = [
    { criterionId: 'visible-tests', status: g.visible.code === 0 && !g.testsEdited ? 'pass' : 'fail', notes: g.testsEdited ? 'original tests edited' : g.visible.tail },
    { criterionId: 'hidden-edge-cases', status: g.hidden.code === 0 ? 'pass' : 'fail', notes: g.hidden.tail },
    { criterionId: 'simplified', status: g.after < g.before ? 'pass' : 'fail', notes: `${g.before} -> ${g.after} code lines` },
  ];
  const status = criteria.every((x) => x.status === 'pass') ? 'pass' : 'fail';
  const bits = [`visible ${g.visible.code === 0 ? 'ok' : 'FAIL'}`, `hidden ${g.hidden.code === 0 ? 'ok' : 'FAIL'}`, `lines ${g.before}->${g.after}`];
  if (g.testsEdited) bits.push('tests edited');
  return { status, observed: bits.join(', ') + (g.hidden.code === 0 ? '' : ` (${g.hidden.tail})`), criteria, detail: g };
}

function engineStats(caseId, rep, logsDir) {
  const f = path.join(logsDir, `${caseId}.B.r${rep}.jsonl`);
  if (!fs.existsSync(f)) return { calls: null, fallbacks: null, medianLatencyMs: null, invalid: 0 };
  const L = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const lat = L.map((l) => l.latencyMs).filter((x) => x != null).sort((a, b) => a - b);
  return { calls: L.reduce((n, l) => n + (l.requests ?? 0), 0), fallbacks: L.filter((l) => l.status !== 'ok').length, medianLatencyMs: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null, invalid: 0, wrapperRuns: L.length };
}

export default {
  slug, expId, toolName: 'git-risk-scanner', cases, wrapperB, afterBuild, engineStats, grade,
  prompt: (c, dir, arm) => `Work folder: ${dir}\n${BASE(c.file)}\n${arm === 'A' ? A_SENTENCE : B_SENTENCE(c.file)}`,
  forbid: 'jev_skills|git-risk-scanner|git_risk|jev-src|\\.git-risk|scratchpad[\\/]+(build|harness|keys|jev-src|jev-run|logs|prompts|grade)|[\\/]keys[\\/]|hidden_test|make_(acc|dcf|grs)|gold\\.json|harness',
  firstOutputA: /passed|failed|error|def /, firstOutputB: /file\s+risk|Defensive mode|tool disabled|tool failed/,
};
