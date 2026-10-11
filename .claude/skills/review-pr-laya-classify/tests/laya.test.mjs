// Tests for the Laya severity check (plan 1). Run: node --test .claude/skills/review-pr-laya-classify/tests/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildQuestion, buildState, compareOne, counts, extractOverrides, loadConfig, merge, neutralize,
  pickRechecks, readFindings, ruleBaseline, score, verdict, askSeverity,
} from '../scripts/laya-severity.mjs';
import { classify, main as classifyMain } from '../scripts/classify-findings.mjs';
import { assess, finalizeLog, main as assessMain } from '../scripts/assess.mjs';
import { evaluate, flagStats, hash01, pickThreshold, report, rowsFromLog, main as evalMain } from '../scripts/laya-eval.mjs';

/** Fake laya-serve. answer(state) → { Critical, Major, Minor, Suggestion } probabilities, or null for HTTP 500. */
function fakeLaya(answer, { up = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    if (!up) throw new Error('ECONNREFUSED');
    if (url.endsWith('/health')) return { ok: true, json: async () => ({ ok: true }) };
    const body = JSON.parse(opts.body);
    calls.push(body);
    const probs = answer(body.state, body);
    if (!probs) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ answers: { severity: { probabilities: probs } } }) };
  };
  return { fetchImpl, calls };
}

const P = (label, p) => {
  const rest = (1 - p) / 3;
  return Object.fromEntries(['Critical', 'Major', 'Minor', 'Suggestion'].map((l) => [l, l === label ? p : rest]));
};

const F = (id, severity, extra = {}) => ({ id, severity, file: 'src/a.ts', line: 10, rule: 'Bug', issue: `issue ${id}`, evidence: `evidence ${id}`, impact: `impact ${id}`, ...extra });

const cfg = (o = {}) => ({ url: 'http://laya.test', model: 'english', mode: 'shadow', threshold: null, warning: null, ...o });

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rpl-')); }

describe('verdict and merge (severity only)', () => {
  const cases = [
    [{ Critical: 0, Major: 0, Minor: 0, Suggestion: 1 }, 99, 'Approve with Suggestions', 'Eligible'],
    [{ Critical: 0, Major: 0, Minor: 2, Suggestion: 3 }, 89, 'Approve with Suggestions', 'Eligible'],
    [{ Critical: 0, Major: 0, Minor: 0, Suggestion: 0 }, 100, 'Approve', 'Eligible'],
    [{ Critical: 0, Major: 1, Minor: 0, Suggestion: 0 }, 88, 'Request Changes', 'Blocked'],
    [{ Critical: 1, Major: 0, Minor: 0, Suggestion: 9 }, 65, 'Request Changes', 'Blocked'],
    [{ Critical: 4, Major: 0, Minor: 0, Suggestion: 0 }, 0, 'Request Changes', 'Blocked'],
  ];
  for (const [c, s, v, m] of cases) {
    it(`${JSON.stringify(c)} → ${s}, ${v}, ${m}`, () => {
      assert.equal(score(c), s);
      assert.equal(verdict(c), v);
      assert.equal(merge(c), m);
    });
  }
  it('assess prints the header lines', () => {
    const r = assess([F('F1', 'Suggestion')], { coverage: '3/3' });
    assert.deepEqual(r.header, [
      '## PR Review — Approve with Suggestions', '',
      '**Score:** 99/100 · **Merge:** Eligible · **Coverage:** 3/3 files',
      '**Findings:** 🔴 Critical 0 · 🟠 Major 0 · 🟡 Minor 0 · 🔵 Suggestion 1',
    ]);
  });
});

describe('input for Laya', () => {
  it('removes severity words', () => {
    assert.equal(neutralize('Critical bug: a major blocker, should-fix. Minor nit.'), 'bug: a,..');
    assert.equal(neutralize('Passes the account id'), 'Passes the account id');
  });
  it('never sends Claude severity', () => {
    const s = buildState(F('F1', 'Critical', { issue: 'Critical: leaks tokens' }));
    assert.deepEqual(Object.keys(s).sort(), ['evidence', 'impact', 'issue', 'rule']);
    assert.ok(!JSON.stringify(s).includes('Critical'));
  });
  it('extracts severity overrides into the question', () => {
    const rules = '# Rules\n## Rules\n- R1 x\n## Severity overrides\n- A new analyzer warning is Critical.\n\n## Other\n- y';
    assert.equal(extractOverrides(rules), '- A new analyzer warning is Critical.');
    assert.match(buildQuestion(extractOverrides(rules)).severity.instructions, /analyzer warning is Critical/);
    assert.deepEqual(Object.keys(buildQuestion().severity.criteria), ['Critical', 'Major', 'Minor', 'Suggestion']);
  });
});

