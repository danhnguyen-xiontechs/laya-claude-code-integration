#!/usr/bin/env node
// Builds the per-tool report: plain Claude (A) vs Claude + the tool with Jev/Laya or its rules (B), on the
// same cases. Everything is recomputed from the raw case results, never typed by hand.
//
// Usage: node build_tool_report.mjs <experimentDir>
// Reads:
//   manifest.json                              tool, status, recommendation, confidence, headline, deviations
//   runs/A-*/<runId>/results.json, runs/B-*/<runId>/results.json
//        { experimentId, arm, runId, startedAt, finishedAt, cases: [case-result] }
//   optional per run dir: execution-log.html (web-test builder) or log-execute.html
//   optional unit-tests.json  { suites: [{ level, command, passed, failed, skipped, notRun, evidence }] }
//   optional agent-review.json { findings: [{ severity, finding, ref, resolution }] }
// Writes: summary.json (read by build_main_report.mjs) and report.html
import fs from 'node:fs';
import path from 'node:path';
import { CSS } from './report_style.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node build_tool_report.mjs <experimentDir>');
  process.exit(2);
}
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};
const manifest = readJson(path.join(dir, 'manifest.json'));
if (!manifest) {
  console.error(`manifest.json missing or invalid in ${dir}`);
  process.exit(2);
}
const rel = (p) => path.relative(dir, p).split(path.sep).join('/');

// ---------- collect runs ----------
const runs = [];
const runsRoot = path.join(dir, 'runs');
for (const armDir of fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot) : []) {
  const arm = armDir[0].toUpperCase();
  if (arm !== 'A' && arm !== 'B') continue;
  for (const runId of fs.readdirSync(path.join(runsRoot, armDir))) {
    const rd = path.join(runsRoot, armDir, runId);
    const res = readJson(path.join(rd, 'results.json'));
    if (!res) continue;
    const logs = ['execution-log.html', 'log-execute.html'].filter((f) => fs.existsSync(path.join(rd, f)));
    runs.push({ arm, runId, dir: rd, res, logs: logs.map((f) => rel(path.join(rd, f))) });
  }
}

// ---------- aggregate (blocked/skipped/not-run never count as pass or fail) ----------
const sumOrNull = (xs) => (xs.some((x) => x != null) ? xs.reduce((a, x) => a + (x ?? 0), 0) : null);
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
const totalTokens = (u = {}) => sumOrNull([u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens]);
function aggregate(arm) {
  const cases = runs.filter((r) => r.arm === arm).flatMap((r) => r.res.cases ?? []);
  if (!cases.length) return null;
  const n = (s) => cases.filter((c) => c.status === s).length;
  const u = (k) => cases.map((c) => c.usage?.[k] ?? null);
  return {
    cases: cases.length,
    pass: n('pass'),
    fail: n('fail'),
    blocked: n('blocked'),
    error: n('error'),
    skipped: n('skipped') + n('not-run'),
    passRate: n('pass') + n('fail') ? n('pass') / (n('pass') + n('fail')) : null,
    tokens: sumOrNull(cases.map((c) => totalTokens(c.usage))),
    inputTokens: sumOrNull(u('inputTokens')),
    outputTokens: sumOrNull(u('outputTokens')),
    toolCalls: sumOrNull(u('toolCalls')),
    modelTurns: sumOrNull(u('modelTurns')),
    providerCalls: sumOrNull(u('providerCalls')),
    fallbacks: sumOrNull(u('fallbackCount')),
    providerLatencyMs: median(u('providerLatencyMs')),
    elapsedMs: median(u('elapsedMs')),
  };
}
const agg = { A: aggregate('A'), B: aggregate('B') };

// per case: majority status over repetitions, mean tokens per repetition
const cases = new Map();
for (const r of runs)
  for (const c of r.res.cases ?? []) {
    if (!cases.has(c.caseId)) cases.set(c.caseId, { gold: c.goldOutcome, A: [], B: [], evidence: { A: [], B: [] } });
    const m = cases.get(c.caseId);
    m[r.arm].push(c);
    for (const e of c.evidenceRefs ?? []) m.evidence[r.arm].push(rel(path.resolve(r.dir, e)));
  }
