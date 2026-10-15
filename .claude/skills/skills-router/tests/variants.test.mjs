// Run: node --test .claude/skills/skills-router/tests/variants.test.mjs
// Variant shortlisting, agreement gating and self-consistency.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agreementSplit, withRounds } from '../scripts/eval.mjs';
import { asksForVariant, combineRuns, finalize, route, shortlist, shuffled, variantTokens } from '../scripts/route.mjs';
import { fakeProvider } from './helpers.mjs';

const E = (name, description, explicitOnly = false) => ({ id: name, name, kind: 'skill', source: 'project', description, head: '', invocation: `/${name}`, explicitOnly, path: name });
const TAIL = 'Trigger only on an explicit request.';
// A catalog shaped like this repository's: plain skills, their explicit-only provider variants, and others.
const catalog = [
  E('review-pr', 'Review a pull request (GitHub, Azure DevOps, GitLab) against the project rules and report findings by severity, with a verdict and a merge assessment. Plain PR reviews go here; the -laya-classify and -jev-classify variants run only on an explicit request.'),
  E('review-pr-laya-classify', `Laya variant of review-pr: same PR review, plus an independent severity check by the local Laya model (shadow log, calibrated confidence). ${TAIL}`, true),
  E('review-pr-jev-classify', `A/B experiment copy of review-pr-laya-classify with a decision-provider switch for the independent severity check: Laya (default) or TypeSafe Jev via OpenRouter. ${TAIL}`, true),
  E('web-test', 'End-to-end manual-style web testing of a ticket against a chosen environment: derives test cases, drives a real browser per role, writes an HTML report with screenshots.'),
  E('web-test-laya-gate', `Laya variant of web-test: a write-action gate (keyword rule plus optional local Laya decision model) that cross-checks which planned steps write data, plus a network recorder and audit. ${TAIL}`, true),
  E('web-test-laya-wait', `Laya variant of web-test: page wait and screen classification with an optional local Laya decision model. ${TAIL}`, true),
  E('web-test-jev-gate', `Jev variant of web-test-laya-gate: a write-action gate with an optional hosted Jev decision model, plus a network recorder and audit. ${TAIL}`, true),
  E('web-test-jev-wait', `Jev variant of web-test-laya-wait: page wait and screen classification with an optional hosted Jev decision model. ${TAIL}`, true),
  E('code-review', 'Review the current diff, a branch or a pull request for correctness bugs.'),
  E('pdf-tools', 'Read, merge and split PDF files, fill PDF forms and extract tables.'),
  E('deploy-app', 'Deploy the app to staging or production.'),
  E('laya-router', 'Local decision routing with Laya: task classification, complexity estimation, model escalation hints.'),
];
const ids = (q) => shortlist(catalog, q).map((r) => r.entry.id);
const variants = (q) => ids(q).filter((id) => catalog.find((e) => e.id === id).explicitOnly);

describe('variant tokens', () => {
  it('diffs a variant against its base skill', () => {
    const v = variantTokens(catalog[1], catalog);
    assert.equal(v.base, 'review-pr');
    assert.deepEqual(v.name, ['laya', 'classify']);
    assert.ok(v.desc.includes('severity check'), 'a word pair new to the base counts');
    assert.ok(!v.desc.includes('severity'), 'a base word never counts');
    assert.ok(!v.desc.includes('review') && !v.desc.includes('variant'), 'generic words never count');
    assert.equal(variantTokens(catalog[6], catalog).base, 'web-test');
  });

  it('does not count the variant names a base description mentions as base words', () => {
    // review-pr's description names "-laya-classify", yet "laya" still sets the jev variant's description apart.
    const small = [catalog[0], E('review-pr-laya-classify', `Variant with a local severity model. ${TAIL}`, true), catalog[2]];
    assert.ok(variantTokens(small[2], small).desc.includes('laya'));
  });

  it('falls back to the shared name prefix when there is no base entry', () => {
    const noBase = catalog.filter((e) => e.id !== 'review-pr');
    const v = variantTokens(noBase.find((e) => e.id === 'review-pr-laya-classify'), noBase);
    assert.equal(v.base, 'review-pr');
    assert.deepEqual(v.name, ['laya', 'classify']);
  });

  it('marks provider tokens shared by 3+ names as a family', () => {
    assert.deepEqual(variantTokens(catalog[7], catalog).family, ['jev']);
    assert.deepEqual(variantTokens(catalog[4], catalog).family, ['laya']);
  });
});

