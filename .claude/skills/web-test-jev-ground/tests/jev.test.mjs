// Tests for the Laya-vs-Jev grounding A/B. Run: node --test .claude/skills/web-test-jev-ground/tests/ab.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JEV_URL } from '../scripts/decision-provider.mjs';
import { buildGroundRequest, gate } from '../scripts/ground-question.mjs';
import { collectCases, runCases, summarize } from '../scripts/replay.mjs';

const KEY = 'sk-or-test-secret-456';
const SHORT = [
  { id: 'g24', role: 'button', name: 'Previous month', hint: '', disabled: false },
  { id: 'g26', role: 'button', name: 'Next month', hint: '', disabled: true },
];

describe('ground question (unchanged from web-test-laya-ground)', () => {
  it('criteria format and none option', () => {
    const { state, questions } = buildGroundRequest('month back', '/attendance', SHORT);
    assert.deepEqual(state, { goal: 'month back', page: '/attendance' });
    assert.equal(questions.target.type, 'choice');
    assert.equal(questions.target.instructions, 'Which page element should a tester use for this goal?');
    assert.deepEqual(questions.target.criteria, { g24: 'button "Previous month"', g26: 'button "Next month" [disabled]', none: 'None of these elements matches the goal.' });
  });
  it('gate: p >= 0.8 and margin >= 0.25, never none', () => {
    assert.equal(gate({ g24: 0.85, g26: 0.1, none: 0.05 }).accepted, true);
    assert.equal(gate({ g24: 0.79, g26: 0.2, none: 0.01 }).accepted, false);
    assert.equal(gate({ g24: 0.5, g26: 0.5 }).accepted, false);
    assert.equal(gate({ none: 0.95, g24: 0.05 }).accepted, false);
    assert.equal(gate({}).accepted, false);
  });
});

describe('collect', () => {
  const e = (o) => ({ goal: 'month back', url: '/attendance', by: 'none', shortlist: SHORT, ...o });
  it('keeps distinct model-eligible short lists once, drops rule picks and singletons', () => {
    const cases = collectCases([e(), e(), e({ by: 'rule' }), e({ shortlist: SHORT.slice(0, 1) }), e({ goal: 'forward', by: 'laya' })]);
    assert.equal(cases.length, 2);
    assert.deepEqual(cases.map((c) => c.goal), ['month back', 'forward']);
    assert.equal(cases[0].gold, null);
  });
  it('old logs without `disabled` read as enabled', () => {
    const [c] = collectCases([e({ shortlist: [{ id: 'a', role: 'link', name: 'X' }, { id: 'b', role: 'link', name: 'Y' }] })]);
    assert.equal(c.shortlist[0].disabled, false);
  });
});

describe('run: same request through both providers', () => {
  it('sends identical state/questions, applies one gate, sums Jev usage', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push({ url, body, auth: opts.headers.authorization });
      const jev = url === JEV_URL;
      const probabilities = jev ? { g24: 0.9, g26: 0.05, none: 0.05 } : { g24: 0.6, g26: 0.3, none: 0.1 };
      return { ok: true, status: 200, json: async () => ({ answers: { target: { probabilities, ...(jev ? { confidence: 0.85 } : {}) } }, ...(jev ? { usage: { input_tokens: 80, output_tokens: 5, cost: 0.0000034 } } : {}) }) };
    };
    const cases = [{ key: 'c1', goal: 'month back', url: '/attendance', shortlist: SHORT, gold: 'g24' }];
    const rows = await runCases(cases, ['laya', 'jev'], { cfg: { url: 'http://laya.test', model: 'english', jevModel: 'typesafe/jev-1.13' }, env: { OPENROUTER_API_KEY: KEY }, fetchImpl });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.state, calls[1].body.state);
    assert.deepEqual(calls[0].body.questions, calls[1].body.questions);
    assert.equal(calls[0].auth, undefined);
    const { laya, jev } = rows[0].byProvider;
    assert.equal(laya.label, 'g24'); assert.equal(laya.accepted, false);
    assert.equal(jev.label, 'g24'); assert.equal(jev.accepted, true); assert.equal(jev.confidence, 0.85);
    const sl = summarize(rows, 'laya'), sj = summarize(rows, 'jev');
    assert.equal(sl.top1Correct, 1); assert.equal(sl.accepted, 0); assert.equal(sl.costUsd, null);
    assert.equal(sj.acceptedCorrect, 1); assert.equal(sj.wrongAccepted, 0); assert.equal(sj.inputTokens, 80); assert.equal(sj.costUsd, 0.0000034);
    assert.ok(!JSON.stringify(rows).includes(KEY));
  });
  it('a provider error is recorded per case, not fatal', async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 429, message: 'rate limited' } }) });
    const rows = await runCases([{ key: 'c1', goal: 'g', url: '/', shortlist: SHORT, gold: null }], ['jev'], { cfg: {}, env: { OPENROUTER_API_KEY: KEY }, fetchImpl });
    assert.equal(rows[0].byProvider.jev.ok, false);
    assert.match(rows[0].byProvider.jev.error, /^http 429/);
    assert.equal(summarize(rows, 'jev').errors, 1);
  });
});
