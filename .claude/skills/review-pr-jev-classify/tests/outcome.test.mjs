// Tests for the outcome-label miner (fixture patches, fake az/git) and its rows in laya-eval.
// Run: node --test .claude/skills/review-pr-jev-classify/tests/outcome.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildRows, hunkTouches, labelFinding, mapLine, main as minerMain, parseHunks } from '../scripts/outcome-labels.mjs';
import { main as evalMain, outcomeReport } from '../scripts/laya-eval.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rpo-'));

// review head → final head, git diff -M -U0
const LATER = [
  'diff --git a/src/Svc.cs b/src/Svc.cs',
  'index 1..2 100644',
  '--- a/src/Svc.cs',
  '+++ b/src/Svc.cs',
  '@@ -3,0 +4,2 @@ using X;',            // 2 lines inserted after old line 3
  '+using Y;',
  '+using Z;',
  '@@ -50 +52 @@ class Svc',               // old line 50 replaced
  '-var m = query.Manager;',
  '+var m = _user.PersonnelNumber;',
  '@@ -120,2 +122,0 @@',                  // old lines 120-121 removed
  '-a',
  '-b',
  'diff --git a/src/Old.cs b/src/Renamed.cs',
  'similarity index 90%',
  'rename from src/Old.cs',
  'rename to src/Renamed.cs',
  'index 3..4 100644',
  '--- a/src/Old.cs',
  '+++ b/src/Renamed.cs',
  '@@ -10,0 +11,3 @@',
  '+x',
  '+y',
  '+z',
  'diff --git a/src/Gone.cs b/src/Gone.cs',
  'deleted file mode 100644',
  'index 5..0',
  '--- a/src/Gone.cs',
  '+++ /dev/null',
  '@@ -1,3 +0,0 @@',
  '-1',
  '-2',
  '-3',
].join('\n');

describe('parse and label (fixture patch)', () => {
  const files = parseHunks(LATER);
  it('parses hunks, renames and deletions', () => {
    assert.deepEqual(files.map((f) => [f.oldPath, f.path, f.changeType, f.hunks.length]), [
      ['src/Svc.cs', 'src/Svc.cs', 'modified', 3],
      ['src/Old.cs', 'src/Renamed.cs', 'renamed', 1],
      ['src/Gone.cs', 'src/Gone.cs', 'deleted', 1],
    ]);
    assert.deepEqual(files[0].hunks[1], { oldStart: 50, oldCount: 1, newStart: 52, newCount: 1 });
  });
  it('hunk overlap and line moves', () => {
    assert.equal(hunkTouches({ oldStart: 50, oldCount: 1 }, 45, 55), true);
    assert.equal(hunkTouches({ oldStart: 56, oldCount: 1 }, 45, 55), false);
    assert.equal(hunkTouches({ oldStart: 44, oldCount: 0 }, 45, 55), true); // inserted right before the region
    assert.equal(hunkTouches({ oldStart: 43, oldCount: 0 }, 45, 55), false);
    assert.equal(mapLine(files[0].hunks, 80), 82); // +2 inserted above, line 50 replaced 1:1
    assert.equal(mapLine(files[0].hunks, 130), 130); // -2 removed at 120-121
  });
  const L = (file, line, extra = {}) => labelFinding({ file, line, ...extra }, files);
  it('fixed when the region (±5) was changed', () => {
    assert.equal(L('src/Svc.cs', 50).label, 'fixed');
    assert.equal(L('src/Svc.cs', 55).label, 'fixed'); // 50 is within 55-5
    assert.equal(L('src/Svc.cs', 125).label, 'fixed'); // removal at 120-121
  });
  it('unchanged when only code above moved it; new location follows the move', () => {
    const o = L('src/Svc.cs', 80);
    assert.equal(o.label, 'unchanged');
    assert.deepEqual(o.region, [75, 85]);
    assert.deepEqual(o.newRegion, [77, 87]);
    assert.equal(L('src/Svc.cs', 56).label, 'unchanged'); // region 51-61 starts after the change at 50
    assert.equal(labelFinding({ file: 'src/Svc.cs', line: 56 }, files, { context: 6 }).label, 'fixed');
  });
  it('endLine widens the region', () => assert.equal(L('src/Svc.cs', 30, { endLine: 46 }).label, 'fixed'));
  it('follows renames; file-removed; untouched file; whole file when no line', () => {
    const r = L('src/Old.cs', 12);
    assert.deepEqual([r.label, r.newFile], ['fixed', 'src/Renamed.cs']);
    assert.equal(L('src/Old.cs', 40).label, 'unchanged');
    assert.equal(L('src/Gone.cs', 2).label, 'file-removed');
    assert.equal(L('src/Untouched.cs', 2).label, 'unchanged');
    assert.equal(L('\\src\\Svc.cs', null).label, 'fixed');
    assert.equal(labelFinding({ file: null }, files).label, null);
  });
});

