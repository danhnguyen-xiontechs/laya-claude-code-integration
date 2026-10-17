#!/usr/bin/env node
// Builds the main report: one row per experiment (plain Claude vs Claude + Jev/Laya/rules), summarised from
// each per-tool summary.json and linking to its report.html. Run build_tool_report.mjs on each experiment first.
//
// Usage: node build_main_report.mjs [reportsRoot]      (default reports/skill-tool-lifecycle)
//   scans <reportsRoot>/<tool-slug>/<experiment-id>/summary.json, writes <reportsRoot>/index.html + index.json
import fs from 'node:fs';
import path from 'node:path';
import { CSS } from './report_style.mjs';

const root = process.argv[2] ?? 'reports/skill-tool-lifecycle';
if (!fs.existsSync(root)) {
  console.error(`${root} not found`);
  process.exit(2);
}
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
};
const STALE_DAYS = 30;
const items = [];
for (const tool of fs.readdirSync(root)) {
  const td = path.join(root, tool);
  if (!fs.statSync(td).isDirectory()) continue;
  for (const exp of fs.readdirSync(td)) {
    const s = readJson(path.join(td, exp, 'summary.json'));
    if (!s) continue;
    const href = `${tool}/${exp}/${s.report ?? 'report.html'}`;
    const age = s.lastRun ? (Date.now() - Date.parse(s.lastRun)) / 864e5 : null;
    items.push({ ...s, href, stale: age != null && age > STALE_DAYS, reportExists: fs.existsSync(path.join(root, href)) });
  }
}
items.sort((a, b) => String(b.lastRun ?? '').localeCompare(String(a.lastRun ?? '')));
fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(items, null, 2));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const num = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'));
const tokChange = (i) => {
  const a = i.arms?.A?.pairedTokens ?? i.arms?.A?.tokens, b = i.arms?.B?.pairedTokens ?? i.arms?.B?.tokens;
  return a == null || b == null || !a ? null : (b - a) / a;
};
const passed = (g) => (g ? `${g.pass}/${g.pass + g.fail}` : '—');
const needsYou = (i) =>
  [
    !i.recommendation && 'no recommendation yet',
    !i.finalDecision && ['PILOT', 'INSUFFICIENT_EVIDENCE'].includes(i.recommendation) && i.recommendation,
    !i.finalDecision && i.recommendation && 'final decision not recorded',
    i.openBlockingFindings && `${i.openBlockingFindings} open Critical/Major`,
    i.regressions?.length && `worse on ${i.regressions.join(', ')}`,
    i.unpairedCases?.length && `${i.unpairedCases.length} case(s) not compared`,
    i.evidenceGaps?.length && `evidence for one arm only on ${i.evidenceGaps.length} case(s)`,
    i.unitTotals?.failed && `${i.unitTotals.failed} failing tests`,
    !i.unitTotals && 'tests not recorded',
  ].filter(Boolean);

const rows = items
  .map((i) => {
    const d = tokChange(i);
    return `<tr><td><a href="${esc(i.href)}"><b>${esc(i.tool?.name)}</b></a>${i.stale ? ' <small class="warn">stale</small>' : ''}${i.reportExists ? '' : ' <small class="bad">report missing</small>'}<br><small>${esc(
      i.tool?.kind)} · + ${esc(i.engine ?? i.tool?.provider)} · ${esc((i.lastRun ?? '').slice(0, 10))}</small></td><td><span class="b ${esc(i.recommendation)}">${esc(
      i.recommendation ?? 'PENDING')}</span></td><td class="r ${d == null ? '' : d < 0 ? 'good' : 'bad'}">${d == null ? '—' : `${d > 0 ? '+' : ''}${Math.round(d * 100)}%`}<br><small>${num(
      i.arms?.A?.pairedTokens ?? i.arms?.A?.tokens)} → ${num(i.arms?.B?.pairedTokens ?? i.arms?.B?.tokens)}</small></td><td class="r">${passed(i.arms?.A)} → ${passed(i.arms?.B)}${
      i.regressions?.length ? `<br><small class="bad">${i.regressions.length} worse</small>` : ''}</td><td class="r">${num(i.arms?.B?.providerCalls)}</td><td>${esc(i.headline ?? '')}</td></tr>`;
  })
  .join('');
const waiting = items.filter((i) => needsYou(i).length);

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skill tool portfolio</title><style>${CSS()}</style></head><body><main>
<h1>Skills and tools: plain Claude vs Claude + Jev/Laya</h1>
<p class="muted">${items.length} experiment(s). Each row is a summary; click a tool for its report. Tokens = what Claude reads/spends on the same cases.</p>
<table><thead><tr><th>Tool</th><th>Verdict</th><th class="r">Tokens</th><th class="r">Cases passed<br>Claude → +tool</th><th class="r">Engine calls</th><th>In one line</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Waiting on you</h2>${waiting.length ? `<ul>${waiting.map((i) => `<li><a href="${esc(i.href)}">${esc(i.tool?.name)}</a>: ${needsYou(i).map(esc).join(' · ')}</li>`).join('')}</ul>` : '<p class="muted">Nothing.</p>'}
<p class="muted">Generated ${new Date().toISOString()} · "stale" = last run older than ${STALE_DAYS} days.</p>
</main></body></html>`;
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html written (${items.length} experiments)`);
