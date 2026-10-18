import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRequest, interpret, gradeRows, summarize } from '../scripts/grade_with_engine.mjs';

const ok = (pass) => ({ ok: true, answers: { grade: { probabilities: { pass, fail: 1 - pass } } }, meta: { latencyMs: 100, cost: 0.00002 } });
const rows = [
  { id: 'r1', rule: 'PICK equals gold', gold: 'web-test', answer: 'PICK: web-test', label: 'pass', source: 'real' },
  { id: 'r2', rule: 'PICK equals gold', gold: 'web-test', answer: 'PICK: none', label: 'fail', source: 'real' },
  { id: 'm1', rule: 'PICK equals gold', gold: 'none', answer: 'PICK: web-test', label: 'fail', source: 'mismatch' },
];

describe('grade_with_engine', () => {
  it('builds one pass/fail choice question with rule, key and answer in the state', () => {
    const r = buildRequest({ rule: 'R', gold: { batch: 'PASS' }, answer: 'BATCH: PASS' });
    assert.deepEqual(Object.keys(r.questions.grade.criteria), ['pass', 'fail']);
    assert.match(r.state.text, /Pass rule: R/);
    assert.match(r.state.text, /"batch":"PASS"/);
    assert.match(r.state.text, /BATCH: PASS/);
  });

  it('reads p(pass) and applies the 0.5 threshold', () => {
    assert.deepEqual(interpret(ok(0.8)), { grade: 'pass', p: 0.8 });
    assert.equal(interpret(ok(0.2)).grade, 'fail');
    assert.equal(interpret({ ok: true, answers: { grade: { probabilities: { fail: 0.3 } } } }).grade, 'pass');
  });

  it('gives null, never a grade, on a malformed answer, a timeout or an error', () => {
    assert.deepEqual(interpret({ ok: true, answers: { other: {} } }), { grade: null, p: null, error: 'malformed answer' });
    assert.equal(interpret({ ok: false, error: 'timeout', meta: {} }).grade, null);
    assert.equal(interpret(null).grade, null);
  });

  it('grades rows with the fake engine and counts false passes by source', async () => {
    const answers = { r1: ok(0.9), r2: ok(0.7), m1: { ok: false, error: 'timeout', meta: { latencyMs: 15000 } } };
    const decideImpl = async ({ state }) => answers[rows.find((r) => state.text.includes(`Key (expected answer): ${r.gold}\n`) && state.text.endsWith(r.answer)).id];
    const graded = await gradeRows(rows, { provider: 'jev', decideImpl, concurrency: 2 });
    assert.deepEqual(graded.map((g) => g.grade), ['pass', 'pass', null]);
    const s = summarize(graded);
    assert.equal(s.falsePassReal, 1);
    assert.equal(s.realFails, 1);
    assert.equal(s.nullGrades, 1);
    assert.equal(s.agreement, 1 / 3);
  });
});