describe('Laya client', () => {
  it('takes the top label and its probability', async () => {
    const { fetchImpl } = fakeLaya(() => P('Major', 0.7));
    const r = await askSeverity(cfg(), {}, buildQuestion(), { fetchImpl });
    assert.equal(r.label, 'Major');
    assert.equal(r.confidence, 0.7);
  });
  it('returns null for HTTP errors and unknown labels', async () => {
    assert.equal(await askSeverity(cfg(), {}, buildQuestion(), { fetchImpl: fakeLaya(() => null).fetchImpl }), null);
    assert.equal(await askSeverity(cfg(), {}, buildQuestion(), { fetchImpl: fakeLaya(() => ({ Blocker: 0.9 })).fetchImpl }), null);
  });
});

describe('comparison', () => {
  it('agree / differs / unavailable', () => {
    assert.deepEqual(compareOne('Major', { label: 'Major', confidence: 0.9 }, 0.5), { status: 'agree', wouldFlag: false });
    assert.deepEqual(compareOne('Major', { label: 'Minor', confidence: 0.4 }, 0.5), { status: 'differs', wouldFlag: false });
    assert.deepEqual(compareOne('Major', { label: 'Minor', confidence: 0.6 }, 0.5), { status: 'differs', wouldFlag: true });
    assert.deepEqual(compareOne('Major', { label: 'Minor', confidence: 0.99 }, null), { status: 'differs', wouldFlag: false });
    assert.deepEqual(compareOne('Major', null, 0.5), { status: 'unavailable', wouldFlag: false });
  });
  it('re-checks only in recheck mode, max 3, merge-boundary first', () => {
    const rows = [
      { id: 'A', claude: 'Minor', laya: { label: 'Suggestion', confidence: 0.99 }, wouldFlag: true },
      { id: 'B', claude: 'Minor', laya: { label: 'Major', confidence: 0.6 }, wouldFlag: true },
      { id: 'C', claude: 'Critical', laya: { label: 'Major', confidence: 0.95 }, wouldFlag: true },
      { id: 'D', claude: 'Major', laya: { label: 'Suggestion', confidence: 0.7 }, wouldFlag: true },
      { id: 'E', claude: 'Major', laya: { label: 'Minor', confidence: 0.9 }, wouldFlag: false },
    ];
    assert.equal(pickRechecks(rows, { mode: 'shadow' }).size, 0);
    // boundary crossings D (0.7), B (0.6) first, then the most confident other: A (0.99)
    assert.deepEqual([...pickRechecks(rows, { mode: 'recheck' })], ['D', 'B', 'A']);
  });
});

describe('config', () => {
  it('recheck without threshold falls back to shadow', () => {
    const c = loadConfig({ env: { XT_REVIEW_PR_LAYA: 'recheck' }, dir: tmp() });
    assert.equal(c.mode, 'shadow');
    assert.match(c.warning, /threshold/);
  });
  it('env wins and validates', () => {
    const c = loadConfig({ env: { XT_REVIEW_PR_LAYA: 'recheck', XT_REVIEW_PR_LAYA_THRESHOLD: '0.7', LAYA_URL: 'http://x:1' }, dir: tmp() });
    assert.deepEqual([c.mode, c.threshold, c.url], ['recheck', 0.7, 'http://x:1']);
    assert.throws(() => loadConfig({ env: { XT_REVIEW_PR_LAYA: 'auto' }, dir: tmp() }), /mode/);
  });
});

