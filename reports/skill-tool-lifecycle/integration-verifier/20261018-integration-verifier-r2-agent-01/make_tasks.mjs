#!/usr/bin/env node
// make_tasks.mjs — builds the fixture batches (small git repos), the neutral verify-batch.mjs wrappers, the
// work folders and the prompts for the integration-verifier agent run (20261018-integration-verifier-agent-01).
//
// Reads the tool from this checkout (read only). Everything is written under the scratch folder.
// Gold (expected statuses) is written to <SCRATCH>/gold.json, never into a work folder.
//
// Usage: node make_tasks.mjs <SCRATCH> [PRIVATE]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) { console.error('usage: node make_tasks.mjs <SCRATCH> [PRIVATE]'); process.exit(2); }
const SCRATCH = path.resolve(process.argv[2]);
// answer key, B logs, prompts and the pristine fixtures live outside the agents' parent folder (review finding: arm A could reach them)
const PRIVATE = path.resolve(process.argv[3] ?? SCRATCH + '-private');
const TOOL = path.resolve(import.meta.dirname, '..', '..', '..', '..', '.claude', 'skills', 'integration-verifier', 'scripts', 'verify.mjs');
const REPS = [1, 2];

const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const write = (dir, files) => { for (const [f, c] of Object.entries(files)) { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } };

// same base repo as the tool's own fixture test
const BASE = {
  'src/api.js': `const users = require('../fixtures/users.json');\nexports.getUser = (id) => users.find((u) => u.id === id);\n`,
  'fixtures/users.json': `[\n  {"id": 5, "name": "Ann"}\n]\n`,
  'migrations/0001_init.sql': 'create table users(id int, name text);\n',
  'config/app.json': '{ "pageSize": 20 }\n',
  'run-tests.js': `const fs = require('fs'); let bad = 0;\nfor (const f of fs.readdirSync('tests')) { try { require('./tests/' + f); console.log('ok', f); } catch (e) { bad++; console.error('FAIL tests/' + f + ': ' + e.message); } }\nprocess.exit(bad ? 1 : 0);\n`,
  'tests/api.test.js': `const a = require('assert'); a.equal(require('../src/api').getUser(5).name, 'Ann');\n`,
};

function makeBatch(dir, id, { stories, artifacts }) {
  const checks = [{ name: 'test', cmd: 'node run-tests.js' }];
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, BASE);
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  for (const s of stories) {
    git(repo, 'checkout', '-qb', `story/${s.id}`, 'main');
    write(repo, s.staleFail ?? s.files);   // staleFail: the files as they were when the story agent's check ran (it failed); fixed afterwards
    const rec = [];
    if (!s.omitCheck) for (const c of checks) {
      const r = spawnSync(c.cmd, { cwd: repo, shell: true, encoding: 'utf8' });
      const log = `logs/${s.id}-${c.name}.log`;
      if (!s.noLog) write(dir, { [log]: `${r.stdout}${r.stderr}` || '(empty)\n' });
      rec.push({ name: c.name, cmd: c.cmd, exit_code: r.status, log_path: log });
    }
    if (s.staleFail) write(repo, s.files);
    write(repo, { [`.integration/${s.id}.json`]: JSON.stringify({
      schema: 'integration-verifier/story-result@1', story_id: s.id, branch: `story/${s.id}`, claimed_status: 'done',
      summary: 'All done, tests pass.', changed_files: Object.keys(s.files), checks: rec,
      acceptance_criteria: s.acs ?? [{ id: 'AC1', claimed: 'met', evidence: [{ type: 'check', name: 'test' }] }],
    }, null, 2) });
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', s.id);
  }
  git(repo, 'checkout', '-q', 'main');
  if (artifacts) write(dir, Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [`${k}.json`, JSON.stringify(v, null, 2)])));
  write(dir, { 'batch.json': JSON.stringify({ batch_id: id, repo: 'repo', base: 'main', required_checks: checks,
    stories: stories.map((s) => ({ id: s.id, branch: `story/${s.id}` })),
    artifacts: artifacts ? Object.fromEntries(Object.keys(artifacts).map((k) => [k, `${k}.json`])) : undefined }, null, 2) });
}

