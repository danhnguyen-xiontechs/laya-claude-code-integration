#!/usr/bin/env node
// Usage: node .claude/skills/haiku-subagent/tools/prompt-budget/report.js [runs.jsonl] [--text] [--no-open] [--out report.html]
// Joins pre (optimizer) + post + stop (actual usage) events into one row per subagent run and writes an
// HTML report (default: next to the log, opened in the browser). --text prints a console table instead.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { logPath } from './log.js';

// Prices per 1M tokens as given for Haiku 5.5 (unverified — edit here if they differ).
// ASSUMED (not stated): cache write = 1.25x input; tier-2 cache read = 0.1x input.
const P = {
  t1: { in: 0.1, out: 0.5, cr: 0.01, cw: 0.125 },
  t2: { in: 0.5, out: 2.5, cr: 0.05, cw: 0.625 },
};
const TIER2_AT = 100_000;
const tier = (tokens) => (tokens > TIER2_AT ? P.t2 : P.t1);

export function buildReport(events) {
  const posts = new Map(events.filter((e) => e.type === 'post' && e.agent_id).map((e) => [e.tool_use_id, e]));
  const stops = new Map(events.filter((e) => e.type === 'stop' && e.agent_id).map((e) => [e.agent_id, e]));

  const rows = events
    .filter((e) => e.type === 'pre')
    .map((pre) => {
      const post = pre.tool_use_id ? posts.get(pre.tool_use_id) : undefined;
      const stop = post ? stops.get(post.agent_id) : undefined;
      const u = stop?.usage;

      // Tier is decided per request: average context of one request (input + cache), not the run total.
      const ctx = u ? (u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens) / Math.max(1, stop.requests ?? 1) : pre.final_tokens;
      const pr = tier(ctx);
      const cost = u ? (u.input_tokens * pr.in + u.output_tokens * pr.out + u.cache_read_input_tokens * pr.cr + u.cache_creation_input_tokens * pr.cw) / 1e6 : null;

      // 'applied': did the subagent receive the compacted prompt? Compare its first prompt to both sizes.
      let applied = 'unknown';
      if (!pre.compacted) applied = 'n/a';
      else if (stop?.first_prompt_chars != null) {
        const r = stop.first_prompt_chars;
        applied = Math.abs(r - pre.final_chars) < Math.abs(r - pre.orig_chars) ? 'yes' : 'no';
      }
      // first-request input saving only: the prompt at the tier it WOULD have hit vs. the compacted one
      const saving = pre.compacted ? (pre.orig_tokens * tier(pre.orig_tokens).in - pre.final_tokens * tier(pre.final_tokens).in) / 1e6 : 0;

      return {
        ts: pre.ts, model: pre.model ?? '-', desc: pre.description ?? '',
        orig: pre.orig_tokens, final: pre.final_tokens, compacted: !!pre.compacted, applied,
        input: u?.input_tokens ?? null, cacheRead: u?.cache_read_input_tokens ?? null,
        cacheWrite: u?.cache_creation_input_tokens ?? null, output: u?.output_tokens ?? null,
        requests: stop?.requests ?? null, cost, saving, savingCounted: applied === 'yes' ? saving : 0,
      };
    });

  const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  return {
    rows,
    totals: {
      runs: rows.length,
      compacted: rows.filter((r) => r.compacted).length,
      applied: rows.filter((r) => r.applied === 'yes').length,
      notApplied: rows.filter((r) => r.applied === 'no').length,
      unverified: rows.filter((r) => r.applied === 'unknown').length,
      cost: sum('cost'),
      missingCost: rows.filter((r) => r.cost === null).length,
      saved: sum('savingCounted'),
      savedUnverified: rows.filter((r) => r.applied === 'unknown').reduce((s, r) => s + r.saving, 0),
    },
  };
}

// ---------- rendering ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => (n === null ? '–' : '$' + n.toFixed(n < 0.01 ? 5 : 4));
const num = (n) => (n === null ? '–' : n.toLocaleString('en-US'));

