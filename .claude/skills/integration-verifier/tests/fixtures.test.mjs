// fixtures.test.mjs — builds tiny throwaway git repos with known integration defects and checks
// the verifier's statuses against independently labelled expectations (labels are written here,
// by hand, before running). Key metric: zero false PASS.
//
//   node tests/fixtures.test.mjs            deterministic only (no network)
//   node tests/fixtures.test.mjs --jev      also Jev shadow triage (≤ 1 call per unclassified cluster,
//                                           ≤ 10 in total) and asserts statuses are identical to the
//                                           deterministic run (Jev can never change a status)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { verifyBatch, crossStory, deterministicCategory, pathKind, migrationKey, finalize } from '../scripts/verify.mjs';

const JEV = process.argv.includes('--jev');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-fix-'));
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' }); if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const write = (dir, files) => { for (const [f, c] of Object.entries(files)) { const p = path.join(dir, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } };

const BASE = {
  'src/api.js': `const users = require('../fixtures/users.json');\nexports.getUser = (id) => users.find((u) => u.id === id);\n`,
  'fixtures/users.json': `[\n  {"id": 5, "name": "Ann"}\n]\n`,
  'migrations/0001_init.sql': 'create table users(id int, name text);\n',
  'config/app.json': '{ "pageSize": 20 }\n',
  'run-tests.js': `const fs = require('fs'); let bad = 0;\nfor (const f of fs.readdirSync('tests')) { try { require('./tests/' + f); console.log('ok', f); } catch (e) { bad++; console.error('FAIL tests/' + f + ': ' + e.message); } }\nprocess.exit(bad ? 1 : 0);\n`,
  'tests/api.test.js': `const a = require('assert'); a.equal(require('../src/api').getUser(5).name, 'Ann');\n`,
};

/** Builds one batch: base repo + one branch per story; returns the batch file path. */
function makeBatch(name, { stories, checks = [{ name: 'test', cmd: 'node run-tests.js' }], baseExtra = {}, artifacts }) {
  const dir = path.join(root, name), repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  write(repo, { ...BASE, ...baseExtra });
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  for (const s of stories) {
    git(repo, 'checkout', '-qb', `story/${s.id}`, 'main');
    write(repo, s.files);
    // The story agent ran its checks in its own worktree; record the real result + log (Phase 1).
    const checksRec = [];
    for (const c of checks) {
      if (s.omitCheck) continue;
      const r = spawnSync(c.cmd, { cwd: repo, shell: true, encoding: 'utf8' });
      const log = `logs/${s.id}-${c.name}.log`;
      if (!s.noLog) write(dir, { [log]: `${r.stdout}${r.stderr}` || '(empty)\n' });
      checksRec.push({ name: c.name, cmd: c.cmd, exit_code: s.fakeExit ?? r.status, log_path: log });
    }
    const changed = Object.keys(s.files);
    if (!s.noManifest) write(repo, { [`.integration/${s.id}.json`]: JSON.stringify({
      schema: 'integration-verifier/story-result@1', story_id: s.id, branch: `story/${s.id}`, claimed_status: 'done',
      summary: 'All done, tests pass.', changed_files: s.claimedFiles ?? changed, checks: checksRec,
      acceptance_criteria: s.acs ?? [{ id: 'AC1', claimed: 'met', evidence: [{ type: 'check', name: 'test' }] }],
      contracts: s.contracts, config: s.config,
    }, null, 2) });
    git(repo, 'add', '-A'); git(repo, 'commit', '-qm', s.id);
  }
  git(repo, 'checkout', '-q', 'main');
  if (artifacts) write(dir, Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [`${k}.json`, JSON.stringify(v)])));
  const batch = { batch_id: name, repo: 'repo', base: 'main', required_checks: checks, stories: stories.map((s) => ({ id: s.id, branch: `story/${s.id}` })),
    artifacts: artifacts ? Object.fromEntries(Object.keys(artifacts).map((k) => [k, `${k}.json`])) : undefined };
  write(dir, { 'batch.json': JSON.stringify(batch, null, 2) });
  return path.join(dir, 'batch.json');
}

