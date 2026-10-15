// Tests for the Laya-vs-Jev provider switch (A/B copy). Run: node --test .claude/skills/review-pr-jev-classify/tests/jev.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { JEV_URL, decide, resolveProvider } from '../scripts/decision-provider.mjs';
import { loadConfig } from '../scripts/laya-severity.mjs';
import { classify, defaultLogPath, main as classifyMain } from '../scripts/classify-findings.mjs';

const KEY = 'sk-or-test-secret-123';
const SEV = { Critical: 0.05, Major: 0.8, Minor: 0.1, Suggestion: 0.05 };
const MERGE = { Blocked: 0.7, 'Eligible with suggestions': 0.2, Eligible: 0.1 };

/** One fake that answers both providers and records every request. */
function fakeBoth() {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    if (url.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    const body = JSON.parse(opts.body);
    calls.push({ url, headers: opts.headers, body });
    const name = Object.keys(body.questions)[0];
    const probabilities = name === 'merge_gate' ? MERGE : SEV;
    const jev = url === JEV_URL;
    const answer = jev ? { type: 'choice', choice: Object.keys(probabilities)[1], confidence: 0.6, probabilities } : { probabilities };
    return {
      ok: true, status: 200,
      json: async () => ({ ...(jev ? { model: 'typesafe/jev-1.13-20260917', provider: 'TypeSafe' } : {}), answers: { [name]: answer }, ...(jev ? { usage: { input_tokens: 100, output_tokens: 7, cost: 0.0000042 } } : {}) }),
    };
  };
  return { fetchImpl, calls };
}

const F = (id, severity) => ({ id, severity, file: 'src/a.ts', line: 3, rule: 'Bug', issue: `null deref in ${id}`, evidence: 'x.y when x is null', impact: 'crash' });
const cfg = (o = {}) => ({ url: 'http://laya.test', model: 'english', mode: 'shadow', threshold: null, warning: null, mergeBlockThreshold: 0.29, jevModel: 'typesafe/jev-1.13', ...o });

describe('provider switch', () => {
  it('defaults to laya', () => {
    assert.equal(resolveProvider({ env: {} }), 'laya');
    assert.equal(loadConfig({ env: {} }).provider, 'laya');
  });
  it('flag > XT_REVIEW_PR_DECIDER > DECISION_PROVIDER > config', () => {
    assert.equal(loadConfig({ env: { DECISION_PROVIDER: 'jev' } }).provider, 'jev');
    assert.equal(loadConfig({ env: { DECISION_PROVIDER: 'jev', XT_REVIEW_PR_DECIDER: 'laya' } }).provider, 'laya');
    assert.equal(loadConfig({ env: { XT_REVIEW_PR_DECIDER: 'laya' }, overrides: { provider: 'jev' } }).provider, 'jev');
  });
  it('rejects unknown providers', () => {
    assert.throws(() => loadConfig({ env: {}, overrides: { provider: 'gpt' } }), /provider must be one of/);
  });
});

