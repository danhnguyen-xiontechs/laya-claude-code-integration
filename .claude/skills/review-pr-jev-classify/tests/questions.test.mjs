// Tests for the yes/no questions (introduced_by_pr, already_raised), the stable-disagreement policy,
// project rule ids in the `rules` column and the two-provider execution-log header.
// Run: node --test .claude/skills/review-pr-jev-classify/tests/questions.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  annotatePatch, bm25, citedLineStatus, pickStableRechecks, projectRuleSeverities, projectRuleSeverity,
  reorderQuestion, shuffledOrders, similarThreads, stableFlag, summarizeStability, threadPassages, tokenize,
} from '../scripts/finding-questions.mjs';
import { LABELS, buildQuestion, loadConfig } from '../scripts/laya-severity.mjs';
import { classify, loadPrContext } from '../scripts/classify-findings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rpq-'));

const PATCH = [
  'diff --git a/src/old.cs b/src/old.cs',
  'index 1..2 100644',
  '--- a/src/old.cs',
  '+++ b/src/old.cs',
  '@@ -10,4 +10,5 @@ class A',
  ' context10',
  '-removed11',
  '+changed11',
  '+added12',
  ' context13',
  ' context14',
  '@@ -30,2 +31,3 @@',
  ' context31',
  '+inserted32',
  ' context33',
  'diff --git a/src/new.cs b/src/new.cs',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/new.cs',
  '@@ -0,0 +1,2 @@',
  '+line1',
  '+line2',
].join('\n');

describe('patch line status (introduced_by_pr input)', () => {
  const p = annotatePatch(PATCH);
  const st = (file, line, endLine) => citedLineStatus(p, { file, line, endLine }).kind;
  it('added / modified / context / unchanged / new file / not in PR', () => {
    assert.equal(st('src/old.cs', 11), 'modified'); // '+' in a block that also removes
    assert.equal(st('src/old.cs', 12), 'modified'); // same change block
    assert.equal(st('src/old.cs', 32), 'added');
    assert.equal(st('src/old.cs', 10), 'context');
    assert.equal(st('src/old.cs', 20), 'unchanged');
    assert.equal(st('src/old.cs', 20, 32), 'added'); // range: strongest kind wins
    assert.equal(st('/src/new.cs', 2), 'added');
    assert.equal(st('src/other.cs', 5), 'file-not-in-pr');
    assert.match(citedLineStatus(p, { file: 'src/new.cs', line: 1 }).text, /new file added by this PR/);
    assert.match(citedLineStatus(p, { file: 'src/old.cs', line: 20 }).text, /existed before this PR/);
  });
});

describe('already_raised: BM25 over thread passages', () => {
  const threads = [
    { id: 't1', status: 'active', file: null, line: null, comments: [{ body: `## Summary\n\n- **File:** Service.cs:50 **Rule:** AUTHZ Manager personnel number comes from the query string, any user can read another manager's team.\n\n- **File:** Service.cs:77 **Rule:** TH-04 one D365 call per report inside a foreach loop instead of BatchRequestBuilder.` }] },
    { id: 't2', status: 'closed', file: 'Readme.md', line: 3, comments: [{ body: 'Typo in the readme title.' }] },
    { id: 't3', status: 'active', file: null, line: null, comments: [{ body: `- **File:** Service.cs:77 **Rule:** TH-04 one D365 call per report inside a foreach loop instead of BatchRequestBuilder.` }] },
  ];
  it('tokenizes identifiers whole and split', () => {
    assert.deepEqual(tokenize('ManagerPersonnelNumber x_y'), ['managerpersonnelnumber', 'manager', 'personnel', 'number', 'x_y']);
  });
  it('splits long comments into passages and ranks the matching one first; dedupes repeats', () => {
    const ps = threadPassages(threads);
    assert.ok(ps.length >= 3);
    const f = { rule: 'TH-04', issue: 'D365 call per direct report inside foreach', evidence: 'QueryRecordsAsync in loop', file: 'src/Service.cs', line: 77 };
    const top = similarThreads(f, ps, { n: 3, chars: 60 });
    assert.match(top[0].text, /TH-04/);
    assert.ok(top[0].text.length <= 60);
    assert.equal(top.filter((x) => /TH-04/.test(x.text)).length, 1); // t1 and t3 passages are the same text
    assert.equal(bm25('completely unrelated words', ps).length, 0);
  });
});