describe('variant shortlisting', () => {
  it('shortlists the variant a prompt asks for', () => {
    assert.ok(ids('review this PR and also run the Laya severity check on each finding').includes('review-pr-laya-classify'));
    assert.ok(ids('review PR 3377 and A/B Jev against Laya on the severities').includes('review-pr-jev-classify'));
    assert.ok(ids('test ticket 40227 on local and gate every step that writes data using Jev').includes('web-test-jev-gate'));
    assert.ok(ids('run the ticket 51276 test with the Laya page wait').includes('web-test-laya-wait'));
    // a provider word plus a word of the base's name, in any language
    assert.ok(ids('test ticket 12983, dùng Jev để đợi trang tải xong').includes('web-test-jev-wait'));
  });

  it('hard negatives: plain requests get the base skill, never a variant', () => {
    for (const q of [
      'review this PR',
      'review PR https://github.com/acme/shop/pull/1204 against our rules and give me a verdict',
      'give me a merge assessment, Blocked or Eligible, for PR 2290',
      'check the severity of the findings in this PR review',
      'test ticket 33018 on staging and wait for the page to load before each step',
      'QA ticket 47750 on staging and gate the release on the report',
      'classify these log lines by severity',
      'how do I restart the laya server',
    ]) assert.deepEqual(variants(q), [], q);
    assert.equal(ids('review this PR')[0], 'review-pr');
    assert.equal(ids('test ticket 33018 on staging and wait for the page to load before each step')[0], 'web-test');
  });

  it('a single provider word is not enough without the base or a second distinguishing word', () => {
    assert.equal(asksForVariant('what is Jev', catalog[7], catalog), false);
    assert.equal(asksForVariant('Jev test run', catalog[7], catalog), true);
  });
});

const prov = (o = {}) => ({
  mode: 'provider',
  shortlist: [{ id: 'a', score: 9, mentioned: false }, { id: 'b', score: 4, mentioned: false }],
  ranking: [{ id: 'b', p: 0.9 }, { id: 'a', p: 0.1 }, { id: 'none', p: 0 }],
  gate: 0.9, fits: { a: 0.8, b: 0.8 }, ...o,
});

describe('agreement gating', () => {
  it('reports whether BM25 and the engine agree; off changes nothing', () => {
    const f = finalize(prov());
    assert.equal(f.agree, false);
    assert.equal(f.primaryId, 'b');
    assert.equal(f.low, false);
    assert.equal(finalize(prov({ ranking: [{ id: 'a', p: 1 }, { id: 'b', p: 0 }] })).agree, true);
  });

  it('abstain mode abstains on disagreement only', () => {
    assert.deepEqual(finalize(prov(), { agreement: 'abstain' }).reasons, ['disagree']);
    assert.equal(finalize(prov({ ranking: [{ id: 'a', p: 1 }, { id: 'b', p: 0 }] }), { agreement: 'abstain' }).abstain, false);
  });

  it('low mode keeps the engine pick, puts BM25 top-1 first among alternatives', () => {
    const three = prov({ shortlist: [{ id: 'a', score: 9 }, { id: 'b', score: 4 }, { id: 'c', score: 3 }], ranking: [{ id: 'b', p: 0.9 }, { id: 'c', p: 0.08 }, { id: 'a', p: 0.02 }] });
    const f = finalize(three, { agreement: 'low' });
    assert.equal(f.primaryId, 'b');
    assert.deepEqual(f.alternativeIds, ['a', 'c']);
    assert.equal(f.low, true);
  });

  it('a named entry is never gated', () => {
    const named = prov({ shortlist: [{ id: 'a', score: 9, mentioned: true }, { id: 'b', score: 4 }] });
    const f = finalize(named, { agreement: 'abstain' });
    assert.equal(f.primaryId, 'a');
    assert.equal(f.abstain, false);
  });

  it('route labels a disagreement low in low mode', async () => {
    // The fake engine prefers its first criterion; give BM25 a different top-1 through a choice map.
    const fake = fakeProvider({ choice: { 'pdf-tools': 0.2, 'deploy-app': 0.7, none: 0.1 } });
    const r = await route({ query: 'merge PDF files then deploy', catalog: { entries: catalog }, provider: 'laya', fetchImpl: fake.fetchImpl, context: {}, thresholds: { agreement: 'low' } });
    assert.equal(r.agreement.agree, false);
    assert.equal(r.confidenceLabel, 'low');
    assert.equal(r.suggestion.id, 'deploy-app');
    assert.equal(r.alternatives[0].id, r.agreement.bm25Top);
  });
});