describe('rows for laya-eval', () => {
  it('human = fixed|unchanged, source outcome, every provider answer kept', () => {
    const prJson = { repoId: 'r', id: 5, sourceCommit: 'aaa' };
    const findings = [{ id: 'F1', severity: 'Minor', rule: 'Bug', issue: 'i' }, { id: 'F2', severity: 'Major', rule: 'Bug', issue: 'j' }];
    const logs = {
      laya: { merge: { laya: { label: 'Blocked', confidence: 0.6 } }, results: [{ id: 'F1', claude: 'Minor', final: 'Minor', laya: { label: 'Major', confidence: 0.4 } }] },
      jev: { results: [{ id: 'F1', claude: 'Minor', laya: { label: 'Major', confidence: 0.9 }, introducedByPr: { answer: 'yes' }, alreadyRaised: { answer: 'no' } }] },
    };
    const rows = buildRows({ prJson, findings, logs, labels: [{ label: 'fixed' }, { label: 'file-removed' }], finalState: { head: 'bbb', state: 'completed' }, provider: 'jev' });
    assert.equal(rows[0].key, 'r#5/F1');
    assert.deepEqual([rows[0].human, rows[0].source, rows[0].provider, rows[0].laya.confidence], ['fixed', 'outcome', 'jev', 0.9]);
    assert.deepEqual(rows[0].answers, { laya: { label: 'Major', confidence: 0.4 }, jev: { label: 'Major', confidence: 0.9 } });
    assert.deepEqual(rows[0].introducedByPr, { laya: null, jev: 'yes' });
    assert.equal(rows[1].human, null); // file-removed is ambiguous
    assert.equal(rows[1].claude, 'Major');
    assert.deepEqual([rows[0].outcome.reviewHead, rows[0].outcome.finalHead, rows[0].outcome.prState], ['aaa', 'bbb', 'completed']);
  });
});

/** Run folder + fake az/git. state/head = what `az repos pr show` returns. */
function setup({ state = 'completed', head = 'f'.repeat(40), haveCommits = true } = {}) {
  const d = tmp();
  const review = 'a'.repeat(40);
  fs.writeFileSync(path.join(d, 'pr-5.json'), JSON.stringify({ id: 5, repoId: 'dev.azure.com__o__p__r', url: 'https://dev.azure.com/o/p/_git/r/pullrequest/5', sourceCommit: review, repoDir: d }));
  fs.writeFileSync(path.join(d, 'pr-5.findings.json'), JSON.stringify({ findings: [
    { id: 'F1', severity: 'Critical', file: 'src/Svc.cs', line: 50, rule: 'AUTHZ', issue: 'x' },
    { id: 'F2', severity: 'Minor', file: 'src/Svc.cs', line: 80, rule: 'RATE', issue: 'y' },
    { id: 'F3', severity: 'Major', file: 'src/Gone.cs', line: 1, rule: 'Bug', issue: 'z' },
  ] }));
  fs.writeFileSync(path.join(d, 'pr-5.jev.json'), JSON.stringify({ results: [{ id: 'F2', claude: 'Minor', laya: { label: 'Major', confidence: 0.9 } }] }));
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'az') return { status: 0, stdout: JSON.stringify({ status: state, lastMergeSourceCommit: { commitId: head }, sourceRefName: 'refs/heads/feat' }), stderr: '' };
    if (cmd === 'git' && args.includes('cat-file')) return { status: haveCommits ? 0 : 1, stdout: '', stderr: '' };
    if (cmd === 'git' && args.includes('fetch')) return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'git' && args.includes('diff')) return { status: 0, stdout: LATER, stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { d, run, calls, review };
}