// Hand-labelled cases: expected batch status and per-story statuses.
const CASES = [
  { name: 'all-green', expect: 'PASS', stories: { S1: 'PASS', S2: 'PASS' }, def: { stories: [
    { id: 'S1', files: { 'src/fmt.js': 'exports.fmt = (u) => `#${u.id} ${u.name}`;\n', 'tests/fmt.test.js': `require('assert').equal(require('../src/fmt').fmt({id:1,name:'A'}), '#1 A');\n` } },
    { id: 'S2', files: { 'src/count.js': 'exports.count = (xs) => xs.length;\n', 'tests/count.test.js': `require('assert').equal(require('../src/count').count([1,2]), 2);\n` } },
  ] } },
  { name: 'contract-mismatch', expect: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' }, def: { stories: [
    { id: 'S1', files: { 'src/api.js': `const users = require('../fixtures/users.json');\nexports.getUser = ({ id }) => users.find((u) => u.id === id);\n`, 'tests/api.test.js': `const a = require('assert'); a.equal(require('../src/api').getUser({ id: 5 }).name, 'Ann');\n` },
      contracts: { provides: [{ name: 'api.getUser', signature: 'getUser({ id })' }] } },
    { id: 'S2', files: { 'src/profile.js': `const { getUser } = require('./api');\nexports.title = (id) => 'Profile of ' + getUser(id).name;\n`, 'tests/profile.test.js': `require('assert').equal(require('../src/profile').title(5), 'Profile of Ann');\n` },
      contracts: { consumes: [{ name: 'api.getUser', signature: 'getUser(id)' }] } },
  ] } },
  // Same defect, but no story declared its contracts: only the combined run can catch it.
  { name: 'contract-mismatch-undeclared', expect: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' }, def: { stories: [
    { id: 'S1', files: { 'src/api.js': `const users = require('../fixtures/users.json');\nexports.getUser = ({ id }) => users.find((u) => u.id === id);\n`, 'tests/api.test.js': `const a = require('assert'); a.equal(require('../src/api').getUser({ id: 5 }).name, 'Ann');\n` } },
    { id: 'S2', files: { 'src/profile.js': `const { getUser } = require('./api');\nexports.title = (id) => 'Profile of ' + getUser(id).name;\n`, 'tests/profile.test.js': `require('assert').equal(require('../src/profile').title(5), 'Profile of Ann');\n` } },
  ] } },
  { name: 'duplicate-migration', expect: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' }, def: { stories: [
    { id: 'S1', files: { 'migrations/0002_add_email.sql': 'alter table users add email text;\n' } },
    { id: 'S2', files: { 'migrations/0002_add_phone.sql': 'alter table users add phone text;\n' } },
  ] } },
  { name: 'fixture-conflict', expect: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' }, def: { stories: [
    { id: 'S1', files: { 'fixtures/users.json': `[\n  {"id": 5, "name": "Anna"}\n]\n`, 'tests/api.test.js': `const a = require('assert'); a.equal(require('../src/api').getUser(5).name, 'Anna');\n` } },
    { id: 'S2', files: { 'src/greet.js': `exports.greet = (id) => 'Hi ' + require('./api').getUser(id).name;\n`, 'tests/greet.test.js': `require('assert').equal(require('../src/greet').greet(5), 'Hi Ann');\n` } },
  ] } },
  { name: 'config-conflict', expect: 'FAIL', stories: { S1: 'FAIL', S2: 'FAIL' }, def: { stories: [
    { id: 'S1', files: { 'src/a.js': 'exports.a = 1;\n' }, config: { 'app.pageSize': 50 } },
    { id: 'S2', files: { 'src/b.js': 'exports.b = 1;\n' }, config: { 'app.pageSize': 10 } },
  ] } },
  { name: 'missing-logs', expect: 'BLOCKED', stories: { S1: 'BLOCKED', S2: 'BLOCKED', S3: 'BLOCKED' }, def: { stories: [
    { id: 'S1', files: { 'src/a.js': 'exports.a = 1;\n' }, noLog: true },          // claims exit 0, no log artifact
    { id: 'S2', files: { 'src/b.js': 'exports.b = 1;\n' }, noManifest: true },     // no result manifest at all
    { id: 'S3', files: { 'src/c.js': 'exports.c = 1;\n' }, omitCheck: true },      // required check never run
  ] } },
  { name: 'claim-only-and-story-fail', expect: 'FAIL', stories: { S1: 'REVIEW_REQUIRED', S2: 'FAIL' }, def: { stories: [
    { id: 'S1', files: { 'src/a.js': 'exports.a = 1;\n' }, acs: [{ id: 'AC1', claimed: 'met', evidence: [] }] },
    { id: 'S2', files: { 'src/b.js': 'exports.b = 1;\n' }, fakeExit: 1 },        // its own test run failed
  ] } },
  { name: 'environment-only', expect: 'BLOCKED', stories: { S1: 'BLOCKED', S2: 'BLOCKED' }, def: {
    baseExtra: { 'db-check.js': `console.error('Error: connect ECONNREFUSED 127.0.0.1:5432'); process.exit(1);\n` },
    checks: [{ name: 'test', cmd: 'node run-tests.js' }, { name: 'db-integration', cmd: 'node db-check.js' }],
    stories: [
      { id: 'S1', files: { 'src/a.js': 'exports.a = 1;\n' }, fakeExit: 0 },
      { id: 'S2', files: { 'src/b.js': 'exports.b = 1;\n' }, fakeExit: 0 },
    ] } },
  { name: 'green-but-review-finding', expect: 'REVIEW_REQUIRED', stories: { S1: 'REVIEW_REQUIRED', S2: 'PASS' }, def: {
    artifacts: { review_findings: [{ story: 'S1', severity: 'High', title: 'SQL built by string concat' }], ac_coverage: [{ story: 'S2', ac: 'AC1', status: 'covered', test: 'tests/count.test.js' }] },
    stories: [
      { id: 'S1', files: { 'src/fmt.js': 'exports.fmt = (u) => u.name;\n' } },
      { id: 'S2', files: { 'src/count.js': 'exports.count = (xs) => xs.length;\n' }, acs: [{ id: 'AC1', claimed: 'met', evidence: [] }] },
    ] } },
];