describe('self-consistency', () => {
  it('shuffles deterministically per query and round; round 0 keeps the order', () => {
    const xs = ['a', 'b', 'c', 'd', 'e', 'f'];
    assert.deepEqual(shuffled(xs, 'q', 0), xs);
    assert.deepEqual(shuffled(xs, 'q', 1), shuffled(xs, 'q', 1));
    assert.deepEqual([...shuffled(xs, 'q', 2)].sort(), xs);
    assert.ok([1, 2, 3, 4].some((i) => shuffled(xs, 'q', i).join() !== xs.join()));
  });

  it('combines rounds by votes; stability is the top answer share', () => {
    const c = combineRuns([
      { ranking: [{ id: 'a', p: 1 }, { id: 'b', p: 0 }], gate: 0.8, fits: { a: 0.9 } },
      { ranking: [{ id: 'b', p: 0.6 }, { id: 'a', p: 0.4 }], gate: 0.6, fits: { a: 0.7 } },
      { ranking: [{ id: 'a', p: 0.9 }, { id: 'b', p: 0.1 }], gate: 0.7, fits: { b: 0.2 } },
    ]);
    assert.equal(c.ranking[0].id, 'a');
    assert.equal(c.stability, 0.6667);
    assert.deepEqual(c.votes, { a: 2, b: 1 });
    assert.equal(c.gate, 0.7);
    assert.deepEqual(c.fits, { a: 0.8, b: 0.2 });
    assert.equal(combineRuns([{ ranking: [] }]), null);
  });

  it('stabilityMin abstains on an unstable answer', () => {
    assert.deepEqual(finalize(prov({ stability: 0.67 }), { stabilityMin: 1 }).reasons, ['unstable']);
    assert.equal(finalize(prov({ stability: 1 }), { stabilityMin: 1 }).abstain, false);
  });

  it('route makes k calls with shuffled orders, keeps every round, sums the cost', async () => {
    const fake = fakeProvider({ fits: [0.9, 0.5, 0.1] });
    const q = 'review this pull request against the project rules';
    const r = await route({ query: q, catalog: { entries: catalog }, provider: 'laya', fetchImpl: fake.fetchImpl, context: {}, consistency: 3 });
    assert.equal(fake.calls.length, 3);
    const orders = fake.calls.map((c) => Object.keys(c.body.questions.which.criteria).join());
    assert.equal(orders[0], [...r.shortlist.map((s) => s.id), 'none'].join(), 'round 0 is in BM25 order');
    assert.equal(r.raw.runs.length, 3);
    assert.equal(r.cost, 0.00006);
    assert.equal(r.consistency.rounds, 3);
    // fit answers follow each round's candidate order, so every round's fits name the shown candidate
    fake.calls.forEach((c, i) => assert.equal(r.raw.runs[i].fits[c.body.state.candidates[0].id], 0.9));
    assert.equal(typeof r.suggestion.stability, 'number');
  });

  it('one round behaves as before (no runs, no stability)', async () => {
    const fake = fakeProvider();
    const r = await route({ query: 'review this pull request', catalog: { entries: catalog }, provider: 'laya', fetchImpl: fake.fetchImpl, context: {} });
    assert.equal(fake.calls.length, 1);
    assert.equal(r.raw.runs, undefined);
    assert.equal(r.consistency, undefined);
  });
});

describe('eval helpers', () => {
  const runs = [
    { ranking: [{ id: 'b', p: 1 }, { id: 'a', p: 0 }], gate: 0.9, fits: { a: 0.8, b: 0.8 }, latencyMs: 500, cost: 0.1 },
    { ranking: [{ id: 'a', p: 1 }, { id: 'b', p: 0 }], gate: 0.9, fits: { a: 0.8, b: 0.8 }, latencyMs: 700, cost: 0.1 },
    { ranking: [{ id: 'a', p: 1 }, { id: 'b', p: 0 }], gate: 0.9, fits: { a: 0.8, b: 0.8 }, latencyMs: 600, cost: 0.1 },
  ];
  const row = { covered: true, expected: 'a', raw: { ...prov(), ...combineRuns(runs), runs }, latencyMs: 710, cost: 0.3 };

  it('withRounds re-scores the first k rounds', () => {
    const [one] = withRounds([row], 1);
    assert.equal(one.raw.ranking[0].id, 'b');
    assert.equal(one.raw.runs, undefined);
    assert.equal(one.raw.stability, undefined);
    assert.equal(one.latencyMs, 500);
    assert.equal(one.cost, 0.1);
    const [three] = withRounds([row], 3);
    assert.equal(three.raw.ranking[0].id, 'a');
    assert.equal(three.raw.stability, 0.6667);
    assert.equal(three.latencyMs, 700);
  });

  it('agreementSplit separates agreeing and disagreeing answers', () => {
    const rows = [
      { covered: true, expected: 'a', raw: prov({ ranking: [{ id: 'a', p: 1 }] }) }, // agree, right
      { covered: true, expected: 'a', raw: prov() }, // disagree, wrong, BM25 right
      { covered: true, expected: null, raw: prov() }, // disagree, needless
    ];
    const s = agreementSplit(rows);
    assert.deepEqual({ n: s.agree.n, right: s.agree.right }, { n: 1, right: 1 });
    assert.deepEqual({ n: s.disagree.n, wrong: s.disagree.wrong, needless: s.disagree.needless, either: s.disagree.eitherRight }, { n: 2, wrong: 1, needless: 1, either: 1 });
  });
});