describe('project rule ids (rules column)', () => {
  const RULES = [
    '# Rules', '## Rules (id — check — default severity)',
    '- AUTHZ user can read another worker\'s data — Critical',
    '- D-07 entity outside service — Critical',
    '- D-07 business service using worker service — Major',
    '- TH-02 / C-01 explicit Size — Major',
    '- TH-03 query without `$select` — Major',
    '- TEST-01 new method without tests — Minor',
    '- RATE new endpoint without rate limit — Minor',
    '- `CLAUDE.md` (primary)',
    '## Severity overrides',
    '- Critical: RATE, TH-01/04, D-07 entity.',
    '- Never below the default above; TEST-01 and DOC-01 are Major.',
  ].join('\n');
  const map = projectRuleSeverities(RULES);
  it('reads ids, slashes, overrides; skips conditional override items; keeps the highest default', () => {
    assert.equal(map.get('AUTHZ'), 'Critical');
    assert.equal(map.get('D-07'), 'Critical');
    assert.equal(map.get('C-01'), 'Major');
    assert.equal(map.get('RATE'), 'Critical'); // override
    assert.equal(map.get('TH-04'), 'Critical'); // TH-01/04 expanded
    assert.equal(map.get('TEST-01'), 'Major'); // "… are Major"
    assert.equal(map.get('DOC-01'), 'Major');
    assert.ok(!map.has('CLAUDE'));
  });
  it('matches a finding rule by id, else null (baseline is used)', () => {
    assert.equal(projectRuleSeverity({ rule: 'th-03' }, map), 'Major');
    assert.equal(projectRuleSeverity({ rule: 'TH-03 ($select)' }, map), 'Major');
    assert.equal(projectRuleSeverity({ rule: 'Bug' }, map), null);
    assert.equal(projectRuleSeverity({ rule: 'AUTHZ' }, new Map()), null);
  });
  it('classify logs the project severity and its source', async () => {
    const fetchImpl = async (url, o = {}) => (url.endsWith('/health') ? { ok: true, json: async () => ({}) } : { ok: true, json: async () => ({ answers: { [Object.keys(JSON.parse(o.body).questions)[0]]: { probabilities: { Major: 0.9, Minor: 0.1, Blocked: 1 } } } }) });
    const { log } = await classify({ findings: [{ id: 'F1', severity: 'Critical', rule: 'AUTHZ', issue: 'x' }, { id: 'F2', severity: 'Major', rule: 'Bug', issue: 'y' }], rulesText: RULES, cfg: { url: 'http://l', mode: 'shadow', threshold: null }, fetchImpl });
    assert.deepEqual(log.results.map((r) => [r.rules, r.rulesSource]), [['Critical', 'project'], ['Major', 'baseline']]);
    assert.equal(log.summary.rulesFromProject, 1);
  });
});