// ---- unit checks on the pure rules ----
assert.equal(pathKind('db/migrations/0002_x.sql'), 'migration');
assert.equal(pathKind('tests/fixtures/u.json'), 'fixture');
assert.equal(pathKind('src/dto/User.ts'), 'contract');
assert.equal(pathKind('config/app.json'), 'config');
assert.equal(migrationKey('migrations/20241001_x.sql'), '20241001');
assert.equal(deterministicCategory('Error: connect ECONNREFUSED 127.0.0.1:5432', 1), 'environment');
assert.equal(deterministicCategory("Error: Cannot find module 'left-pad'", 1), 'dependency');
assert.equal(deterministicCategory('AssertionError: expected 1 got 2', 1), null);
assert.equal(crossStory([{ id: 'a', files: ['m/x'], manifest: { config: { k: 1 } } }, { id: 'b', files: ['m/y'], manifest: { config: { k: 1 } } }]).length, 0);
// Jev cannot lift a status: even a cluster whose (shadow) suggestion is "environment" with p=1 stays FAIL.
{
  const s = [{ id: 'S1', status: 'PASS', reasons: [] }];
  const st = finalize(s, [], { status: 'FAIL', merge_conflicts: [], checks: [{ exit: 1 }] }, [{ category: 'unknown', checks: ['test'], stories: ['S1'], signature: 'x', jev: { suggestion: 'environment', p: 1 } }]);
  assert.equal(st, 'FAIL'); assert.equal(s[0].status, 'FAIL');
}
console.log('unit rules: ok');

// ---- fixture batches ----
let falsePass = 0, mismatches = 0, jevCalls = 0;
const rows = [];
for (const c of CASES) {
  const file = makeBatch(c.name, c.def);
  const det = await verifyBatch(file, { out: path.join(path.dirname(file), 'out-det') });
  const got = Object.fromEntries(det.stories.map((s) => [s.id, s.status]));
  if (det.status === 'PASS' && c.expect !== 'PASS') falsePass++;
  for (const s of det.stories) if (s.status === 'PASS' && c.stories[s.id] !== 'PASS') falsePass++;
  const ok = det.status === c.expect && JSON.stringify(got) === JSON.stringify(c.stories);
  if (!ok) mismatches++;
  let jevCol = '';
  if (JEV) {
    const j = await verifyBatch(file, { out: path.join(path.dirname(file), 'out-jev'), jev: true, maxJev: Math.max(0, Math.min(3, 10 - jevCalls)) });
    jevCalls += j.jev_calls;
    assert.equal(j.status, det.status, `${c.name}: Jev run changed batch status`);
    assert.deepEqual(j.stories.map((s) => s.status), det.stories.map((s) => s.status), `${c.name}: Jev run changed a story status`);
    jevCol = j.clusters.filter((x) => x.jev).map((x) => x.jev.error ? `err:${x.jev.error}` : `${x.jev.suggestion}(${x.jev.p})`).join(' ');
  }
  const cats = det.clusters.map((x) => `${x.category}/${x.category_source}→[${x.stories.join(',') || '-'}]`).join(' ');
  rows.push({ case: c.name, expect: c.expect, got: det.status, stories: JSON.stringify(got), ok, conflicts: det.conflicts.map((x) => x.type).join(',') || '-', clusters: cats || '-', jev: jevCol });
  if (!ok) console.error(`MISMATCH ${c.name}:`, JSON.stringify(det.stories.map((s) => ({ id: s.id, status: s.status, reasons: s.reasons })), null, 1));
}
console.table(rows);
console.log(`cases ${CASES.length} · mismatches ${mismatches} · FALSE PASS ${falsePass} · jev calls ${jevCalls} · fixtures in ${root}`);
fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify({ rows, mismatches, falsePass, jevCalls }, null, 2));
process.exit(falsePass || mismatches ? 1 : 0);