const fmt = { 'src/fmt.js': 'exports.fmt = (u) => `#${u.id} ${u.name}`;\n', 'tests/fmt.test.js': `require('assert').equal(require('../src/fmt').fmt({id:1,name:'A'}), '#1 A');\n` };
const cnt = { 'src/count.js': 'exports.count = (xs) => xs.length;\n', 'tests/count.test.js': `require('assert').equal(require('../src/count').count([1,2]), 2);\n` };
// Gold labels are hand-written here, from the tool's documented rules, before any agent ran.
const CASES = [
  { id: 'c1', gold: { batch: 'PASS', stories: { S1: 'PASS', S2: 'PASS' } }, def: { stories: [{ id: 'S1', files: fmt }, { id: 'S2', files: cnt }] } },
  { id: 'c2', gold: { batch: 'BLOCKED', stories: { S1: 'BLOCKED', S2: 'PASS' } }, def: { stories: [
    { id: 'S1', files: { 'src/a.js': 'exports.a = 1;\n' }, noLog: true },
    { id: 'S2', files: cnt } ] } },
  // S2's recorded run exited 1 (the code was fixed in the same commit afterwards, so the combined run is green)
  { id: 'c3', gold: { batch: 'FAIL', stories: { S1: 'PASS', S2: 'FAIL' } }, def: { stories: [
    { id: 'S1', files: fmt },
    { id: 'S2', files: cnt, staleFail: { 'src/count.js': 'exports.count = (xs) => xs.length + 1;\n', 'tests/count.test.js': cnt['tests/count.test.js'] } } ] } },
  { id: 'c4', gold: { batch: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' } }, def: { stories: [
    { id: 'S1', files: { 'migrations/0002_add_email.sql': 'alter table users add email text;\n' } },
    { id: 'S2', files: { 'migrations/0002_add_phone.sql': 'alter table users add phone text;\n' } } ] } },
  { id: 'c5', gold: { batch: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' } }, def: { stories: [
    { id: 'S1', files: { 'src/api.js': `const users = require('../fixtures/users.json');\nexports.getUser = ({ id }) => users.find((u) => u.id === id);\n`, 'tests/api.test.js': `const a = require('assert'); a.equal(require('../src/api').getUser({ id: 5 }).name, 'Ann');\n` } },
    { id: 'S2', files: { 'src/profile.js': `const { getUser } = require('./api');\nexports.title = (id) => 'Profile of ' + getUser(id).name;\n`, 'tests/profile.test.js': `require('assert').equal(require('../src/profile').title(5), 'Profile of Ann');\n` } } ] } },
  { id: 'c6', gold: { batch: 'REVIEW_REQUIRED', stories: { S1: 'REVIEW_REQUIRED', S2: 'PASS' } }, def: {
    artifacts: { review_findings: [{ story: 'S1', severity: 'High', title: 'SQL built by string concat' }], ac_coverage: [{ story: 'S2', ac: 'AC1', status: 'covered', test: 'tests/count.test.js' }] },
    stories: [{ id: 'S1', files: { 'src/fmt.js': 'exports.fmt = (u) => u.name;\n' } },
      { id: 'S2', files: { 'src/count.js': 'exports.count = (xs) => xs.length;\n' }, acs: [{ id: 'AC1', claimed: 'met', evidence: [] }] }] } },
];

const PROMPT = `Work folder: {DIR}
{DIR}/batch.json describes a batch of parallel story branches that separate agents just finished. The git repository is {DIR}/repo (base branch main, one branch story/<id> per story, each with a result manifest .integration/<id>.json committed on it); the check logs the story agents recorded are under {DIR}/logs; the batch's required checks and any extra review/coverage files are named in batch.json.
Is this batch safe to merge? Answer with the batch status and a status per story, with one reason each.
Status meanings: PASS = the story's evidence is complete (every required check recorded with exit code 0 and a non-empty log, every acceptance criterion backed by a passing check, a human sign-off or a coverage row rather than only a claim, declared files match the diff), it is part of no conflict, and the combined change builds and passes the required checks. FAIL = a required check fails (its own run or the combined run) or the story conflicts with another (same migration version, incompatible contract, same fixture or config changed differently). BLOCKED = required evidence is missing or unusable (no manifest, check not run, a claim without a log or exit code) or an environment problem stops the check. REVIEW_REQUIRED = a human must look (an acceptance criterion with no evidence, an open High/Critical review finding, undeclared changes, or the combined build fails and this story cannot be shown to be innocent). A batch is as bad as its worst story (FAIL > BLOCKED > REVIEW_REQUIRED > PASS).
Do not change the repository's branches; if you want to merge or run tests, do it in a temporary copy outside {DIR}.
Reply with exactly these lines and nothing else: "BATCH: <status>" then one line per story "<id>: <status> - <one reason>".`;
const A_SENTENCE = 'No integration verifier is available in this task: decide yourself by inspecting the manifests, logs and branches. Do not look for or use any skill, script or helper from the repo or from this machine other than git and the commands in the batch.';
const B_SENTENCE = 'An integration verifier is available: run `node verify-batch.mjs` in this folder; it prints its report.';

