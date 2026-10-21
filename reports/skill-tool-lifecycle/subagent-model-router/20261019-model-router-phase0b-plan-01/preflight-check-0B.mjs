// Read-only offline preflight for Phase 0B. Writes nothing, makes no model call, and prints counts only.
// Held-out ids are read to count matches; they are never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const text = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8').replace(/\r\n/g, '\n');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const shaFile = (rel) => sha(text(rel));
const json = (rel) => JSON.parse(text(rel));

let failed = 0;
let total = 0;
const check = (name, ok, detail = '') => {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

const lock = json('run-0B-lock.json');

// 1. Every hash in the run lock
const lockRows = Object.entries(lock.files);
const lockBad = lockRows.filter(([f, h]) => shaFile(f) !== h).length;
check('run lock hashes', lockBad === 0, `${lockRows.length} files, ${lockBad} differ`);

// 2. Rubric lock table (14 evaluable rubrics + W-19279 pilot rubric)
const rubricRows = [...text('rubric-lock-0B.md').matchAll(/\| (W-\d+)(?: \(pilot-exposed\))? \| (\S+) \| ([0-9a-f]{64}) \|/g)];
const rubricBad = rubricRows.filter(([, , f, h]) => shaFile(f) !== h).length;
check('rubric lock table hashes', rubricRows.length === 15 && rubricBad === 0, `${rubricRows.length} rows, ${rubricBad} differ`);

// 3. Split: assignments hash by the 0A pairs method, and membership by the 0B-v1 rule
const split = json('split-0B.json');
const A = split.assignments;
const ids = Object.keys(A).sort();
const pairsSha = sha(JSON.stringify(ids.map((id) => [id, A[id].split])));
check('split hash (0A pairs method)', pairsSha === split.assignmentsSha256 && pairsSha === lock.split.recordedAssignmentsSha256, `${ids.length} stories`);

const ruleOf = (id) => (parseInt(sha(`0B-v1|${id}`).slice(0, 8), 16) < 0x55555555 ? 'held-out' : 'calibration');
const ruleMismatch = ids.filter((id) => ruleOf(id) !== A[id].split).length;
check('split membership by 0B-v1 rule', ruleMismatch === 0, `${ids.length - ruleMismatch} of ${ids.length} match`);

const calIds = ids.filter((id) => A[id].split === 'calibration');
const heldOut = ids.filter((id) => A[id].split === 'held-out');
const calFile = json('calibration-stories-0B.json');
const calFileIds = calFile.map((s) => s.id);
const calSame = calFileIds.length === calIds.length && calFileIds.every((id) => calIds.includes(id));
check('calibration file matches split', calSame && ids.length === 21 && calIds.length === 15 && heldOut.length === 6, `${ids.length} stories: ${calIds.length} calibration, ${heldOut.length} held-out`);

// 4. Story status
const status = json('story-status-0B.json').stories;
const count = (st) => status.filter((s) => s.status === st).length;
check('story status 13 / 1 / 1', count('evaluable') === 13 && count('not_evaluable') === 1 && count('pilot_exposed') === 1, `evaluable ${count('evaluable')}, not_evaluable ${count('not_evaluable')}, pilot_exposed ${count('pilot_exposed')}`);
check('status ids match calibration file', status.map((s) => s.id).sort().join() === [...calFileIds].sort().join());
const notEval = status.find((s) => s.status === 'not_evaluable');
const neTask = calFile.find((s) => s.id === notEval.id).task;
const neSearch = json('story-status-0B.json').w19358Search;
check('not_evaluable record matches stored visible text', sha(neTask) === neSearch.visibleTextSha256 && neTask.length === neSearch.visibleTextChars, `${neTask.length} characters`);

// 5. Call count and repeat universe
const runnable = calFileIds.length - count('not_evaluable');
const calls = { generation: runnable * 3, grading: runnable * 3, repeat: 9 };
const callTotal = calls.generation + calls.grading + calls.repeat;
check('call count', callTotal === 93 && lock.counts.calls.total === callTotal && lock.counts.calls.generation === calls.generation && lock.counts.calls.grading === calls.grading && lock.counts.calls.repeat === calls.repeat, `${calls.generation} generation, ${calls.grading} grading, ${calls.repeat} repeat = ${callTotal}`);
check('repeat universe is 39', count('evaluable') * 3 === 39 && lock.counts.repeatUniverse === 39, `${count('evaluable')} evaluable stories x 3 tiers`);

// 6. Baseline ledger against its source
const ledger = json('baseline-ledger-0B.json');
const ledgerSum = ledger.entries.reduce((n, e) => n + e.total_cost_usd, 0);
const sumOk = Math.abs(ledgerSum - ledger.total_usd) < 1e-9;
const srcOk = ledger.entries.every((e) => {
  const costs = [...text(e.source).matchAll(/"total_cost_usd"\s*:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  return shaFile(e.source) === e.source_sha256 && costs.length > 0 && costs.every((c) => c === e.total_cost_usd);
});
check('baseline ledger vs source', sumOk && srcOk && lock.baseline.totalUsd === ledger.total_usd, `${ledger.entries.length} entry, starting spend ${ledger.total_usd} USD`);

// 7. Runner parameters match the lock (same extraction as make-run-0B-lock.mjs)
const src = text('run-0B.mjs');
const num = (name) => Number(src.match(new RegExp(`const ${name} = ([\\d.]+);`))[1]);
const cap = Object.fromEntries([...src.match(/const CAP = \{([^}]*)\}/)[1].matchAll(/(\w+): ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
const params = {
  STOP: num('STOP'),
  CEILING: num('CEILING'),
  CAP: cap,
  REGRADE_N: num('REGRADE_N'),
  REGRADE_THRESHOLD: num('REGRADE_THRESHOLD'),
  SEED_REGRADE: src.match(/const SEED_REGRADE = '([^']+)'/)[1],
  CLAUDE_BIN: src.match(/const CLAUDE_BIN = '([^']+)'/)[1],
  PREFIX_ARGS: src.match(/const PREFIX_ARGS = (\[[^\]]*\])/)[1],
  POK: src.match(/const POK = '([^']+)'/)[1],
};
check('runner parameters match lock', JSON.stringify(params) === JSON.stringify(lock.params) && params.STOP === 12 && params.CEILING === 15, `stop ${params.STOP}, runner stop ${params.CEILING}, caps haiku ${cap.haiku} sonnet ${cap.sonnet} opus ${cap.opus} grader ${cap.grader}`);

// 8. The folder holds no 0B output
const top = fs.readdirSync(HERE, { withFileTypes: true }).map((d) => d.name);
const outputName = /^(results|jev|candidates?|grades?|grading|outputs?|summary\.json|e3-flags\.md)$/i;
const outputs = top.filter((n) => outputName.test(n));
check('no 0B output in folder', outputs.length === 0 && !fs.existsSync(path.join(HERE, 'results')), `${top.length} top-level entries; output-like: ${outputs.length}`);

// 9. Held-out ids: prompt-bearing inputs (as in the lock), then text files at top level, rubrics/ and pilot/ (counts only)
const promptInputs = ['calibration-stories-0B.json', 'pilot/brief.txt', 'grader-prompt-0B.txt', 'pilot/rubric-W-19279.md', ...calIds.filter((id) => id !== 'W-19279').map((id) => `rubrics/rubric-${id}.md`)];
const promptHits = promptInputs.reduce((n, f) => n + heldOut.filter((id) => text(f).includes(id)).length, 0);
check('held-out ids in prompt inputs', promptHits === 0 && lock.heldOutCheck.promptInputsChecked === promptInputs.length, `${promptInputs.length} inputs, ${promptHits} matches`);

const scanFiles = ['', 'rubrics', 'pilot'].flatMap((d) => fs.readdirSync(path.join(HERE, d), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.posix.join(d, e.name)))
  .filter((f) => f !== 'split-0B.json' && /\.(md|json|txt|mjs|js|csv)$/i.test(f));
const scanHits = scanFiles.reduce((n, f) => n + heldOut.filter((id) => text(f).includes(id)).length, 0);
check('held-out ids in folder text files', scanHits === 0, `${scanFiles.length} text files scanned; ${scanHits} matches (split-0B.json excluded: it lists the split)`);

// 10. Human review hashes, budget and lock status text
const reviewRows = [...text('rubric-human-review.md').matchAll(/Rubric: `(rubrics\/rubric-W-\d+\.md)`, sha256 `([0-9a-f]{64})`/g)];
check('human review hashes match files', reviewRows.length === 7 && reviewRows.every(([, f, h]) => shaFile(f) === h), `${reviewRows.length} stories`);

const budget = text('budget-sheet-0B.md');
check('budget v4 states 93 calls and is not approved', budget.includes('v4') && budget.includes('**93**') && budget.includes('not approved yet'));
check('run lock records waiting for user OK', text('run-0B-lock.md').includes("Waiting for the user's explicit OK"));

console.log(`\n${total - failed} of ${total} checks passed. No model call, no network, no writes.`);
process.exitCode = failed ? 1 : 0;