const majority = (xs) => {
  const n = {};
  for (const x of xs) n[x.status] = (n[x.status] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const caseRows = [...cases].map(([id, m]) => {
  const a = majority(m.A), b = majority(m.B);
  const tok = (xs) => {
    const t = sumOrNull(xs.map((c) => totalTokens(c.usage)));
    return t == null ? null : t / xs.length;
  };
  return {
    id, gold: m.gold, a, b, aTok: tok(m.A), bTok: tok(m.B),
    engineUsed: m.B.some((c) => c.usage?.providerCalls), note: m.B.at(-1)?.observedOutcome ?? '',
    change: a === 'pass' && b && b !== 'pass' ? 'worse' : a && a !== 'pass' && b === 'pass' ? 'better' : '',
    evidence: m.evidence,
  };
});
const regressions = caseRows.filter((r) => r.change === 'worse').map((r) => r.id);
const improvements = caseRows.filter((r) => r.change === 'better').map((r) => r.id);

const unit = readJson(path.join(dir, 'unit-tests.json'));
const review = readJson(path.join(dir, 'agent-review.json'));
const unitTotals = unit
  ? ['passed', 'failed', 'skipped', 'notRun'].reduce((o, k) => ({ ...o, [k]: unit.suites.reduce((a, s) => a + (s[k] ?? 0), 0) }), {})
  : null;
const isOpen = (f) => !/^(fixed|accepted)/i.test(f.resolution ?? '');
const openBlocking = review ? review.findings.filter((f) => ['Critical', 'Major'].includes(f.severity) && isOpen(f)).length : null;
const engine = manifest.tool?.provider && manifest.tool.provider !== 'none' ? manifest.tool.provider : 'rules';

const summary = {
  experimentId: manifest.experimentId,
  tool: manifest.tool,
  engine,
  status: manifest.status,
  recommendation: manifest.recommendation ?? null,
  confidence: manifest.confidence ?? null,
  headline: manifest.headline ?? null,
  arms: agg,
  regressions,
  improvements,
  unitTotals,
  openBlockingFindings: openBlocking,
  lastRun: runs.map((r) => r.res.finishedAt).filter(Boolean).sort().at(-1) ?? null,
  generatedAt: new Date().toISOString(),
  report: 'report.html',
};
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));

