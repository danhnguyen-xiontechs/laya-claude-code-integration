// Run: node --test .claude/skills/skills-router/tests/route.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadCatalog } from '../scripts/catalog.mjs';
import { hasPrUrl, topExtensions } from '../scripts/context.mjs';
import {
  bm25, buildIndex, decisionRequest, explicitAllowed, finalize, mentions, overlaps, pickProvider, route, sameJob, shortlist, stem, tokenize, whyPhrase,
} from '../scripts/route.mjs';
import { fakeProvider, fixture } from './helpers.mjs';

const fx = fixture();
const catalog = loadCatalog({ root: fx.root, home: fx.home, useCache: false, builtinFiles: fx.builtinFiles });
const entries = catalog.entries;
const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
const context = { git_branch: 'main', working_tree_dirty: false, changed_extensions: [], bmad_output_artifacts: 0, pr_url_in_query: false };
const run = (query, opts = {}) => route({ query, root: fx.root, catalog, context, ...opts });

describe('text', () => {
  it('stems and drops stop words, keeps non-English words', () => {
    assert.equal(stem('reviews'), 'review');
    assert.equal(stem('reviewing'), 'review');
    assert.equal(stem('stories'), 'story');
    assert.deepEqual(tokenize('Please review the PRs!'), ['review', 'pr']);
    assert.deepEqual(tokenize('review lại giúp tôi'), ['review', 'lại', 'giúp', 'tôi']);
  });

  it('picks the description clause that matches the query as the why', () => {
    assert.equal(whyPhrase(byName['pdf-tools'], 'fill a pdf form'), 'Read, merge and split PDF files, fill PDF forms and extract tables');
  });
});

describe('BM25 shortlist', () => {
  it('ranks the entry whose name and description match first', () => {
    const top = bm25(buildIndex(entries), 'merge two PDF files')[0];
    assert.equal(top.entry.name, 'pdf-tools');
    const s = shortlist(entries, 'deploy the app to staging');
    assert.equal(s[0].entry.name, 'deploy-app');
    assert.ok(s.length <= 8);
    assert.ok(s.every((r) => r.score > 0));
  });

  it('caps k at 8 and drops zero scores', () => {
    assert.ok(shortlist(entries, 'review pull request code', 50).length <= 8);
    assert.deepEqual(shortlist(entries, 'zzz qqq'), []);
  });

  it('hides explicit-only entries unless named or clearly asked for', () => {
    const plain = shortlist(entries, 'review this pull request').map((r) => r.entry.name);
    assert.ok(plain.includes('review-pr'));
    assert.ok(!plain.includes('review-pr-jev-classify'));
    assert.ok(mentions('/review-pr-jev-classify 123', byName['review-pr-jev-classify']));
    assert.ok(mentions('run review-pr-jev-classify on it', byName['review-pr-jev-classify']));
    assert.ok(!mentions('review pr jev', byName['review-pr-jev-classify']));
    assert.ok(explicitAllowed('A/B jev on PR severity: review and classify', byName['review-pr-jev-classify'], entries));
    assert.ok(!explicitAllowed('review this PR with jev', byName['review-pr-jev-classify'], entries), 'rare "classify" missing');
    const named = shortlist(entries, '/review-pr-jev-classify https://github.com/o/r/pull/1');
    assert.equal(named[0].entry.name, 'review-pr-jev-classify');
    assert.equal(named[0].mentioned, true);
    assert.ok(!shortlist(entries, 'what is on my calendar this morning').some((r) => r.entry.name === 'morning-brief'));
    assert.ok(shortlist(entries, 'show me my morning brief').some((r) => r.entry.name === 'morning-brief'), 'all name words = an explicit ask');
  });
});

describe('decision request', () => {
  it('has a choice over the shortlist + none, one gate and fit nouls on the top 3', () => {
    const s = shortlist(entries, 'review this pull request');
    const req = decisionRequest('review this pull request', s, context);
    assert.deepEqual(Object.keys(req.questions.which.criteria), [...s.map((r) => r.entry.id), 'none']);
    assert.equal(req.questions.gate.type, 'noul');
    assert.deepEqual(Object.keys(req.questions).filter((k) => k.startsWith('fit_')), ['fit_0', 'fit_1', 'fit_2'].slice(0, Math.min(3, s.length)));
    assert.equal(req.state.candidates.length, Math.min(3, s.length));
    assert.deepEqual(req.state.repo, context);
  });
});

describe('finalize (abstain / gate logic)', () => {
  const sl = [{ id: 'a', score: 9, mentioned: false }, { id: 'b', score: 5, mentioned: false }, { id: 'c', score: 1, mentioned: false }];
  const provider = (over = {}) => ({ mode: 'provider', shortlist: sl, ranking: [{ id: 'a', p: 0.6 }, { id: 'b', p: 0.3 }, { id: 'none', p: 0.1 }], gate: 0.8, fits: { a: 0.7, b: 0.5, c: 0.1 }, ...over });

  it('suggests the top choice with alternatives when gate and fit pass', () => {
    const f = finalize(provider());
    assert.equal(f.abstain, false);
    assert.equal(f.primaryId, 'a');
    assert.deepEqual(f.alternativeIds, ['b']);
    assert.equal(f.confidence, 0.6);
    assert.equal(f.fit, 0.7);
  });

  it('abstains on a low gate, a low fit, or none ranked first', () => {
    assert.deepEqual(finalize(provider({ gate: 0.1 })).reasons, ['gate']);
    assert.deepEqual(finalize(provider({ fits: { a: 0.1 } })).reasons, ['fit']);
    const noneFirst = provider({ ranking: [{ id: 'none', p: 0.5 }, { id: 'a', p: 0.4 }] });
    assert.deepEqual(finalize(noneFirst).reasons, ['none-first']);
    assert.equal(finalize(noneFirst, { noneAbstain: false }).abstain, false);
    assert.equal(finalize(provider({ gate: 0.1 }), { gateMin: 0.05 }).abstain, false);
  });

  it('bm25-only abstains under the score floor, and a named entry always wins', () => {
    assert.equal(finalize({ mode: 'bm25', shortlist: sl }, { bm25Min: 10 }).abstain, true);
    const f = finalize({ mode: 'bm25', shortlist: sl }, { bm25Min: 3 });
    assert.equal(f.primaryId, 'a');
    assert.equal(f.confidence, Number((9 / 14).toFixed(4)));
    const named = [{ id: 'z', score: 0.5, mentioned: true }, ...sl];
    assert.equal(finalize({ mode: 'bm25', shortlist: named }, { bm25Min: 10 }).primaryId, 'z');
    assert.equal(finalize(provider({ shortlist: named, gate: 0 })).primaryId, 'z');
  });
});