describe('decide: same request to both providers', () => {
  it('sends identical state and questions; Jev gets the key only in the header', async () => {
    const { fetchImpl, calls } = fakeBoth();
    const state = { rule: 'Bug', issue: 'i', evidence: 'e', impact: 'm' };
    const questions = { severity: { type: 'choice', instructions: 'How severe?', criteria: { A: 'a', B: 'b' } } };
    const env = { OPENROUTER_API_KEY: KEY };
    const l = await decide({ provider: 'laya', state, questions, laya: { url: 'http://laya.test' }, env, fetchImpl });
    const j = await decide({ provider: 'jev', state, questions, env, fetchImpl });
    assert.ok(l.ok && j.ok);
    assert.deepEqual(calls[0].body.state, calls[1].body.state);
    assert.deepEqual(calls[0].body.questions, calls[1].body.questions);
    assert.equal(calls[1].url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(calls[1].body.model, 'typesafe/jev-1.13');
    assert.equal(calls[1].headers.authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].headers.authorization, undefined);
    assert.ok(!JSON.stringify(calls[1].body).includes(KEY));
    assert.deepEqual(j.meta.usage, { input_tokens: 100, output_tokens: 7 });
    assert.equal(j.meta.cost, 0.0000042);
    assert.equal(j.meta.model, 'typesafe/jev-1.13-20260917');
    assert.equal(j.answers.severity.confidence, 0.6);
    assert.ok(!JSON.stringify(j).includes(KEY));
  });
  it('without a key, Jev is unavailable and no request is made', async () => {
    const { fetchImpl, calls } = fakeBoth();
    const r = await decide({ provider: 'jev', state: {}, questions: {}, env: {}, fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.error, /OPENROUTER_API_KEY not set/);
    assert.equal(calls.length, 0);
  });
  it('an HTTP error keeps only the code and never the key', async () => {
    const fetchImpl = async () => ({ ok: false, status: 402, json: async () => ({ error: { code: 402, message: 'Insufficient credits' } }) });
    const r = await decide({ provider: 'jev', state: {}, questions: {}, env: { OPENROUTER_API_KEY: KEY }, fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.error, /^http 402/);
    assert.ok(!r.error.includes(KEY));
  });
});

describe('classify with provider jev', () => {
  it('asks Jev the same severity and merge questions as Laya; Claude severities unchanged', async () => {
    const findings = [F('F1', 'Major'), F('F2', 'Minor')];
    const env = { OPENROUTER_API_KEY: KEY };
    const a = fakeBoth(), b = fakeBoth();
    const laya = await classify({ findings, cfg: cfg({ provider: 'laya' }), fetchImpl: a.fetchImpl, env });
    const jev = await classify({ findings, cfg: cfg({ provider: 'jev' }), fetchImpl: b.fetchImpl, env });
    const pick = (calls) => calls.map((c) => ({ state: c.body.state, questions: c.body.questions })).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    assert.deepEqual(pick(a.calls), pick(b.calls));
    assert.equal(jev.log.provider, 'jev');
    assert.equal(laya.log.provider, 'laya');
    assert.deepEqual(jev.log.results.map((r) => r.claude), ['Major', 'Minor']);
    assert.equal(jev.log.results[0].laya.label, 'Major');
    assert.equal(jev.log.results[0].laya.confidence, 0.8); // top probability, same metric as Laya
    assert.equal(jev.log.results[0].laya.nativeConfidence, 0.6);
    assert.equal(jev.log.results[0].laya.meta.provider, 'jev');
    assert.equal(jev.log.summary.inputTokens, 300); // 2 findings + 1 merge call
    assert.equal(jev.log.summary.costUsd, 0.0000126);
    assert.equal(laya.log.summary.costUsd, null);
    assert.match(jev.lines.at(-1), /^jev: mode=shadow findings=2 agree=1 differs=1 .* tokens=300\/21 cost=\$0\.0000126$/);
    assert.ok(jev.lines.some((l) => /^jev merge: Blocked .*Jev top: Blocked/.test(l)));
    assert.ok(!JSON.stringify(jev.log).includes(KEY));
  });
  it('without a key: unavailable, Claude kept', async () => {
    const res = await classify({ findings: [F('F1', 'Major')], cfg: cfg({ provider: 'jev' }), fetchImpl: fakeBoth().fetchImpl, env: {} });
    assert.equal(res.log.summary.server, 'down');
    assert.match(res.lines[0], /^jev: unavailable \(OpenRouter \(OPENROUTER_API_KEY not set\)\) — Claude severities kept; add "Jev check unavailable"/);
  });
  it('main writes pr-<id>.jev.json next to pr-<id>.laya.json', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpl-jev-'));
    const file = path.join(dir, 'pr-7.findings.json');
    fs.writeFileSync(file, JSON.stringify({ findings: [F('F1', 'Major')] }));
    assert.equal(defaultLogPath(file, 'jev'), path.join(dir, 'pr-7.jev.json'));
    const out = [];
    const env = { OPENROUTER_API_KEY: KEY };
    assert.equal(await classifyMain(['--findings', file, '--provider', 'jev'], { log: (l) => out.push(l), env, fetchImpl: fakeBoth().fetchImpl }), 0);
    assert.equal(await classifyMain(['--findings', file], { log: (l) => out.push(l), env, fetchImpl: fakeBoth().fetchImpl }), 0);
    assert.ok(fs.existsSync(path.join(dir, 'pr-7.jev.json')));
    assert.ok(fs.existsSync(path.join(dir, 'pr-7.laya.json')));
    assert.ok(!fs.readFileSync(path.join(dir, 'pr-7.jev.json'), 'utf8').includes(KEY));
  });
});