describe('shuffled orders and stability', () => {
  it('k distinct non-canonical orders, deterministic per seed', () => {
    const a = shuffledOrders('F1', 3);
    assert.equal(a.length, 3);
    assert.equal(new Set(a.map((o) => o.join())).size, 3);
    assert.ok(a.every((o) => o.join() !== LABELS.join() && [...o].sort().join() === [...LABELS].sort().join()));
    assert.deepEqual(shuffledOrders('F1', 3), a);
    assert.notDeepEqual(shuffledOrders('F2', 3), a);
  });
  it('reorders criteria without changing wording', () => {
    const q = buildQuestion();
    const r = reorderQuestion(q, ['Suggestion', 'Critical', 'Minor', 'Major']);
    assert.deepEqual(Object.keys(r.severity.criteria), ['Suggestion', 'Critical', 'Minor', 'Major']);
    assert.equal(r.severity.criteria.Major, q.severity.criteria.Major);
    assert.equal(r.severity.instructions, q.severity.instructions);
  });
  it('stable only when all k answered the same label', () => {
    const s = (l, p) => ({ label: l, probabilities: { [l]: p } });
    const o = [['Major', 'Minor', 'Critical', 'Suggestion']];
    assert.equal(summarizeStability([s('Major', 0.9), s('Major', 0.7), s('Major', 0.8)], [o[0], o[0], o[0]]).stable, true);
    assert.equal(summarizeStability([s('Major', 0.9), s('Minor', 0.7), s('Major', 0.8)], [o[0], o[0], o[0]]).stable, false);
    assert.equal(summarizeStability([s('Major', 0.9), null, s('Major', 0.8)], [o[0], o[0], o[0]]).stable, false);
    assert.equal(summarizeStability([s('Major', 0.9), s('Major', 0.7), s('Major', 0.8)], [o[0], o[0], o[0]]).meanP, 0.8);
  });
  it('flags only stable + differs + crosses the merge boundary', () => {
    const st = (label, stable = true) => ({ stable, label });
    assert.deepEqual(stableFlag('Minor', st('Major')), { wouldFlag: true, direction: 'up' });
    assert.deepEqual(stableFlag('Critical', st('Suggestion')), { wouldFlag: true, direction: 'down' });
    assert.equal(stableFlag('Minor', st('Major', false)).wouldFlag, false);
    assert.equal(stableFlag('Critical', st('Major')).wouldFlag, false); // same side
    assert.equal(stableFlag('Major', st('Major')).wouldFlag, false);
  });
  it('picks upward first, then mean probability, max 3, only in recheck', () => {
    const r = (id, direction, meanP) => ({ id, wouldFlag: true, direction, stability: { meanP } });
    const rows = [r('D1', 'down', 0.99), r('U1', 'up', 0.6), r('U2', 'up', 0.9), r('U3', 'up', 0.7), { id: 'X', wouldFlag: false }];
    assert.deepEqual([...pickStableRechecks(rows, { mode: 'recheck' })], ['U2', 'U3', 'U1']);
    assert.equal(pickStableRechecks(rows, { mode: 'shadow' }).size, 0);
    assert.deepEqual([...pickStableRechecks([r('D1', 'down', 0.5), r('U1', 'up', 0.1)], { mode: 'recheck' })], ['U1', 'D1']);
  });
});

describe('config: policy', () => {
  it('stable-disagreement runs recheck without a threshold; threshold policy still falls back', () => {
    const d = tmp();
    const c = loadConfig({ env: { XT_REVIEW_PR_LAYA: 'recheck', XT_REVIEW_PR_LAYA_POLICY: 'stable-disagreement', XT_REVIEW_PR_LAYA_K: '5' }, dir: d });
    assert.deepEqual([c.mode, c.policy, c.k, c.warning], ['recheck', 'stable-disagreement', 5, null]);
    assert.equal(loadConfig({ env: { XT_REVIEW_PR_LAYA: 'recheck' }, dir: d }).mode, 'shadow');
    assert.throws(() => loadConfig({ env: { XT_REVIEW_PR_LAYA_POLICY: 'vote' }, dir: d }), /policy/);
    assert.throws(() => loadConfig({ env: { XT_REVIEW_PR_LAYA_K: '1' }, dir: d }), /k must/);
  });
  it('the committed laya.json makes stable-disagreement the default and asks both questions', () => {
    const c = loadConfig({ env: { XT_REVIEW_PR_LAYA: 'recheck' } });
    assert.deepEqual([c.mode, c.policy, c.k, c.threshold], ['recheck', 'stable-disagreement', 3, null]);
    assert.deepEqual(c.questions, { introducedByPr: true, alreadyRaised: true });
  });
});

/**
 * Fake provider. severity answers come from bySev(state, order) → label (probability 0.8);
 * yes/no questions from yes(name, state) → boolean.
 */