describe('outcome-labels CLI (fake az + git)', () => {
  it('labels a completed, updated PR and writes rows next to the run', async () => {
    const { d, run, calls, review } = setup();
    const out = [];
    const code = await minerMain(['--pr', '5', '--run', d], { log: (l) => out.push(l), error: (l) => out.push(l), run });
    assert.equal(code, 0, out.join('\n'));
    const rows = fs.readFileSync(path.join(d, 'pr-5.outcome.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => [r.id, r.outcome.label, r.human]), [['F1', 'fixed', 'fixed'], ['F2', 'unchanged', 'unchanged'], ['F3', 'file-removed', null]]);
    assert.equal(rows[1].laya.label, 'Major');
    assert.ok(calls.some((c) => c === `git -C ${d} diff --text -M -U0 --no-color ${review} ${'f'.repeat(40)}`));
    assert.ok(!calls.some((c) => / fetch /.test(c))); // commits present: no fetch
    assert.ok(calls.every((c) => !/ (push|commit|checkout|reset|update|create|vote|set-vote)\b/.test(c)), calls.join('\n'));
    assert.match(out.at(-1), /^fixed=1 unchanged=1 file-removed=1 skipped=0/);
  });
  it('an active PR with no new commit has no outcome yet: nothing written', async () => {
    const { d, run, review } = setup({ state: 'active', head: 'a'.repeat(40) });
    const out = [];
    assert.equal(await minerMain(['--pr', '5', '--run', d], { log: (l) => out.push(l), run }), 0);
    assert.match(out[0], /not updated since the review .*nothing written/);
    assert.ok(!fs.existsSync(path.join(d, 'pr-5.outcome.jsonl')));
    assert.ok(review);
  });
  it('a merged PR with no later commit: every finding unchanged, no git diff', async () => {
    const { d, run, calls } = setup({ state: 'completed', head: 'a'.repeat(40) });
    assert.equal(await minerMain(['--pr', '5', '--run', d], { log: () => {}, run }), 0);
    const rows = fs.readFileSync(path.join(d, 'pr-5.outcome.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(rows.every((r) => r.human === 'unchanged'));
    assert.ok(!calls.some((c) => c.startsWith('git')));
  });
  it('missing commits: fetches, then fails clearly when still missing; --no-fetch never fetches', async () => {
    const s = setup({ haveCommits: false });
    const err = [];
    assert.equal(await minerMain(['--pr', '5', '--run', s.d], { log: () => {}, error: (l) => err.push(l), run: s.run }), 1);
    assert.ok(s.calls.some((c) => c.includes('fetch --quiet origin refs/heads/feat')));
    assert.match(err[0], /could not be fetched/);
    const t = setup({ haveCommits: false });
    assert.equal(await minerMain(['--pr', '5', '--run', t.d, '--no-fetch'], { log: () => {}, error: () => {}, run: t.run }), 1);
    assert.ok(!t.calls.some((c) => c.includes(' fetch ')));
  });
  it('rejects a PR id that does not match the run folder', async () => {
    const { d, run } = setup();
    const err = [];
    assert.equal(await minerMain(['--pr', 'https://dev.azure.com/o/p/_git/r/pullrequest/6', '--run', d], { log: () => {}, error: (l) => err.push(l), run }), 1);
    assert.match(err[0], /PR 6 but the run folder is for PR 5/);
  });
});

describe('laya-eval with outcome rows', () => {
  const row = (id, claude, laya, human) => ({ key: `p#1/${id}`, pr: 'p#1', id, rule: 'Bug', issue: id, claude, final: claude, answers: { jev: { label: laya, confidence: 0.9 } }, laya: { label: 'Suggestion', confidence: 0.3 }, human, source: 'outcome' });
  const rows = [row('A', 'Minor', 'Major', 'fixed'), row('B', 'Minor', 'Major', 'fixed'), row('C', 'Minor', 'Minor', 'unchanged'), row('D', 'Critical', 'Critical', 'fixed'), row('E', 'Major', 'Minor', 'unchanged')];
  it('fixed rate per predicted blocking / non-blocking and on boundary disagreements', () => {
    const o = outcomeReport(rows.map((r) => ({ ...r, laya: r.answers.jev, rules: 'Major' })));
    assert.deepEqual([o.n, o.fixed, o.rate], [5, 3, 0.6]);
    assert.deepEqual(o.byPredictor.claude.blocking, { n: 2, fixed: 1, rate: 0.5 });
    assert.deepEqual(o.byPredictor.laya.blocking, { n: 3, fixed: 3, rate: 1 });
    assert.deepEqual(o.disagree.up, { n: 2, fixed: 2, rate: 1 });
    assert.deepEqual(o.disagree.down, { n: 1, fixed: 0, rate: 0 });
  });
  it('run on an outcome-only dataset prints the outcome report and uses the selected provider', async () => {
    const d = tmp();
    const ds = path.join(d, 'ds.jsonl');
    fs.writeFileSync(ds, rows.map((r) => JSON.stringify(r)).join('\n'));
    const out = [];
    assert.equal(await evalMain(['run', '--data', ds, '--provider', 'jev'], { log: (l) => out.push(l), error: (l) => out.push(l), env: {} }), 0, out.join('\n'));
    assert.ok(out.some((l) => /^outcome rows: 5 findings on 1 PR\(s\), fixed 60% of 5$/.test(l)), out.join('\n'));
    assert.ok(out.some((l) => /up \(provider blocks\) fixed 100% of 2/.test(l)));
    const rep = JSON.parse(fs.readFileSync(path.join(d, 'ds.jev.eval.json'), 'utf8'));
    assert.equal(rep.outcome.disagree.up.n, 2);
  });
});
