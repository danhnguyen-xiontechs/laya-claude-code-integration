// Writes run-0B-lock.json (machine-checked by run-0B.mjs preflight) and run-0B-lock.md (human record).
// Hashes are sha256 of LF-normalised text. Held-out ids are read only to count matches; they are never printed or written.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, rel), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const text = (rel) => fs.readFileSync(path.join(HERE, rel), 'utf8').replace(/\r\n/g, '\n');

const split = JSON.parse(text('split-0B.json'));
const heldOut = Object.keys(split.assignments).filter((id) => split.assignments[id].split === 'held-out');
const calIds = JSON.parse(text('calibration-stories-0B.json')).map((s) => s.id);
const rubricFiles = calIds.filter((id) => id !== 'W-19279').map((id) => `rubrics/rubric-${id}.md`);
const statusFile = JSON.parse(text('story-status-0B.json'));
const statusOf = Object.fromEntries(statusFile.stories.map((s) => [s.id, s.status]));
const countOf = (st) => statusFile.stories.filter((s) => s.status === st).length;
const evaluableN = countOf('evaluable');
const notEvaluableN = countOf('not_evaluable');
const pilotN = countOf('pilot_exposed');
if (evaluableN !== 13 || notEvaluableN !== 1 || pilotN !== 1) throw new Error('story-status-0B.json counts differ from 13 / 1 / 1');
const runnable = calIds.length - notEvaluableN;
const calls = { generation: runnable * 3, grading: runnable * 3, repeat: 9 };
calls.total = calls.generation + calls.grading + calls.repeat;
const files = [
  'calibration-stories-0B.json',
  'split-0B.json',
  'mapping-0B.json',
  'pilot/brief.txt',
  'grader-prompt-0B.txt',
  'pilot/rubric-W-19279.md',
  ...rubricFiles,
  'rubric-lock-0B.md',
  'story-status-0B.json',
  'baseline-ledger-0B.json',
  'rubrics/second-read-raw.json',
  'run-0B.mjs',
];
const hashes = Object.fromEntries(files.map((f) => [f, sha(f)]));

// Held-out check: count matches in every prompt-bearing input. No ids printed.
const promptInputs = ['calibration-stories-0B.json', 'pilot/brief.txt', 'grader-prompt-0B.txt', 'pilot/rubric-W-19279.md', ...rubricFiles];
const heldOutHits = promptInputs.reduce((n, f) => n + heldOut.filter((id) => text(f).includes(id)).length, 0);

// Runner parameters, read from the runner source so the lock cannot drift from the code.
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

const lock = {
  version: '0B-run-v1',
  lockedAt: new Date().toISOString(),
  split: { file: 'split-0B.json', version: split.version, recordedAssignmentsSha256: split.assignmentsSha256, note: 'Reproduced by the 0A pairs method (sha256 of JSON.stringify of id-sorted [id, split] pairs); membership 21 of 21 by the 0B-v1 rule. File not edited.' },
  counts: { calibrationStories: calIds.length, evaluableCalibration: evaluableN, pilotExposed: pilotN, notEvaluable: notEvaluableN, heldOutIdsCounted: heldOut.length, calls, repeatUniverse: evaluableN * 3 },
  storyStatus: statusOf,
  baseline: { file: 'baseline-ledger-0B.json', totalUsd: JSON.parse(text('baseline-ledger-0B.json')).total_usd, countedBeforeFirstCall: true },
  heldOutCheck: { promptInputsChecked: promptInputs.length, matches: heldOutHits, result: heldOutHits === 0 ? 'pass' : 'FAIL' },
  params,
  files: hashes,
};
if (heldOutHits !== 0) throw new Error('held-out check failed: lock not written');

fs.writeFileSync(path.join(HERE, 'run-0B-lock.json'), JSON.stringify(lock, null, 2) + '\n', 'utf8');