describe('classify-findings', () => {
  const findings = [F('F1', 'Major'), F('F2', 'Minor'), F('F3', 'Suggestion')];
  const byIssue = { 'issue F1': P('Major', 0.8), 'issue F2': P('Critical', 0.9), 'issue F3': P('Minor', 0.3) };

  it('shadow: logs, never requests re-checks', async () => {
    const { fetchImpl, calls } = fakeLaya((s) => byIssue[s.issue]);
    const { log, lines } = await classify({ findings, cfg: cfg({ threshold: 0.5 }), fetchImpl });
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => !JSON.stringify(c.state).match(/Major|Minor|Suggestion/)));
    assert.deepEqual(log.results.map((r) => r.status), ['agree', 'differs', 'differs']);
    assert.deepEqual(log.results.map((r) => r.recheck), [null, null, null]);
    assert.equal(log.summary.wouldFlag, 1);
    assert.match(lines.at(-1), /^laya: mode=shadow findings=3 agree=1 differs=2 low-confidence=1 wouldFlag=1 unavailable=0/);
  });

  it('recheck: lists flagged findings above the threshold only', async () => {
    const { fetchImpl } = fakeLaya((s) => byIssue[s.issue]);
    const { log, lines } = await classify({ findings, cfg: cfg({ mode: 'recheck', threshold: 0.5 }), fetchImpl });
    assert.deepEqual(log.results.map((r) => r.recheck), [null, 'requested', null]);
    assert.match(lines[0], /^recheck F2: Claude Minor → Laya Critical \(0\.90\) \[merge boundary\] src\/a\.ts:10$/);
  });

  it('server down: everything unavailable, Claude kept', async () => {
    const { fetchImpl } = fakeLaya(() => P('Major', 1), { up: false });
    const { log, lines } = await classify({ findings, cfg: cfg({ mode: 'recheck', threshold: 0.5 }), fetchImpl });
    assert.equal(log.summary.unavailable, 3);
    assert.equal(log.summary.rechecks, 0);
    assert.match(lines[0], /unavailable/);
  });

  it('bad answers are unavailable, not guessed', async () => {
    const { fetchImpl } = fakeLaya((s) => (s.issue === 'issue F1' ? null : { Nope: 1 }));
    const { log } = await classify({ findings, cfg: cfg(), fetchImpl });
    assert.equal(log.summary.unavailable, 3);
  });

  it('off: no call at all', async () => {
    const { fetchImpl, calls } = fakeLaya(() => P('Major', 1));
    const { log, lines } = await classify({ findings, cfg: cfg({ mode: 'off' }), fetchImpl });
    assert.equal(log, null);
    assert.equal(calls.length, 0);
    assert.match(lines[0], /off/);
  });

  it('CLI writes the log next to the findings file', async () => {
    const d = tmp();
    const ff = path.join(d, 'pr-7.findings.json');
    fs.writeFileSync(ff, JSON.stringify({ pr: { repoId: 'github.com__o__r', id: 7 }, findings }));
    const out = [];
    const { fetchImpl } = fakeLaya((s) => byIssue[s.issue]);
    const code = await classifyMain(['--findings', ff], { log: (l) => out.push(l), error: (l) => out.push(l), env: {}, fetchImpl });
    assert.equal(code, 0, out.join('\n'));
    const log = JSON.parse(fs.readFileSync(path.join(d, 'pr-7.laya.json'), 'utf8'));
    assert.equal(log.pr.id, 7);
    assert.equal(log.results.length, 3);
  });
});