function fake({ bySev, yes = () => true }) {
  const calls = [];
  const fetchImpl = async (url, o = {}) => {
    if (url.endsWith('/health')) return { ok: true, json: async () => ({}) };
    const body = JSON.parse(o.body);
    const [name, q] = Object.entries(body.questions)[0];
    calls.push({ name, state: body.state, order: Object.keys(q.criteria), max_len: body.max_len });
    let probabilities;
    if (name === 'merge_gate') probabilities = { Blocked: 0.9, 'Eligible with suggestions': 0.05, Eligible: 0.05 };
    else if (name === 'severity') { const l = bySev(body.state, Object.keys(q.criteria)); probabilities = Object.fromEntries(LABELS.map((x) => [x, x === l ? 0.8 : 0.2 / 3])); }
    else probabilities = yes(name, body.state) ? { yes: 0.85, no: 0.15 } : { yes: 0.1, no: 0.9 };
    return { ok: true, json: async () => ({ answers: { [name]: { probabilities } } }) };
  };
  return { fetchImpl, calls };
}

const F = (id, severity, extra = {}) => ({ id, severity, file: 'src/old.cs', line: 11, rule: 'Bug', issue: `issue ${id}`, evidence: `evidence ${id}`, impact: `impact ${id}`, ...extra });
const cfg = (o = {}) => ({ url: 'http://laya.test', model: 'english', mode: 'shadow', threshold: null, warning: null, mergeBlockThreshold: 0.29, ...o });

describe('classify: yes/no questions', () => {
  const prData = { threads: [{ id: '7', status: 'active', comments: [{ body: 'issue F1 evidence F1 is already reported here, please fix the null check.' }] }] };
  it('asks introduced_by_pr with the computed line status and already_raised with BM25 passages', async () => {
    const { fetchImpl, calls } = fake({ bySev: () => 'Major', yes: (name, s) => (name === 'already_raised' ? /issue F1/.test(s.existing_threads) : true) });
    const findings = [F('F1', 'Major'), F('F2', 'Minor', { file: 'src/new.cs', line: 2, issue: 'zzz', evidence: 'qqq' })];
    const { log, lines } = await classify({ findings, cfg: cfg(), fetchImpl, prData, patchText: PATCH });
    const intro = calls.filter((c) => c.name === 'introduced_by_pr');
    assert.equal(intro.length, 2);
    assert.match(intro[0].state.cited_lines, /modified by this PR/);
    assert.ok(!JSON.stringify(intro).includes('Major'));
    const raised = calls.filter((c) => c.name === 'already_raised');
    assert.equal(raised.length, 1); // F2 has no similar passage → local "no", no call
    assert.equal(raised[0].max_len, 1024);
    assert.match(raised[0].state.existing_threads, /^Thread 1 \[active\]: issue F1/);
    assert.deepEqual(log.results.map((r) => r.introducedByPr.cited), ['modified', 'added']);
    assert.deepEqual(log.results.map((r) => r.introducedByPr.answer), ['yes', 'yes']);
    assert.deepEqual(log.results.map((r) => r.alreadyRaised.answer), ['yes', 'no']);
    assert.equal(log.results[1].alreadyRaised.local, true);
    assert.deepEqual(log.results[0].alreadyRaised.threads.map((t) => t.threadId), ['7']);
    assert.deepEqual(log.summary.introducedByPr, { asked: 2, yes: 2, no: 0, unavailable: 0, cited: { modified: 1, added: 1 } });
    assert.deepEqual(log.summary.alreadyRaised, { asked: 2, yes: 1, no: 1, unavailable: 0, localNo: 1 });
    assert.ok(lines.some((l) => l === 'laya questions (log only): introduced_by_pr yes=2 no=0 unavailable=0; already_raised yes=1 no=1 (no similar thread 1) unavailable=0'), lines.join('\n'));
    assert.deepEqual(log.results.map((r) => r.claude), ['Major', 'Minor']); // nothing changes a severity
  });
  it('without PR JSON the questions are skipped and noted', async () => {
    const { fetchImpl, calls } = fake({ bySev: () => 'Major' });
    const { log } = await classify({ findings: [F('F1', 'Major')], cfg: cfg(), fetchImpl });
    assert.equal(calls.filter((c) => c.name !== 'severity' && c.name !== 'merge_gate').length, 0);
    assert.match(log.summary.questionsSkipped, /no PR JSON/);
  });
  it('questions can be turned off; no patch → introduced_by_pr not asked', async () => {
    const { fetchImpl, calls } = fake({ bySev: () => 'Major' });
    const { log } = await classify({ findings: [F('F1', 'Major')], cfg: cfg({ questions: { alreadyRaised: false } }), fetchImpl, prData, patchText: null });
    assert.equal(calls.filter((c) => c.name === 'already_raised' || c.name === 'introduced_by_pr').length, 0);
    assert.deepEqual(log.results[0].introducedByPr, { cited: 'unknown', answer: null, reason: 'patch not available' });
  });
  it('loadPrContext finds pr-<id>.json and pr-<id>.patch next to the findings file', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'pr-3.json'), JSON.stringify({ id: 3, threads: [] }));
    fs.writeFileSync(path.join(d, 'pr-3.patch'), PATCH);
    const c = loadPrContext(path.join(d, 'pr-3.findings.json'));
    assert.equal(c.prData.id, 3);
    assert.equal(c.patchText, PATCH);
    assert.deepEqual(loadPrContext(path.join(d, 'pr-4.findings.json')), { prData: null, patchText: null });
  });
});