export function renderHtml({ rows, totals: t }, source) {
  const max = Math.max(1, ...rows.map((r) => r.orig));
  const badge = (r) =>
    !r.compacted ? '<span class="b mute">passthrough</span>'
    : r.applied === 'yes' ? '<span class="b ok">compacted ✓ applied</span>'
    : r.applied === 'no' ? '<span class="b bad">compacted ✗ NOT applied</span>'
    : '<span class="b warn">compacted · unverified</span>';
  const body = rows.map((r) => `
    <tr>
      <td>${esc(r.ts.slice(0, 19).replace('T', ' '))}<div class="sub">${esc(r.model)}</div></td>
      <td>${esc(r.desc || '–')}</td>
      <td class="bars">
        <div class="bar orig" style="width:${((r.orig / max) * 100).toFixed(1)}%"></div>
        <div class="bar fin" style="width:${((r.final / max) * 100).toFixed(1)}%"></div>
        <div class="sub">${num(r.orig)} → ${num(r.final)} tokens</div>
      </td>
      <td>${badge(r)}</td>
      <td class="n">${num(r.input)}<div class="sub">cache read ${num(r.cacheRead)}</div></td>
      <td class="n">${num(r.output)}<div class="sub">${r.requests ?? '–'} requests</div></td>
      <td class="n">${usd(r.cost)}</td>
      <td class="n">${r.compacted ? usd(r.saving) : '–'}</td>
    </tr>`).join('');
  const card = (label, value, note = '') => `<div class="card"><div class="lbl">${label}</div><div class="val">${value}</div>${note ? `<div class="sub">${note}</div>` : ''}</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prompt Budget Report</title>
<style>
:root{--bg:#f7f6f2;--fg:#1c1c1a;--mute:#6b6a64;--card:#fff;--line:#e4e2da;--ok:#1e7a4c;--bad:#b3261e;--warn:#9a6700;--orig:#c9c6bb;--fin:#1e7a4c}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mute:#9a988f;--card:#1f1f1c;--line:#34332e;--ok:#5cc58f;--bad:#f28b82;--warn:#e3b341;--orig:#4a483f;--fin:#5cc58f}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--mute);font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.lbl{color:var(--mute);font-size:12px}.val{font-size:22px;font-weight:600}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:860px}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{font-size:12px;color:var(--mute);font-weight:500}tr:last-child td{border-bottom:0}.n{text-align:right;font-variant-numeric:tabular-nums}th.n{text-align:right}
.bars{min-width:200px}.bar{height:7px;border-radius:4px;margin-bottom:3px}.bar.orig{background:var(--orig)}.bar.fin{background:var(--fin)}
.b{display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;border:1px solid currentColor;white-space:nowrap}
.b.ok{color:var(--ok)}.b.bad{color:var(--bad)}.b.warn{color:var(--warn)}.b.mute{color:var(--mute)}
.note{margin-top:16px;color:var(--mute);font-size:12px}.note li{margin:3px 0}.empty{padding:28px;text-align:center;color:var(--mute)}
</style></head><body><main>
<h1>Prompt Budget Report</h1>
<div class="sub">Subagent runs from <code>${esc(source)}</code> · generated ${esc(new Date().toISOString().slice(0, 19).replace('T', ' '))} UTC</div>
<div class="cards">
${card('Subagent runs', t.runs)}
${card('Compacted', t.compacted, `${t.applied} verified applied · ${t.unverified} unverified${t.notApplied ? ` · <b>${t.notApplied} NOT applied</b>` : ''}`)}
${card('Total cost', usd(t.cost), t.missingCost ? `${t.missingCost} run(s) without usage yet — partial` : 'all runs have usage')}
${card('Est. saved', usd(t.saved), `verified-applied only${t.savedUnverified ? ` · +${usd(t.savedUnverified)} unverified` : ''}`)}
</div>
<div class="wrap">${rows.length ? `<table>
<thead><tr><th>Time</th><th>Subagent</th><th>Prompt tokens <span class="sub">(grey = original, green = sent)</span></th><th>Status</th><th class="n">Input tokens</th><th class="n">Output tokens</th><th class="n">Cost</th><th class="n">Est. saved</th></tr></thead>
<tbody>${body}</tbody></table>` : '<div class="empty">No runs logged yet. Spawn a subagent first.</div>'}</div>
<ul class="note">
<li><b>Est. saved</b> only counts the first request's input: the prompt priced at the tier it would have hit without compaction vs. the compacted one. Later turns also benefit, so this is a lower bound.</li>
<li><b>applied</b> is checked from the subagent's own transcript (size of its first prompt), so it proves the hook's rewrite was really used. "unverified" = no SubagentStop/transcript data yet.</li>
<li>Prices: Haiku 5.5 tier 1 ≤100k $0.10 in / $0.50 out / $0.01 cache read per 1M; tier 2 &gt;100k $0.50 / $2.50. Cache-write (1.25× input) and tier-2 cache-read (0.1× input) are assumptions. The tier is picked from the average context of one request.</li>
<li>Token usage is parsed from an undocumented transcript format; if it breaks, columns show – instead of wrong numbers.</li>
</ul></main></body></html>`;
}

function renderText({ rows, totals: t }) {
  console.table(rows.map((r) => ({
    time: r.ts.slice(11, 19), model: r.model, orig: r.orig, final: r.final, compacted: r.compacted ? 'yes' : 'no', applied: r.applied,
    in: r.input ?? '-', cache_read: r.cacheRead ?? '-', out: r.output ?? '-', cost: r.cost === null ? '-' : usd(r.cost), est_saved: usd(r.saving), desc: r.desc.slice(0, 28),
  })));
  console.log(`runs: ${t.runs}, compacted: ${t.compacted} (applied ${t.applied}, unverified ${t.unverified}, NOT applied ${t.notApplied}), cost: ${usd(t.cost)}${t.missingCost ? ` (partial: ${t.missingCost} run(s) w/o usage)` : ''}, est. saved (verified, first request only): ${usd(t.saved)}`);
}

// ---------- CLI ----------

function readEvents(file) {
  return readFileSync(file, 'utf8').split('\n').flatMap((l) => {
    if (!l.trim()) return [];
    try { return [JSON.parse(l)]; } catch { return []; } // skip truncated/corrupt lines
  });
}

function openInBrowser(file) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const outIdx = args.indexOf('--out');
  const out = outIdx === -1 ? null : args[outIdx + 1];
  const file = args.find((a, i) => !a.startsWith('--') && i !== outIdx + 1) ?? logPath();

  if (!existsSync(file)) {
    console.log(`No log yet at ${file}. Spawn a subagent first.`);
    process.exit(0);
  }
  const report = buildReport(readEvents(file));
  if (flag('--text')) renderText(report);
  else {
    const dest = out ?? join(dirname(file), 'report.html');
    writeFileSync(dest, renderHtml(report, file));
    console.log(`Report written: ${dest}`);
    if (!flag('--no-open')) openInBrowser(dest);
  }
}
