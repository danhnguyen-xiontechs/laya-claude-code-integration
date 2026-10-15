// Run: node --test .claude/skills/skills-router/tests/history-eval.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { covered, matches, metrics, pickThresholds, splitOf } from '../scripts/eval.mjs';
import { casesFromRecords, classifyUser, mine, readJsonl } from '../scripts/mine-history.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcript.jsonl');

describe('history mining', () => {
  it('pairs prompts with the skill invoked in the next assistant turn, or none', () => {
    const { cases, drop } = casesFromRecords(readJsonl(FIXTURE));
    assert.deepEqual(cases.map((c) => [c.query, c.expected, c.via]), [
      ['please review the pull request for the payroll service', 'review-pr', 'skill-tool'],
      ['what does this regex do', null, 'prompt'],
      ['verify story 22070 acceptance criteria on dev', 'web-test', 'slash'],
      ['ok commit it', null, 'prompt'],
      ['please review the pull request for the payroll service', 'review-pr', 'skill-tool'],
    ]);
    assert.deepEqual(drop, { builtin: 1, shortArgs: 1, long: 0 });
    assert.equal(cases[0].cwd, 'D:\\proj');
  });

  it('does not credit skills invoked after SDK prompts or task notifications', () => {
    const { cases } = casesFromRecords(readJsonl(FIXTURE));
    assert.ok(!cases.some((c) => c.expected === 'workflow-authoring' || c.expected === 'loop'));
    const withSdk = casesFromRecords(readJsonl(FIXTURE), { includeSdk: true }).cases;
    assert.ok(withSdk.some((c) => c.expected === 'workflow-authoring'));
    assert.equal(classifyUser({ type: 'user', isSidechain: true, message: { content: 'x' } }), null);
  });

  it('mines a projects folder and dedupes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-router-hist-'));
    fs.mkdirSync(path.join(dir, 'p1'));
    fs.copyFileSync(FIXTURE, path.join(dir, 'p1', 's1.jsonl'));
    const { cases, drop } = mine({ projectsDir: dir });
    assert.equal(cases.length, 4);
    assert.equal(drop.duplicate, 1);
  });
});

describe('eval metrics', () => {
  const sl = (ids) => ids.map((id, i) => ({ id, score: 10 - i, mentioned: false }));
  const row = (expected, ids, extra = {}) => ({ expected, covered: true, latencyMs: 10, cost: 0.001, raw: { mode: 'bm25', shortlist: sl(ids) }, ...extra });
  const rows = [
    row('a', ['a', 'b']), // correct
    row('a', ['b', 'a']), // wrong top-1, right top-3
    row(null, ['c']), // needless
    row(null, []), // correct abstain
    row('z', ['a'], { covered: false }), // uncovered: excluded
    row('a', ['a'], { error: 'timeout', raw: null }), // error → abstain, missed
  ];

  it('scores top-1/top-3, wrong, needless, abstain precision, latency and cost', () => {
    const m = metrics(rows, { bm25Min: 0 });
    assert.equal(m.n, 5);
    assert.equal(m.uncovered, 1);
    assert.equal(m.errors, 1);
    assert.equal(m.top1Acc, 0.333);
    assert.equal(m.top3Acc, 0.667);
    assert.equal(m.wrongRate, 0.333);
    assert.equal(m.missRate, 0.333);
    assert.equal(m.needlessRate, 0.5);
    assert.equal(m.abstainPrecision, 0.5);
    assert.equal(m.accuracy, 0.4);
    assert.equal(m.balanced, Number(((1 / 3 + 1 / 2) / 2).toFixed(3)));
    assert.deepEqual(m.latencyMs, { p50: 10, p95: 10, mean: 10 });
    assert.equal(m.cost.total, 0.005);
  });

  it('a high score floor turns every suggestion into an abstention', () => {
    const m = metrics(rows, { bm25Min: 100 });
    assert.equal(m.needlessRate, 0);
    assert.equal(m.missRate, 1);
    assert.equal(m.top1Acc, 0.333, 'top-1 ignores abstention');
  });

  it('picks thresholds by balanced accuracy', () => {
    const dev = [row('a', ['a']), row(null, [], {}), { ...row(null, ['c']), raw: { mode: 'bm25', shortlist: [{ id: 'c', score: 2, mentioned: false }] } }];
    const th = pickThresholds(dev, 'bm25');
    assert.ok(th.bm25Min > 2 && th.bm25Min <= 10);
    assert.equal(metrics(dev, th).balanced, 1);
  });

  it('splits by a fixed hash and matches labels by bare name', () => {
    assert.equal(splitOf('hello'), splitOf('hello'));
    const n = 400;
    const dev = Array.from({ length: n }, (_, i) => splitOf(`q${i}`)).filter((s) => s === 'dev').length;
    assert.ok(dev > 0.5 * n && dev < 0.7 * n);
    assert.ok(matches('typesafe:typesafe-ai', 'typesafe-ai'));
    assert.ok(!matches(null, 'a'));
    assert.ok(covered('x', [{ id: 'y', shadowed: [{ name: 'x' }] }]));
    assert.ok(covered(null, []));
  });
});