describe('classify: stable-disagreement policy', () => {
  // A: always Major (Claude Minor) → stable up. B: answers the first listed option → unstable.
  // C: always Suggestion (Claude Critical) → stable down. D, E: always Critical (Claude Suggestion/Minor) → stable up.
  // G: always Minor, Claude Major... also down. H: Major vs Claude Critical → same side, no flag.
  const bySev = (s, order) => ({ 'issue A': 'Major', 'issue B': order[0], 'issue C': 'Suggestion', 'issue D': 'Critical', 'issue E': 'Critical', 'issue H': 'Major' })[s.issue];
  const findings = [F('A', 'Minor'), F('B', 'Minor'), F('C', 'Critical'), F('D', 'Suggestion'), F('E', 'Minor'), F('H', 'Critical')];
  it('asks k shuffled-order samples per finding and logs the stability', async () => {
    const { fetchImpl, calls } = fake({ bySev });
    const { log } = await classify({ findings, cfg: cfg({ policy: 'stable-disagreement', k: 3 }), fetchImpl });
    const sev = calls.filter((c) => c.name === 'severity');
    assert.equal(sev.length, findings.length * 4); // canonical + 3 shuffled
    const a = sev.filter((c) => c.state.issue === 'issue A');
    assert.deepEqual(a[0].order, LABELS);
    assert.equal(new Set(a.map((c) => c.order.join())).size, 4);
    const by = Object.fromEntries(log.results.map((r) => [r.id, r]));
    assert.equal(by.A.stability.stable, true);
    assert.equal(by.B.stability.stable, false);
    assert.equal(by.A.stability.samples.length, 3);
    assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'H'].map((id) => [by[id].wouldFlag, by[id].direction]),
      [[true, 'up'], [false, null], [true, 'down'], [true, 'up'], [true, 'up'], [false, null]]);
    assert.equal(log.policy, 'stable-disagreement');
    assert.equal(log.k, 3);
    assert.deepEqual([log.summary.sampled, log.summary.stable, log.summary.unstable, log.summary.stableDisagree, log.summary.flagsUp, log.summary.flagsDown], [6, 5, 1, 4, 3, 1]);
    assert.ok(log.results.every((r) => r.recheck === null)); // shadow
  });
  it('recheck without a threshold: max 3, upward first, one line each', async () => {
    const { fetchImpl } = fake({ bySev });
    const { log, lines } = await classify({ findings, cfg: cfg({ mode: 'recheck', policy: 'stable-disagreement', k: 3 }), fetchImpl });
    const rq = lines.filter((l) => l.startsWith('recheck '));
    assert.equal(rq.length, 3);
    assert.ok(rq.every((l) => /possible missed block/.test(l)));
    assert.match(rq[0], /^recheck [ADE]: Claude (Minor|Suggestion) → Laya (Major|Critical) \(stable 3\/3, mean p 0\.80\) \[merge boundary, possible missed block\] src\/old\.cs:11$/);
    assert.equal(log.results.find((r) => r.id === 'C').recheck, 'capped');
    assert.match(lines.at(-1), /policy=stable-disagreement k=3 stable=5\/6 stable-disagree=4 \(up 3, down 1\)/);
  });
  it('stabilityScope boundary samples only findings whose first answer crosses', async () => {
    const { fetchImpl, calls } = fake({ bySev });
    const { log } = await classify({ findings, cfg: cfg({ policy: 'stable-disagreement', k: 3, stabilityScope: 'boundary' }), fetchImpl });
    // first (canonical) answers: A Major↑, B Critical↑ (first option), C Suggestion↓, D↑, E↑ cross; H does not
    assert.equal(calls.filter((c) => c.name === 'severity').length, 6 + 5 * 3);
    assert.match(log.results.find((r) => r.id === 'H').stability.skipped, /does not cross/);
  });
  it('threshold policy unchanged when set', async () => {
    const { fetchImpl, calls } = fake({ bySev });
    const { log } = await classify({ findings, cfg: cfg({ policy: 'threshold', threshold: 0.5, mode: 'recheck' }), fetchImpl });
    assert.equal(calls.filter((c) => c.name === 'severity').length, 6);
    assert.equal(log.summary.policy, 'threshold');
    assert.ok(!log.results.some((r) => r.stability));
  });
});

