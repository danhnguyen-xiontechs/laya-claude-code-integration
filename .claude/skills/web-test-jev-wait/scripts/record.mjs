// Record one step's outcome in results.json, in one call, right after the step — so the report never
// shows steps as not-run that were actually executed (seen on 19358: notes said pass, results.json said not-run).
// Usage: node record.mjs <runDir> <caseId> <stepN> <pass|fail|blocked|skipped> --actual "<what the page showed>"
//          [--shot shots/TC01-S01.png] [--notes "<text>"]
// Prints one line: recorded TC01-S1=pass case=TC01:pass remaining-not-run=N
import fs from 'node:fs';
import path from 'node:path';

const [runDir, caseId, stepN, status, ...rest] = process.argv.slice(2);
const STATUSES = ['pass', 'fail', 'blocked', 'skipped'];
if (!runDir || !caseId || !stepN || !STATUSES.includes(status)) {
  console.error(`Usage: node record.mjs <runDir> <caseId> <stepN> <${STATUSES.join('|')}> --actual "<text>" [--shot <file>] [--notes <text>]`);
  process.exit(2);
}
const opt = (name) => { const i = rest.indexOf(name); return i === -1 ? undefined : rest[i + 1]; };

const file = path.join(runDir, 'results.json');
const results = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const c = (results.cases || []).find((x) => x.id === caseId);
if (!c) { console.error(`no case ${caseId} in ${file}`); process.exit(2); }
const s = (c.steps || []).find((x) => String(x.n) === String(stepN));
if (!s) { console.error(`no step ${stepN} in ${caseId}`); process.exit(2); }

s.status = status;
if (opt('--actual') !== undefined) s.actual = opt('--actual');
if (opt('--shot') !== undefined) s.screenshot = opt('--shot');
if (opt('--notes') !== undefined) s.notes = opt('--notes');
s.at ??= new Date().toISOString();
if (!s.actual) console.error(`warning: ${caseId}-S${stepN} has no actual`);

const RANK = { fail: 4, blocked: 3, skipped: 2, 'not-run': 1, pass: 0 };
c.status = c.steps.map((x) => x.status ?? 'not-run').reduce((w, v) => ((RANK[v] ?? 1) > (RANK[w] ?? 1) ? v : w), 'pass');
fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');

const left = results.cases.flatMap((x) => x.steps || []).filter((x) => (x.status ?? 'not-run') === 'not-run').length;
console.log(`recorded ${caseId}-S${stepN}=${status} case=${caseId}:${c.status} remaining-not-run=${left}`);