// ---------- render ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const num = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));
const pctChange = (a, b) => (a == null || b == null || !a ? null : (b - a) / a);
const signedPct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`);
const ms = (x) => (x == null ? '—' : x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
const A = agg.A, B = agg.B;
const verdict = { ADOPT: 'Use it', PILOT: 'Try it on a small scope', REWORK: 'Fix first, then re-measure', DROP: 'Drop it', INSUFFICIENT_EVIDENCE: 'Not enough evidence yet' };
const okIcon = (s) => ({ pass: '<span class="good">✔ pass</span>', fail: '<span class="bad">✘ fail</span>', blocked: '<span class="warn">■ blocked</span>', error: '<span class="bad">error</span>' })[s] ?? esc(s ?? '—');

const tokChange = pctChange(A?.tokens, B?.tokens);
const maxTok = Math.max(1, ...caseRows.flatMap((r) => [r.aTok ?? 0, r.bTok ?? 0]));
const bar = (v, cls, max = maxTok) => `<span class="bar ${cls}" style="width:${v == null ? 0 : Math.max(1, (v / Math.max(1, max ?? 0)) * 100)}%"></span>`;
const passedOf = (g) => (g ? `${g.pass}/${g.pass + g.fail} pass` : '—');

const cards = [
  ['Tokens Claude reads', signedPct(tokChange), `${num(A?.tokens)} → ${num(B?.tokens)}`, tokChange == null ? '' : tokChange < 0 ? 'good' : 'bad'],
  ['Cases passed', `${B?.pass ?? '—'}/${B ? B.pass + B.fail : '—'}`, `plain Claude ${A?.pass ?? '—'}/${A ? A.pass + A.fail : '—'}${regressions.length ? ` · ${regressions.length} worse` : ''}`, regressions.length ? 'bad' : 'good'],
  [`${esc(engine)} calls`, num(B?.providerCalls), `median ${ms(B?.providerLatencyMs)} · ${num(B?.fallbacks)} fallbacks`, ''],
  ['Tests · review', unitTotals ? `${unitTotals.passed}/${unitTotals.passed + unitTotals.failed}` : 'not run', review ? `${openBlocking} open Critical/Major` : 'no agent review', unitTotals?.failed || openBlocking ? 'bad' : unitTotals ? 'good' : 'warn'],
];

const caseTable = `<table class="cases"><thead><tr><th>Case</th><th>Plain Claude</th><th>Claude + tool</th><th class="r">Tokens<br>plain Claude</th><th class="r">Tokens<br>Claude + tool</th><th class="r">Change</th><th class="w">Tokens</th><th>Evidence</th></tr></thead><tbody>${caseRows
  .map((r) => {
    const d = pctChange(r.aTok, r.bTok);
    const same = d == null || Math.abs(d) < 0.01;
    const ev = [...new Set(r.evidence.A)].map((e) => `<a href="${esc(e)}">A</a>`).concat([...new Set(r.evidence.B)].map((e) => `<a href="${esc(e)}">B</a>`)).join(' ');
    return `<tr class="${r.change}"><td><b>${esc(r.id)}</b>${r.engineUsed ? ` <span class="tag">${esc(engine)}</span>` : ''}<br><small>${esc(r.note)}</small></td><td>${okIcon(r.a)}</td><td>${okIcon(r.b)}${
      r.change ? ` <b class="${r.change === 'worse' ? 'bad' : 'good'}">${r.change}</b>` : ''}</td><td class="r">${num(r.aTok)}</td><td class="r">${num(r.bTok)}</td><td class="r ${
      same ? 'muted' : d < 0 ? 'good' : 'bad'}">${same ? 'same' : signedPct(d)}</td><td class="w">${bar(r.aTok, 'a')}${bar(r.bTok, 'b')}</td><td>${ev}</td></tr>`;
  })
  .join('')}</tbody><tfoot><tr><th>Total (${caseRows.length} cases)</th><th>${passedOf(A)}</th><th>${passedOf(B)}</th><th class="r">${num(A?.tokens)}</th><th class="r">${num(B?.tokens)}</th><th class="r ${
  tokChange == null ? '' : tokChange < 0 ? 'good' : 'bad'}">${signedPct(tokChange)}</th><th class="w">${bar(A?.tokens, 'a', A?.tokens)}${bar(B?.tokens, 'b', A?.tokens)}</th><th></th></tr></tfoot></table>