const rows = files.map((f) => `| ${f} | ${hashes[f]} |`).join('\n');
const md = `# Run lock, Phase 0B (calibration)

Locked: ${lock.lockedAt.slice(0, 10)}. Machine-checked copy: \`run-0B-lock.json\`. Hash: sha256 of LF-normalised text.
Status: **locked. No candidate, JEV or grading call has been made. Waiting for the user's explicit OK on this lock and on budget v4.**

## Stories
- Calibration: ${calIds.length} stories. Evaluable: ${evaluableN}. Pilot-exposed: ${pilotN} (\`${params.POK}\`, provenance only). Not evaluable: ${notEvaluableN} (\`W-19358\`: full text not recoverable locally; no call is made for it). Per-story status in \`story-status-0B.json\`.
- Held-out: not used (see below).

## Parameters (read from \`run-0B.mjs\`)
- Stop (reserve check, USD): ${params.STOP}. No call is made when spent + the next call's cap is above this.
- Runner stop (USD): ${params.CEILING}. **A runner stop, not a billing ceiling.** One call can exceed its cap, so spend can pass this by one overrun. Halts the run when passed.
- Starting spend (USD): ${lock.baseline.totalUsd}, the rubric-helper call in \`baseline-ledger-0B.json\`, counted before the first call. If the ledger is missing or does not match its source, the run halts with no call.
- Per-call caps (USD): haiku ${cap.haiku}, sonnet ${cap.sonnet}, opus ${cap.opus}, grader ${cap.grader}.
- Repeat grading: ${params.REGRADE_N} of ${evaluableN * 3} evaluable outputs (${evaluableN} stories x 3 tiers), seed \`${params.SEED_REGRADE}\`. Threshold ${params.REGRADE_THRESHOLD} of ${params.REGRADE_N} agree on overall.
- Calls: sequential, no retry, no parallel. Generation ${calls.generation}, grading ${calls.grading}, repeat grading ${calls.repeat}, total ${calls.total}. No JEV.
- CLI: \`${params.CLAUDE_BIN}\` (PREFIX_ARGS ${params.PREFIX_ARGS}).

## Held-out check
- Held-out ids in split: ${heldOut.length}. Prompt-bearing inputs checked: ${promptInputs.length}. Matches: ${heldOutHits}. **Result: ${heldOutHits === 0 ? 'pass' : 'FAIL'}.** No ids are printed or stored.
- Held-out text is not used. Held-out evaluation needs separate approval.

## Split check (resolved, no change to the split)
- \`split-0B.json\` records assignmentsSha256 \`${split.assignmentsSha256}\`. It is reproduced by the 0A pairs method (sha256 of \`JSON.stringify\` of the id-sorted \`[id, split]\` pairs). Membership matches the \`0B-v1\` rule for 21 of 21 stories. The split file has not been edited and its version stays \`${split.version}\`.
- An earlier note said no serialisation reproduced the hash. That was wrong and is corrected here.
- W-19358 is recorded as \`not_evaluable\` (see Stories above and \`story-status-0B.json\`). No candidate, JEV or grading call is made for it.

## Inputs and runner (sha256)
| File | sha256 |
|---|---|
${rows}

## Other records
- Stub test: \`stub-test-0B.md\` and \`stub-test-0B.json\`. Run on scratch copies with a stub CLI (no model call, no spend). The copies do not modify this lock or the runner.
- Budget: \`budget-sheet-0B.md\` is v4. It supersedes v3, which was never approved (kept as \`superseded/budget-sheet-0B-v3-unapproved.md\`).
- Rubrics: second read and adjudication in \`rubric-drafting-calls-0B.md\`. W-19279 was not second-read (deviation logged there).
- Human review of the rubrics: \`rubric-human-review.md\` (no rubric changes made).
`;
fs.writeFileSync(path.join(HERE, 'run-0B-lock.md'), md, 'utf8');
console.log(`lock written: ${files.length} files; held-out matches: ${heldOutHits}; params ok`);
