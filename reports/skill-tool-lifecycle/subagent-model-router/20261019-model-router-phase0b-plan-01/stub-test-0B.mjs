// Stub test for run-0B.mjs. No model call, no spend. Each scenario is a copy of the locked runner in a scratch folder,
// with only the CLI binary pointed at node.exe + stub-cli-0B.mjs, plus the scenario's own changes (listed in the log).
// The locked runner and lock are not modified. Synthetic held-out id "HELD-TEST-001" is used; no real held-out id is read or printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\claude\\D--XionTechs-Laya\\2530e343-4a7e-42ba-8f20-545234f2d355\\scratchpad\\stub-0B';
const STUB = path.join(HERE, 'stub-cli-0B.mjs');
const SYNTH = 'HELD-TEST-001';
const ZERO_SHA = '0'.repeat(64);

const lock = JSON.parse(fs.readFileSync(path.join(HERE, 'run-0B-lock.json'), 'utf8'));
const sha = (buf) => crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');

// Locked runner must match the lock before any copy is made.
const lockedRunner = fs.readFileSync(path.join(HERE, 'run-0B.mjs'));
if (sha(lockedRunner) !== lock.files['run-0B.mjs']) throw new Error('locked runner does not match lock');

const inputs = Object.keys(lock.files).filter((f) => f !== 'run-0B.mjs');
const LOCKED_BIN = lock.params.CLAUDE_BIN;
const SPENT_OK = 0.0775562 + 93 * 0.01; // baseline + 93 stub calls at 0.01

function patch(src, from, to, diffs) {
  if (src.split(from).length !== 2) throw new Error(`patch target not found once: ${from}`);
  diffs.push(`\`${from}\` → \`${to}\``);
  return src.replace(from, to);
}