<p class="legend"><span class="bar a"></span> plain Claude <span class="bar b"></span> Claude + tool (${esc(engine)} or its rules; the small text under each case says which decided) · tokens are ${esc(manifest.evaluation?.tokenScope ?? 'all tokens of the case run')} · source: ${esc(
  [...new Set(runs.flatMap((r) => (r.res.cases ?? []).map((c) => c.usage?.source).filter(Boolean)))].join('; ') || 'not recorded')}</p>`;

const details = (title, body, open = false) => `<details${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
const unitBody = unit
  ? `<table><thead><tr><th>Level</th><th>Command</th><th class="r">Passed</th><th class="r">Failed</th><th class="r">Skipped</th><th class="r">Not run</th></tr></thead><tbody>${unit.suites
      .map((s) => `<tr><td>${esc(s.level)}</td><td><code>${esc(s.command)}</code></td><td class="r">${num(s.passed)}</td><td class="r ${s.failed ? 'bad' : ''}">${num(s.failed)}</td><td class="r">${num(s.skipped)}</td><td class="r">${num(s.notRun)}</td></tr>`)
      .join('')}</tbody></table>`
  : '<p class="bad">No unit-tests.json: tests not run or not recorded.</p>';
const reviewBody = review
  ? `<ul class="findings">${review.findings
      .map((f) => `<li><span class="sev ${esc(f.severity)}">${esc(f.severity)}</span> ${esc(f.finding)} <small>${esc(f.ref ?? '')} · ${esc(f.resolution ?? 'open')}</small></li>`)
      .join('')}</ul>`
  : '<p class="bad">No agent-review.json: independent review not recorded.</p>';
const metricBody = `<table><thead><tr><th></th><th class="r">Claude</th><th class="r">+ ${esc(engine)}</th></tr></thead><tbody>${[
  ['Cases', 'cases'], ['Pass', 'pass'], ['Fail', 'fail'], ['Blocked', 'blocked'], ['Errors', 'error'], ['All tokens', 'tokens'], ['Input tokens', 'inputTokens'],
  ['Output tokens', 'outputTokens'], ['Model turns', 'modelTurns'], ['Tool calls', 'toolCalls'], [`${engine} calls`, 'providerCalls'], ['Fallbacks', 'fallbacks'],
]
  .filter(([, k]) => A?.[k] != null || B?.[k] != null)
  .map(([l, k]) => `<tr><td>${esc(l)}</td><td class="r">${num(A?.[k])}</td><td class="r">${num(B?.[k])}</td></tr>`)
  .join('')}<tr><td>Median elapsed</td><td class="r">${ms(A?.elapsedMs)}</td><td class="r">${ms(B?.elapsedMs)}</td></tr></tbody></table>`;
const runsBody = `<ul>${runs
  .sort((a, b) => a.arm.localeCompare(b.arm))
  .map((r) => `<li>${r.arm} · ${esc(r.runId)} · ${esc(r.res.finishedAt ?? '')} · <a href="${esc(rel(path.join(r.dir, 'results.json')))}">results.json</a> ${
    r.logs.map((l) => `· <a href="${esc(l)}">${esc(path.basename(l))}</a>`).join(' ') || '· <span class="muted">no execution log</span>'}</li>`)
  .join('')}</ul>`;
const devs = manifest.evaluation?.deviations ?? [];
const docs = ['idea-brief.md', 'design.md', 'experiment-plan.md', 'agent-review.md', 'final-decision.md', 'manifest.json', 'summary.json'].filter((f) => fs.existsSync(path.join(dir, f)));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(manifest.tool?.name)} report</title><style>${CSS()}</style></head><body><main>
<p class="muted">${esc(manifest.tool?.kind)} · ${esc(manifest.experimentId)} · commit ${esc(manifest.tool?.commit ?? '—')}</p>
<h1>${esc(manifest.tool?.name)}: plain Claude vs Claude + ${esc(engine)}</h1>
<div class="verdict ${esc(manifest.recommendation ?? '')}"><b>${esc(manifest.recommendation ?? 'PENDING')}</b> · ${esc(verdict[manifest.recommendation] ?? 'waiting for your review')}${
  manifest.confidence ? ` <small>(confidence ${esc(manifest.confidence)})</small>` : ''}${manifest.headline ? `<p>${esc(manifest.headline)}</p>` : ''}</div>
<section class="kpis">${cards.map(([t, big, sub, cls]) => `<div><span>${t}</span><b class="${cls}">${big}</b><small>${sub}</small></div>`).join('')}</section>
<h2>Case by case</h2>${caseTable}
${devs.length ? details(`Caveats (${devs.length})`, `<ul>${devs.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`, true) : ''}
${details(`Agent review (${review ? `${review.findings.length} findings, ${openBlocking} open Critical/Major` : 'missing'})`, reviewBody)}
${details(`Tests (${unitTotals ? `${unitTotals.passed} passed, ${unitTotals.failed} failed` : 'missing'})`, unitBody)}
${details('All numbers', metricBody)}
${details(`Runs and raw data (${runs.length})`, runsBody + `<p>${docs.map((d) => `<a href="${d}">${d}</a>`).join(' · ')}</p>`)}
<p class="muted">Generated ${esc(summary.generatedAt)} by build_tool_report.mjs from the raw results.</p>
</main></body></html>`;
fs.writeFileSync(path.join(dir, 'report.html'), html);
console.log(`report.html + summary.json written (${runs.length} runs, ${caseRows.length} cases, ${regressions.length} worse)`);