const WRAPPER_A = `#!/usr/bin/env node\n// Neutral wrapper, arm A: the verifier is not available to this arm.\nconsole.log('verifier disabled');\n`;
const wrapperB = (caseId, arm, rep) => `#!/usr/bin/env node
// Neutral wrapper, arm B: runs the real integration-verifier verifyBatch (rules + Jev shadow, --jev) on this folder's
// batch.json, prints report.md, and appends one decision line to the run log.
import fs from 'node:fs';
import path from 'node:path';
import { verifyBatch } from ${JSON.stringify(pathToFileURL(TOOL).href)};
const here = import.meta.dirname;
const LOGS = ${JSON.stringify(path.join(PRIVATE, '_logs'))};
fs.mkdirSync(LOGS, { recursive: true });
const t0 = Date.now();
const r = await verifyBatch(path.join(here, 'batch.json'), { out: path.join(here, '_verifier-out'), jev: true, maxJev: 3 });
process.stdout.write(fs.readFileSync(path.join(here, '_verifier-out', 'report.md'), 'utf8'));
fs.appendFileSync(path.join(LOGS, ${JSON.stringify(`${caseId}.${arm}.r${rep}.jsonl`)}), JSON.stringify({
  t: new Date().toISOString(), case: ${JSON.stringify(caseId)}, arm: 'B', rep: ${rep}, ms: Date.now() - t0, batch: r.status,
  stories: Object.fromEntries(r.stories.map((s) => [s.id, s.status])), jev_calls: r.jev_calls, jev_mode: r.jev_mode,
  jev: r.clusters.filter((c) => c.jev).map((c) => ({ signature: c.signature, ...c.jev })),
}) + '\\n');
process.exit(r.status === 'PASS' ? 0 : r.status === 'FAIL' ? 1 : 3);
`;

fs.rmSync(path.join(SCRATCH, 'work'), { recursive: true, force: true });
fs.rmSync(path.join(PRIVATE, 'fixtures'), { recursive: true, force: true });
fs.rmSync(path.join(PRIVATE, '_logs'), { recursive: true, force: true });
fs.mkdirSync(path.join(PRIVATE, 'prompts'), { recursive: true });
const gold = {};
for (const c of CASES) {
  const fx = path.join(PRIVATE, 'fixtures', c.id);
  fs.mkdirSync(fx, { recursive: true });
  makeBatch(fx, `batch-${c.id}`, c.def);
  gold[c.id] = c.gold;
  for (const arm of ['A', 'B']) for (const rep of REPS) {
    const dir = path.join(SCRATCH, 'work', `${c.id}.${arm}.r${rep}`);
    fs.cpSync(fx, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'verify-batch.mjs'), arm === 'A' ? WRAPPER_A : wrapperB(c.id, arm, rep));
    const prompt = `${PROMPT.replaceAll('{DIR}', dir)}\n${arm === 'A' ? A_SENTENCE : B_SENTENCE}`;
    fs.writeFileSync(path.join(PRIVATE, 'prompts', `${c.id}.${arm}.r${rep}.txt`), prompt);
  }
}
fs.writeFileSync(path.join(PRIVATE, 'gold.json'), JSON.stringify(gold, null, 2));
console.log(`fixtures, work folders (${CASES.length}x2x${REPS.length}), prompts and gold under ${SCRATCH}`);