describe('findings file', () => {
  it('rejects duplicates and unknown severities', () => {
    const d = tmp();
    const w = (x) => { const f = path.join(d, `${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(x)); return f; };
    assert.throws(() => readFindings(w([F('F1', 'Major'), F('F1', 'Minor')])), /duplicate/);
    assert.throws(() => readFindings(w([F('F1', 'Info')])), /severity/);
    assert.equal(readFindings(w([F('F1', 'major')])).findings[0].severity, 'Major');
  });
});

describe('assess --laya', () => {
  it('writes final severities and re-check results into the log', () => {
    const log = { results: [{ id: 'F1', claude: 'Minor', recheck: 'requested' }, { id: 'F2', claude: 'Major', recheck: 'requested' }, { id: 'F3', claude: 'Minor' }] };
    const warnings = finalizeLog(log, [
      F('F1', 'Major', { recheck: { result: 'changed', from: 'Minor', reason: 'r' } }),
      F('F2', 'Major'),
    ]);
    assert.equal(log.results[0].final, 'Major');
    assert.equal(log.results[0].recheckResult.result, 'changed');
    assert.equal(warnings.length, 2); // F2 re-check not recorded, F3 dropped
  });
  it('CLI', () => {
    const d = tmp();
    const ff = path.join(d, 'pr-1.findings.json');
    fs.writeFileSync(ff, JSON.stringify([F('F1', 'Minor')]));
    const out = [];
    assert.equal(assessMain(['--findings', ff, '--coverage', '2/2'], { log: (l) => out.push(l), error: (l) => out.push(l) }), 0);
    assert.match(out[0], /Approve with Suggestions[\s\S]*\*\*Merge:\*\* Eligible/);
  });
});

describe('rule baseline', () => {
  it('maps rule cells', () => {
    assert.equal(ruleBaseline({ rule: 'Security', issue: '' }), 'Critical');
    assert.equal(ruleBaseline({ rule: 'AC2', issue: '' }), 'Major');
    assert.equal(ruleBaseline({ rule: 'Bug', issue: '' }), 'Major');
    assert.equal(ruleBaseline({ rule: 'Perf R1', issue: '' }), 'Minor');
    assert.equal(ruleBaseline({ rule: 'Maintainability', issue: '' }), 'Minor');
    assert.equal(ruleBaseline({ rule: 'Naming', issue: '' }), 'Suggestion');
  });
});

describe('laya-eval', () => {
  const row = (key, pr, claude, human, laya, conf) => ({ key, pr, claude, human, rules: 'Minor', laya: laya ? { label: laya, confidence: conf } : null });

  it('evaluate: accuracy and merge-boundary misses', () => {
    const rows = [row('a', 'p', 'Major', 'Major'), row('b', 'p', 'Minor', 'Critical'), row('c', 'p', 'Minor', 'Minor')];
    const e = evaluate(rows, (r) => r.claude);
    assert.equal(e.accuracy, 0.667);
    assert.equal(e.boundary.underBlocking, 1);
    assert.equal(e.boundary.underRate, 0.5);
  });

  it('flag stats and threshold pick', () => {
    const rows = [
      row('a', 'p1', 'Minor', 'Major', 'Major', 0.9), // right flag, boundary catch
      row('b', 'p1', 'Minor', 'Minor', 'Major', 0.6), // wrong flag
      row('c', 'p2', 'Major', 'Major', 'Major', 0.8), // agree
      row('d', 'p2', 'Minor', 'Minor', 'Suggestion', 0.4), // wrong, low confidence
    ];
    const s = flagStats(rows, 0.5);
    assert.deepEqual([s.flags, s.precision, s.boundaryCatches, s.flagsPerPr], [2, 0.5, 1, 1]);
    // 0.30–0.40: 3 flags, 1 right (0.33) → too imprecise; 0.45: 2 flags, 1 right, 1 per PR → chosen
    assert.equal(pickThreshold(rows).threshold, 0.45);
  });

  it('report stops when Laya does not beat the rules', () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const r = row(`k${i}`, `p${i % 10}`, 'Minor', i % 2 ? 'Minor' : 'Major', 'Major', 0.9);
      r.split = hash01(`1:${r.key}`) < 0.7 ? 'calibration' : 'held-out';
      rows.push(r);
    }
    const o = report(rows);
    assert.ok(o.stops.length > 0);
    assert.match(o.decision, /do not enable/);
  });

  it('collect → run end to end with a fake Laya', async () => {
    const d = tmp();
    const log = { pr: { repoId: 'r', id: 1 }, results: [
      { id: 'F1', claude: 'Minor', laya: { label: 'Major', confidence: 0.9 }, input: { rule: 'Bug', issue: 'x' } },
      { id: 'F2', claude: 'Major', laya: null, input: { rule: 'Bug', issue: 'y' } },
    ] };
    fs.writeFileSync(path.join(d, 'pr-1.laya.json'), JSON.stringify(log));
    assert.equal(rowsFromLog(log, 'pr-1.laya.json')[0].key, 'r#1/F1');
    const ds = path.join(d, 'ds.jsonl');
    const out = [];
    const io = { log: (l) => out.push(l), error: (l) => out.push(l), env: {} };
    assert.equal(await evalMain(['collect', '--logs', d, '--out', ds], io), 0);
    const filled = fs.readFileSync(ds, 'utf8').trim().split('\n').map((l) => ({ ...JSON.parse(l), human: 'Major' }));
    fs.writeFileSync(ds, filled.map((r) => JSON.stringify(r)).join('\n'));
    const { fetchImpl, calls } = fakeLaya(() => P('Major', 0.8));
    assert.equal(await evalMain(['run', '--data', ds], { ...io, fetchImpl }), 0, out.join('\n'));
    assert.equal(calls.length, 1); // only F2 had no Laya answer
    assert.ok(out.some((l) => l.startsWith('decision:')));
    assert.ok(fs.existsSync(path.join(d, 'ds.eval.json')));
  });
});