function build(name, { edits = {}, runner = [], remove = [] } = {}) {
  const dir = path.join(SCRATCH, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const kept = inputs.filter((f) => !remove.includes(f));
  const bytes = {};
  for (const f of kept) {
    const src = fs.readFileSync(path.join(HERE, f));
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    bytes[f] = edits[f] ? edits[f](src.toString('utf8')) : src.toString('utf8');
    fs.writeFileSync(path.join(dir, f), bytes[f], 'utf8');
  }
  const diffs = [];
  if (remove.length) diffs.push(`removed from copy and lock: ${remove.map((f) => `\`${f}\``).join(', ')}`);
  let src = lockedRunner.toString('utf8');
  src = patch(src, `const CLAUDE_BIN = '${LOCKED_BIN}';`, `const CLAUDE_BIN = ${JSON.stringify(process.execPath)};`, diffs);
  src = patch(src, 'const PREFIX_ARGS = [];', `const PREFIX_ARGS = [${JSON.stringify(STUB)}];`, diffs);
  for (const [from, to] of runner) src = patch(src, from, to, diffs);
  fs.writeFileSync(path.join(dir, 'run-0B.mjs'), src, 'utf8');
  const files = Object.fromEntries(kept.map((f) => [f, sha(Buffer.from(bytes[f]))]));
  files['run-0B.mjs'] = sha(Buffer.from(src));
  fs.writeFileSync(path.join(dir, 'run-0B-lock.json'), JSON.stringify({ version: 'stub-copy', files }, null, 2));
  return { dir, diffs };
}

function run(name, opts, env) {
  const { dir, diffs } = build(name, opts);
  const logPath = path.join(dir, 'stub-calls.jsonl');
  const res = spawnSync(process.execPath, [path.join(dir, 'run-0B.mjs')], {
    env: { ...process.env, STUB_LOG: logPath, ...env },
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  // The runner writes status.json, calls.json and summary.json under results/.
  const read = (f) => (fs.existsSync(path.join(dir, 'results', f)) ? JSON.parse(fs.readFileSync(path.join(dir, 'results', f), 'utf8')) : null);
  const status = read('status.json');
  const calls = read('calls.json') ?? [];
  const stubCalls = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const summary = read('summary.json');
  return { name, dir, diffs, exit: res.status, stderr: (res.stderr || '').trim().split('\n')[0] || '', status, calls, stubCalls, summary };
}

fs.mkdirSync(SCRATCH, { recursive: true });
const runs = [];

// 1. ok: full run through 93 stub calls (42 generations, 42 gradings, 9 repeat), answers include an E3-style phrase,
// first criterion quote is not in the answer.
runs.push({
  ...run('ok', {}, { STUB_MODE: 'ok', STUB_COST: '0.01' }),
  expect: { status: 'complete', calls: 93, stub: 93 },
  extra: (r) => {
    const s = r.summary;
    const bad = [];
    if (!s) return ['no summary.json'];
    if (s.repeatAgreement !== '9 of 9') bad.push(`repeatAgreement ${s.repeatAgreement}`);
    if (s.gradings !== 42 || s.repeatGradings !== 9) bad.push(`gradings ${s.gradings}/${s.repeatGradings}`);
    if (s.notEvaluable !== 1 || s.runnable !== 14) bad.push(`notEvaluable ${s.notEvaluable} runnable ${s.runnable}`);
    if (!(s.e3FlagHits > 0)) bad.push('no E3 flag hits written');
    if (!(s.quoteMismatches > 0)) bad.push('quote mismatch not detected');
    if (!fs.existsSync(path.join(r.dir, 'results', 'blind-sample', 'sample-09.md'))) bad.push('blind-sample count < 9');
    if (fs.existsSync(path.join(r.dir, 'results', 'blind-sample', 'sample-10.md'))) bad.push('blind-sample count > 9');
    const blind = fs.readFileSync(path.join(r.dir, 'results', 'blind-sample', 'sample-01.md'), 'utf8');
    if (/\b(haiku|sonnet|opus)\b/i.test(blind.split('## Task')[0])) bad.push('tier name in blind sample header');
    if (!/Answer label: [ABC]\n/.test(blind)) bad.push('no answer label in blind sample');
    if (r.stubCalls.some((c) => !(c.args.includes('--tools') && c.args[c.args.indexOf('--tools') + 1] === ''))) bad.push('--tools "" missing in a call');
    if (r.stubCalls.some((c) => !c.args.includes('--max-budget-usd') || !c.args.includes('--no-session-persistence'))) bad.push('budget/session flag missing');
    if (Math.abs(s.spentUsd - SPENT_OK) > 1e-6) bad.push(`spent ${s.spentUsd}, expected ${SPENT_OK}`);
    return bad;
  },
});

// 2. error: first call exits non-zero.
runs.push({ ...run('error', {}, { STUB_MODE: 'error' }), expect: { status: 'incomplete', reason: 'call-error', calls: 1, stub: 1 } });

// 3. empty: first generation returns an empty result.
runs.push({ ...run('empty', {}, { STUB_MODE: 'empty' }), expect: { status: 'incomplete', reason: 'empty', calls: 1, stub: 1 } });

// 4. overcap: first generation charged 0.5 against a 0.10 cap.
runs.push({ ...run('overcap', {}, { STUB_MODE: 'overcap', STUB_COST: '0.01' }), expect: { status: 'incomplete', reason: 'over-cap', calls: 1, stub: 1 } });

// 5. reserve: stop lowered to 0.20 in the copy, calls cost 0.05. Order per story is haiku, sonnet, opus.
// Start 0.0776 (baseline). Call 1 (haiku, cap 0.10): 0.0776 + 0.10 <= 0.20, runs; spent 0.1276.
// Call 2 (sonnet, cap 0.40): 0.1276 + 0.40 > 0.20, refused before spawn.
runs.push({
  ...run('reserve', { runner: [['const STOP = 12;', 'const STOP = 0.2;']] }, { STUB_MODE: 'ok', STUB_COST: '0.05' }),
  expect: { status: 'incomplete', reason: 'reserve', calls: 1, stub: 1 },
});

// 6. baseline-applied: stop 0.50, calls cost 0.05. The baseline 0.0776 is counted, so call 2 (sonnet, cap 0.40)
// is refused: 0.1276 + 0.40 > 0.50. Expect 1 stub call and spent 0.1276.
runs.push({
  ...run('baseline-applied', { runner: [['const STOP = 12;', 'const STOP = 0.5;']] }, { STUB_MODE: 'ok', STUB_COST: '0.05' }),
  expect: { status: 'incomplete', reason: 'reserve', calls: 1, stub: 1 },
  extra: (r) => (Math.abs(r.status?.spentUsd - (0.0775562 + 0.05)) > 1e-6 ? [`spent ${r.status?.spentUsd}, expected ${0.0775562 + 0.05}`] : []),
});

// 7. baseline-ignored (control): same as 6 but the runner starts from 0. Call 2 then fits (0.05 + 0.40 <= 0.50),
// and call 3 (opus, cap 0.60) is refused. Expect 2 stub calls. Shows that the baseline is what changes the outcome in 6.
runs.push({
  ...run('baseline-ignored', { runner: [['const STOP = 12;', 'const STOP = 0.5;'], ['state.spent = state.baseline;', 'state.spent = 0;']] }, { STUB_MODE: 'ok', STUB_COST: '0.05' }),
  expect: { status: 'incomplete', reason: 'reserve', calls: 2, stub: 2 },
});

// 8. baseline-missing: ledger removed from the copy and from its lock. Fails closed: 0 calls.
runs.push({
  ...run('baseline-missing', { remove: ['baseline-ledger-0B.json'] }, { STUB_MODE: 'ok' }),
  expect: { status: 'incomplete', reason: 'baseline-missing', calls: 0, stub: 0 },
});

// 9. baseline-mismatch by sha: the ledger's source_sha256 is wrong. Fails closed: 0 calls.
runs.push({
  ...run('baseline-mismatch-sha', {
    edits: {
      'baseline-ledger-0B.json': (t) => {
        const o = JSON.parse(t);
        o.entries[0].source_sha256 = ZERO_SHA;
        return JSON.stringify(o, null, 2);
      },
    },
  }, { STUB_MODE: 'ok' }),
  expect: { status: 'incomplete', reason: 'baseline-mismatch', calls: 0, stub: 0 },
});

// 10. baseline-mismatch by total: total_usd is not the sum of the entries. Fails closed: 0 calls.
runs.push({
  ...run('baseline-mismatch-total', {
    edits: {
      'baseline-ledger-0B.json': (t) => {
        const o = JSON.parse(t);
        o.total_usd = 0.5;
        return JSON.stringify(o, null, 2);
      },
    },
  }, { STUB_MODE: 'ok' }),
  expect: { status: 'incomplete', reason: 'baseline-mismatch', calls: 0, stub: 0 },
});

// 11. missing-cost: the first generation returns no total_cost_usd. It is charged at its cap (0.10), not at 0.
// Spent = baseline 0.0775562 + 0.10 + 92 x 0.01 = 1.0975562. calls.json first record: chargedUsd 0.1, costUsd null.
runs.push({
  ...run('missing-cost', {}, { STUB_MODE: 'nocost', STUB_COST: '0.01' }),
  expect: { status: 'complete', calls: 93, stub: 93 },
  extra: (r) => {
    const bad = [];
    const first = r.calls[0];
    if (!first) return ['no calls.json record'];
    if (first.chargedUsd !== 0.1) bad.push(`first chargedUsd ${first.chargedUsd}`);
    if (first.costUsd !== null) bad.push(`first costUsd ${first.costUsd}`);
    const want = 0.0775562 + 0.1 + 92 * 0.01;
    if (Math.abs(r.status?.spentUsd - want) > 1e-6) bad.push(`spent ${r.status?.spentUsd}, expected ${want}`);
    return bad;
  },
});

// 12. heldout-story: synthetic id added to the copy's split and to one calibration story's task. 0 calls.
runs.push({
  ...run('heldout-story', {
    edits: {
      'split-0B.json': (t) => {
        const o = JSON.parse(t);
        o.assignments[SYNTH] = { split: 'held-out', group: 'test', groupBasis: 'test' };
        return JSON.stringify(o, null, 2);
      },
      'calibration-stories-0B.json': (t) => {
        const o = JSON.parse(t);
        o[0].task = o[0].task + ' ' + SYNTH;
        return JSON.stringify(o, null, 2);
      },
    },
  }, { STUB_MODE: 'ok' }),
  expect: { status: 'incomplete', reason: 'held-out-id', calls: 0, stub: 0 },
});

// 13. heldout-brief: synthetic id added to the generation brief (the case the stories check does not catch). 0 calls.
runs.push({
  ...run('heldout-brief', {
    edits: {
      'split-0B.json': (t) => {
        const o = JSON.parse(t);
        o.assignments[SYNTH] = { split: 'held-out', group: 'test', groupBasis: 'test' };
        return JSON.stringify(o, null, 2);
      },
      'pilot/brief.txt': (t) => t.replace('<<TASK>>', `<<TASK>> ${SYNTH}`),
    },
  }, { STUB_MODE: 'ok' }),
  expect: { status: 'incomplete', reason: 'held-out-id', calls: 0, stub: 0 },
});

// 14. not-evaluable-skip: W-19358 makes no call. Its label and raw files must be absent from the run.
runs.push({
  ...run('not-evaluable-skip', {}, { STUB_MODE: 'ok', STUB_COST: '0.01' }),
  expect: { status: 'complete', calls: 93, stub: 93 },
  extra: (r) => {
    const bad = [];
    if (r.calls.some((c) => c.label.includes('W-19358'))) bad.push('a call label names W-19358');
    if (fs.existsSync(path.join(r.dir, 'results', 'raw')) && fs.readdirSync(path.join(r.dir, 'results', 'raw')).some((f) => f.includes('W-19358'))) bad.push('a raw file names W-19358');
    if (r.summary?.notEvaluable !== 1) bad.push(`notEvaluable ${r.summary?.notEvaluable}`);
    if (r.summary?.runnable !== 14) bad.push(`runnable ${r.summary?.runnable}`);
    return bad;
  },
});

// 15. badgrade: grader returns non-JSON on its first call. Expect 42 generations + the first grading, then the halt.
runs.push({ ...run('badgrade', {}, { STUB_MODE: 'badgrade' }), expect: { status: 'incomplete', reason: 'grader-malformed', calls: 43, stub: 43 } });

const rows = [];
let allOk = true;
for (const r of runs) {
  const problems = [];
  if (!r.status) problems.push('no status.json');
  else {
    if (r.status.status !== r.expect.status) problems.push(`status ${r.status.status}`);
    if (r.expect.reason && r.status.reason !== r.expect.reason) problems.push(`reason ${r.status.reason}`);
  }
  if (r.calls.length !== r.expect.calls) problems.push(`calls.json ${r.calls.length}`);
  if (r.stubCalls.length !== r.expect.stub) problems.push(`stub calls ${r.stubCalls.length}`);
  if (r.extra) problems.push(...r.extra(r));
  const ok = problems.length === 0;
  allOk = allOk && ok;
  rows.push({ name: r.name, ok, problems, status: r.status, calls: r.calls.length, stub: r.stubCalls.length, spent: r.status?.spentUsd ?? null, diffs: r.diffs, exit: r.exit, stderr: r.stderr });
}

const md = `# Stub test, Phase 0B runner

Run: ${new Date().toISOString().slice(0, 10)}. No model call and no spend: \`stub-cli-0B.mjs\` stands in for claude.exe (\`node.exe\` + stub). Scratch copies: \`${SCRATCH}\`.
Locked runner \`run-0B.mjs\` and \`run-0B-lock.json\` were not modified. Each copy has its own regenerated lock for its inputs.
Synthetic held-out id \`${SYNTH}\` is used in the held-out scenarios. No real held-out id is read or printed.

## Result: ${allOk ? 'all scenarios pass' : 'FAILURES, see below'}

| Scenario | Expected | Actual status | Reason | Stub calls | Spent (USD) | Result |
|---|---|---|---|---|---|---|
${runs.map((r, i) => {
  const row = rows[i];
  const exp = `${r.expect.status}${r.expect.reason ? ' / ' + r.expect.reason : ''}, ${r.expect.stub} calls`;
  return `| ${r.name} | ${exp} | ${row.status?.status ?? 'none'} | ${row.status?.reason ?? '-'} | ${row.stub} | ${row.spent ?? '-'} | ${row.ok ? 'pass' : 'FAIL: ' + row.problems.join('; ')} |`;
}).join('\n')}

## Changes from the locked runner, per scenario
Every copy changes the CLI binary (to node.exe with the stub) and the PREFIX_ARGS line. Nothing else changes unless listed.
${rows.map((r) => `- **${r.name}**: ${r.diffs.join('; ')}`).join('\n')}
Input edits: heldout-story adds \`${SYNTH}\` to split-0B.json and to the first calibration story's task; heldout-brief adds it to split-0B.json and to pilot/brief.txt; baseline-mismatch-sha sets the ledger's source_sha256 to 64 zeros; baseline-mismatch-total sets total_usd to 0.5. Stub modes: ok (cost 0.01; one E3-style phrase; first R quote not in answer), nocost (as ok, first generation has no cost), error, empty, overcap, badgrade.

## Checks in the ok scenario
- Repeat agreement 9 of 9, gradings 42 and repeat 9, notEvaluable 1 and runnable 14, E3 flag hits, quote-mismatch count, blind-sample count (9), no quoted tier name and an answer label in each blind sample, \`--tools ''\`, budget and no-session flags present on every stub call, spent = 0.0775562 + 93 × 0.01 = ${SPENT_OK.toFixed(7)}.

## Notes
- The \`overcap\` scenario is a copy whose stub charges 0.5 on the first generation; the runner halts after recording the call.
- The \`reserve\` scenario refuses call 2 (sonnet, cap 0.40) before any spawn; the stub log shows 1 call.
- \`baseline-applied\` and its control \`baseline-ignored\` differ only in whether the baseline is counted: 1 call vs 2 calls. That is the evidence the baseline changes the reserve outcome.
- \`baseline-missing\` and both \`baseline-mismatch\` scenarios halt before the first call, so they show 0 calls.
- \`not-evaluable-skip\` checks the labels and raw file names for W-19358: none may appear.
- Scratch output stays in the scratchpad folder, not in this project.
`;
fs.writeFileSync(path.join(HERE, 'stub-test-0B.md'), md, 'utf8');
fs.writeFileSync(path.join(HERE, 'stub-test-0B.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(rows.map((r) => `${r.name}: ${r.ok ? 'pass' : 'FAIL ' + r.problems.join('; ')}`).join('\n'));
console.log(allOk ? 'ALL PASS' : 'FAILURES');