describe('overlaps', () => {
  it('detects candidates that do the same job and says how each differs', () => {
    assert.ok(sameJob(byName['review-pr'], byName['review-pr-jev-classify']));
    assert.ok(!sameJob(byName['pdf-tools'], byName['deploy-app']));
    const o = overlaps([byName['review-pr'], byName['review-pr-jev-classify'], byName['pdf-tools']]);
    assert.deepEqual(o.map((x) => x.id), ['review-pr', 'review-pr-jev-classify']);
    assert.match(o[1].differs, /^\[explicit only\]/);
    assert.ok(o.every((x) => x.differs.length > 0 && x.invocation.startsWith('/')));
    assert.deepEqual(overlaps([byName['pdf-tools'], byName['deploy-app']]), []);
  });
});

describe('route', () => {
  it('bm25-only answers with a lower-confidence label and sends nothing', async () => {
    const r = await run('merge these PDF files and fill the form', { provider: 'none', thresholds: { bm25Min: 1 } });
    assert.equal(r.suggestion.id, 'pdf-tools');
    assert.equal(r.mode, 'bm25-only');
    assert.equal(r.confidenceLabel, 'low (bm25-only)');
    assert.equal(r.suggestion.invocation, '/pdf-tools');
    assert.match(r.suggestion.why, /PDF/);
    assert.equal(r.suggestion.source, 'user');
  });

  it('with a provider: one call, suggestion + alternatives, overlaps, cost', async () => {
    const fake = fakeProvider({ gate: 0.9, fits: [0.8, 0.6, 0.2] });
    const r = await run('review this pull request against our rules', { provider: 'laya', fetchImpl: fake.fetchImpl });
    assert.equal(fake.calls.length, 1);
    assert.match(fake.calls[0].url, /localhost:8000\/v1\/systemone$/);
    assert.equal(r.suggestion.id, fake.calls[0].body.state.candidates[0].id);
    assert.ok(r.alternatives.length <= 2);
    assert.equal(r.abstain, false);
    assert.equal(r.gate, 0.9);
    assert.equal(r.cost, 0.00002);
    assert.ok(['high', 'medium', 'low'].includes(r.confidenceLabel));
  });

  it('abstains when the gate says no skill is needed', async () => {
    const fake = fakeProvider({ gate: 0.05 });
    const r = await run('review: what does this regex mean', { provider: 'laya', fetchImpl: fake.fetchImpl });
    assert.equal(r.suggestion, null);
    assert.equal(r.abstain, true);
    assert.deepEqual(r.abstainReasons, ['gate']);
    assert.ok(r.closest.length >= 1);
  });

  it('never fails: provider errors, empty queries and thrown errors give suggestion null + error', async () => {
    const bad = await run('review this pull request', { provider: 'laya', fetchImpl: fakeProvider({ status: 500 }).fetchImpl });
    assert.equal(bad.suggestion, null);
    assert.match(bad.error, /http 500/);
    const thrown = await run('review this pull request', { provider: 'laya', fetchImpl: fakeProvider({ throws: 'ECONNREFUSED' }).fetchImpl });
    assert.equal(thrown.suggestion, null);
    assert.match(thrown.error, /ECONNREFUSED/);
    const empty = await run('   ', { provider: 'none' });
    assert.equal(empty.error, 'empty query');
    const broken = await route({ query: 'x', catalog: { entries: null }, provider: 'none' });
    assert.equal(broken.suggestion, null);
    assert.ok(broken.error);
    const jevNoKey = await run('review this pull request', { provider: 'jev', env: {} });
    assert.equal(jevNoKey.error, 'OPENROUTER_API_KEY not set');
  });

  it('resolves the provider: flag > env > config, none allowed', () => {
    assert.equal(pickProvider('none', { provider: 'jev' }, {}), 'none');
    assert.equal(pickProvider(undefined, { provider: 'laya' }, { DECISION_PROVIDER: 'kev' }), 'kev');
    assert.equal(pickProvider(undefined, {}, {}), 'none');
    assert.throws(() => pickProvider('gpt', {}, {}));
  });
});

describe('context', () => {
  it('counts changed extensions and spots PR URLs', () => {
    assert.deepEqual(topExtensions(' M a.ts\n M b.ts\n?? c.md\nR  old.js -> new.cs\n'), [{ ext: '.ts', n: 2 }, { ext: '.cs', n: 1 }, { ext: '.md', n: 1 }]);
    assert.ok(hasPrUrl('look at https://github.com/o/r/pull/12 please'));
    assert.ok(hasPrUrl('https://dev.azure.com/org/p/_git/repo/pullrequest/5240'));
    assert.ok(!hasPrUrl('https://github.com/o/r/issues/12'));
  });
});