describe('execution log header with both providers', () => {
  it('shows one line per provider log and both merge lines', () => {
    const d = tmp();
    const sum = (o) => ({ findings: 1, agree: 1, differs: 0, lowConfidence: 0, wouldFlag: 0, rechecks: 0, unavailable: 0, server: 'up', ms: 900, ...o });
    fs.writeFileSync(path.join(d, 'pr-9.json'), JSON.stringify({ id: 9, title: 'T' }));
    fs.writeFileSync(path.join(d, 'pr-9.findings.json'), JSON.stringify({ findings: [F('F1', 'Minor')] }));
    fs.writeFileSync(path.join(d, 'pr-9.laya.json'), JSON.stringify({ provider: 'laya', mode: 'shadow', url: 'http://l', summary: sum(), merge: { laya: { label: 'Blocked', pBlock: 0.6, threshold: 0.29, topLabel: 'Blocked' }, rule: 'Eligible with suggestions', status: 'differs' }, results: [] }));
    fs.writeFileSync(path.join(d, 'pr-9.jev.json'), JSON.stringify({ provider: 'jev', mode: 'shadow', policy: 'stable-disagreement', k: 3, url: 'openrouter', summary: sum({ sampled: 1, stable: 1, stableDisagree: 0, costUsd: 0.001, inputTokens: 900, introducedByPr: { asked: 1, yes: 1 }, alreadyRaised: { asked: 1, yes: 0 } }), merge: { laya: null }, results: [] }));
    const tf = path.join(d, 't.jsonl');
    fs.writeFileSync(tf, [
      { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: '/review-pr-jev-classify 9' } },
      { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { id: 'a', model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'node pr-fetch.mjs 9', description: 'Fetch' } }] } },
    ].map((e) => JSON.stringify(e)).join('\n'));
    const script = fileURLToPath(new URL('../scripts/build_execution_log.mjs', import.meta.url));
    execFileSync(process.execPath, [script, path.join(d, 'pr-9.json'), '--transcript', tf], { encoding: 'utf8' });
    const html = fs.readFileSync(path.join(d, 'pr-9.execution-log.html'), 'utf8');
    assert.match(html, /Laya \(shadow\): 1 findings · agree 1/);
    assert.match(html, /Jev \(shadow, stable-disagreement\): 1 findings · agree 1 .*stable 1\/1 \(k=3\).*introduced_by_pr yes 1\/1 · already_raised yes 0\/1/);
    assert.match(html, /Laya merge question: Blocked/);
    assert.match(html, /Jev merge question: unavailable/);
  });
});
