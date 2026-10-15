#!/usr/bin/env node
// Builds a self-contained pr-<id>.execution-log.html for one review-pr-laya-classify run: what the
// agent did, step by step, and the real token usage the API reported (read from the Claude Code
// session transcript). Adapted from the web-test skill's build_execution_log.mjs.
//
// Usage: node build_execution_log.mjs <pr-<id>.json> [--transcript <file.jsonl>] [--from <ISO>] [--to <ISO>]
//   <pr-<id>.json>  the PR file written by pr-fetch.mjs; the sibling pr-<id>.findings.json,
//                   .laya.json, .md and .run-notes.json are read when present
//   --transcript    default: the newest transcript that mentions this PR's files, first in
//                   ~/.claude/projects/<cwd-slug>/, then in every project folder
//   --from/--to     review window; default: from the user message that started the review
//                   (the one before the first pr-fetch.mjs call for this PR) to the next user
//                   message after the report was last written, else the end of the transcript
// Optional pr-<id>.run-notes.json adds the human summary:
//   { "objective": "…", "steps": [{ "title": "…", "assumption": "…", "result": "…", "status": "ok|warn|error|blocked" }],
//     "insights": ["…"] }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { counts, merge, score, verdict, normLabel } from './laya-severity.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const prFile = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!prFile || !fs.existsSync(prFile)) {
  console.error('Usage: node build_execution_log.mjs <pr-<id>.json> [--transcript f.jsonl] [--from ISO] [--to ISO]');
  process.exit(2);
}
const runDir = path.dirname(path.resolve(prFile));
const stem = path.basename(prFile).replace(/\.json$/i, ''); // pr-<id>
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'));
  } catch {
    return null;
  }
};
const pr = readJson(`${stem}.json`) ?? {};
const findingsRaw = readJson(`${stem}.findings.json`);
const findings = (Array.isArray(findingsRaw) ? findingsRaw : findingsRaw?.findings ?? [])
  .map((f) => ({ ...f, severity: normLabel(f.severity) }))
  .filter((f) => f.severity);
const layaLog = readJson(`${stem}.laya.json`);
const notes = readJson(`${stem}.run-notes.json`);

// A transcript belongs to this review when it ran pr-fetch.mjs for this PR id.
const prId = String(pr.id ?? stem.replace(/^pr-/, ''));
const fetchRe = new RegExp(`pr-fetch\\.mjs[^\\n]{0,200}?\\b${prId}\\b`);
const mentions = (text) => fetchRe.test(text);

function transcriptsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}
function defaultTranscript() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const own = transcriptsIn(path.join(root, process.cwd().replace(/[:\\/]/g, '-')));
  const all = fs.existsSync(root)
    ? fs.readdirSync(root).flatMap((d) => transcriptsIn(path.join(root, d))).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  return [...own, ...all].find((f) => mentions(fs.readFileSync(f, 'utf8')));
}
const transcript = opt('--transcript') ?? defaultTranscript();
if (!transcript || !fs.existsSync(transcript)) {
  console.error(`No transcript mentions ${stem} (${transcript ?? 'none found'}). Pass --transcript <file.jsonl>.`);
  process.exit(2);
}

const allEntries = fs
  .readFileSync(transcript, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

// A real user message (typed text, not a tool result or a system wrapper).
const isUserText = (e) => {
  if (e.type !== 'user') return false;
  const c = e.message?.content;
  if (typeof c === 'string') return !c.startsWith('<');
  return Array.isArray(c) && !c.some((x) => x.type === 'tool_result') && c.some((x) => x.type === 'text' && !x.text.startsWith('<'));
};
const firstFetch = allEntries.findIndex((e) => e.type === 'assistant' &&
  (e.message?.content ?? []).some((b) => b.type === 'tool_use' && fetchRe.test(b.input?.command ?? '')));
let startIdx = 0;
if (firstFetch > -1) {
  startIdx = firstFetch;
  for (let i = firstFetch; i >= 0; i--) if (isUserText(allEntries[i])) { startIdx = i; break; }
}
const reportName = `${stem}.md`;
let lastReport = -1;
allEntries.forEach((e, i) => { if (e.type === 'assistant' && JSON.stringify(e.message?.content ?? '').includes(reportName)) lastReport = i; });
let endIdx = allEntries.length - 1;
if (lastReport > -1) {
  const next = allEntries.findIndex((e, i) => i > lastReport && isUserText(e));
  if (next > -1) endIdx = next - 1;
}
const autoFrom = allEntries[startIdx]?.timestamp;
const autoTo = allEntries[endIdx]?.timestamp;
const from = opt('--from') ?? autoFrom;
const to = opt('--to') ?? autoTo;
const fromMs = from ? Date.parse(from) : -Infinity;
const toMs = to ? Date.parse(to) : Infinity;

const entries = allEntries.filter((e) => {
  const t = Date.parse(e.timestamp ?? '');
  return Number.isNaN(t) || (t >= fromMs && t <= toMs);
});

// ---------- parse ----------
const oneLine = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const redact = (s) =>
  String(s)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|secret|apikey|api_key)["'=:\s]+)[^\s"',]+/gi, '$1[REDACTED]');
const shortTool = (n) =>
  n.replace(/^mcp__claude-in-chrome__/, 'chrome:').replace(/^mcp__chrome-devtools__/, 'devtools:').replace(/^mcp__Claude_Browser__/, 'pane:');

function summarizeInput(name, input = {}) {
  if (name === 'Bash' || name === 'PowerShell')
    return { label: input.description ?? '', detail: oneLine(input.command, 400) };
  if (['Read', 'Write', 'Edit'].includes(name)) return { label: input.file_path ?? '', detail: '' };
  if (name === 'Grep' || name === 'Glob') return { label: `${input.pattern ?? ''} ${input.path ?? ''}`, detail: '' };
  if (name.endsWith('browser_batch'))
    return {
      label: (input.actions ?? [])
        .map((a) => `${a.name}${a.input?.action ? `:${a.input.action}` : ''}`)
        .join(' → '),
      detail: (input.actions ?? [])
        .map((a) => a.input?.action_summary ?? a.input?.url ?? a.input?.query ?? '')
        .filter(Boolean)
        .join(' · '),
    };
  if (name.endsWith('__computer')) return { label: [input.action, input.action_summary].filter(Boolean).join(' — '), detail: '' };
  if (name.endsWith('__navigate')) return { label: input.url ?? '', detail: '' };
  if (name.endsWith('__find')) return { label: input.query ?? '', detail: '' };
  if (name.endsWith('__javascript_tool')) return { label: 'run JS in page', detail: oneLine(input.text, 400) };
  if (name === 'ToolSearch') return { label: input.query ?? '', detail: '' };
  return { label: oneLine(JSON.stringify(input), 200), detail: '' };
}
function summarizeResult(b) {
  const c = b.content;
  const text = Array.isArray(c) ? c.map((x) => x.text ?? (x.type === 'image' ? '[image]' : '')).join(' ') : String(c ?? '');
  const err = !!b.is_error || /^(Exit code [1-9]|ERROR:|Error:)/.test(text.trim());
  return { ok: !err, text: oneLine(text, 400) };
}

const items = []; // {kind:'user'|'step'}
const byMsg = new Map();
const toolIndex = new Map();
for (const e of entries) {
  if (e.type === 'user') {
    const c = e.message?.content;
    if (typeof c === 'string') {
      if (!c.startsWith('<')) items.push({ kind: 'user', ts: e.timestamp, text: c });
      continue;
    }
    if (!Array.isArray(c)) continue;
    const hasResult = c.some((x) => x.type === 'tool_result');
    for (const b of c) {
      if (b.type === 'tool_result' && toolIndex.has(b.tool_use_id)) {
        const { step, i } = toolIndex.get(b.tool_use_id);
        step.calls[i].result = summarizeResult(b);
      } else if (!hasResult && b.type === 'text' && !b.text.startsWith('<')) {
        items.push({ kind: 'user', ts: e.timestamp, text: b.text });
      }
    }
    continue;
  }
  if (e.type !== 'assistant' || !e.message || e.message.model === '<synthetic>') continue;
  const id = e.message.id ?? e.uuid;
  let step = byMsg.get(id);
  if (!step) {
    step = { kind: 'step', ts: e.timestamp, model: e.message.model, text: [], calls: [], usage: {} };
    byMsg.set(id, step);
    items.push(step);
  }
  if (e.message.usage) step.usage = e.message.usage;
  for (const b of e.message.content ?? []) {
    // Visible narration only — internal reasoning blocks are deliberately not logged.
    if (b.type === 'text' && b.text.trim()) step.text.push(b.text.trim());
    if (b.type === 'tool_use') {
      step.calls.push({ name: b.name, ...summarizeInput(b.name, b.input), result: null });
      toolIndex.set(b.id, { step, i: step.calls.length - 1 });
    }
  }
}
const steps = items.filter((x) => x.kind === 'step');
steps.forEach((s, i) => {
  const u = s.usage;
  s.n = i + 1;
  s.inTotal = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  s.out = u.output_tokens ?? 0;
  s.hasError = s.calls.some((c) => c.result && !c.result.ok);
});

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const tot = {
  input: sum(steps, (s) => s.usage.input_tokens ?? 0),
  cacheWrite: sum(steps, (s) => s.usage.cache_creation_input_tokens ?? 0),
  cacheRead: sum(steps, (s) => s.usage.cache_read_input_tokens ?? 0),
  output: sum(steps, (s) => s.out),
};
tot.inTotal = tot.input + tot.cacheWrite + tot.cacheRead;
const allCalls = steps.flatMap((s) => s.calls);
const toolCount = Object.entries(
  allCalls.reduce((m, c) => ((m[shortTool(c.name)] = (m[shortTool(c.name)] ?? 0) + 1), m), {}),
).sort((a, b) => b[1] - a[1]);
const errCount = allCalls.filter((c) => c.result && !c.result.ok).length;

// Phases = stretches between user messages.
const phases = [];
let ph = null;
for (const it of items) {
  if (it.kind === 'user') {
    ph = { title: oneLine(it.text, 90), steps: [] };
    phases.push(ph);
  } else {
    if (!ph) phases.push((ph = { title: '(start of window)', steps: [] }));
    ph.steps.push(it);
  }
}
const firstTs = steps[0]?.ts;
const lastTs = steps.at(-1)?.ts;
const durMin = firstTs && lastTs ? Math.round((Date.parse(lastTs) - Date.parse(firstTs)) / 60000) : 0;
const models = [...new Set(steps.map((s) => s.model).filter(Boolean))].join(', ');

// Review outcome, recomputed from the final findings exactly as assess.mjs does.
const sev = findingsRaw ? counts(findings) : null;
const outcome = sev ? { verdict: verdict(sev), merge: merge(sev), score: score(sev) } : null;
const ls = layaLog?.summary;
const layaLine = !layaLog
  ? 'Laya: no log (off, or the step was skipped)'
  : ls?.server === 'down'
    ? `Laya: unavailable — server down at ${layaLog.url}; all ${ls.findings} findings kept Claude's severity`
    : `Laya (${layaLog.mode}): ${ls.findings} findings · agree ${ls.agree} · differs ${ls.differs} (low-confidence ${ls.lowConfidence}) · ${layaLog.mode === 'recheck' ? `re-checked ${ls.rechecks}` : `would flag ${ls.wouldFlag}`} · unavailable ${ls.unavailable} · ${(ls.ms / 1000).toFixed(1)}s`;
const rechecks = (layaLog?.results ?? []).filter((r) => r.recheckResult);
const lm = layaLog?.merge;
const mergeLine = !lm ? '' : !lm.laya
  ? 'Laya merge question: unavailable'
  : `Laya merge question: ${lm.laya.label} (P(Blocked) ${lm.laya.pBlock ?? '?'}, blocked at ≥ ${lm.laya.threshold ?? '?'}; Laya top: ${lm.laya.topLabel ?? '?'}) · rule on final severities: ${lm.final ?? lm.rule} · ${lm.finalStatus ?? lm.status}${lm.fromLayaSeverities ? ` · implied by Laya's per-finding labels: ${lm.fromLayaSeverities}` : ''} (log only)`;

// ---------- render helpers ----------
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtN = (n) => n.toLocaleString('en-US');
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const hhmm = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour12: false }) : '');
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
};

// Vertical bar chart: one bar per model turn, single series (no legend; the title names it).
function columnChart(id, values, tipFor) {
  const W = 1000, H = 220, L = 48, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(...values, 1));
  const pw = W - L - R, ph = H - T - B;
  const slot = pw / Math.max(values.length, 1);
  const bw = Math.max(1, slot - 2); // 2px surface gap between bars
  const y = (v) => T + ph - (v / max) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  let g = ticks
    .map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtK(t)}</text>`)
    .join('');
  const every = Math.ceil(values.length / 20);
  values.forEach((v, i) => {
    const x = L + i * slot + 1;
    const h = (v / max) * ph;
    const r = Math.min(4, bw / 2, h);
    const top = T + ph - h;
    if (h > 0)
      g += `<path class="bar" d="M${x},${T + ph}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${T + ph}Z"/>`;
    if (i % every === 0) g += `<text class="tick" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${i + 1}</text>`;
    g += `<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" data-tip="${esc(tipFor(i))}"/>`;
  });
  return `<svg id="${id}" class="chart" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="none">${g}</svg>`;
}
// Horizontal bars with direct value labels (tool calls by type).
function barList(rows) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="hbars">${rows
    .map(
      ([k, v]) =>
        `<div class="hrow" data-tip="${esc(`${k}: ${v} call${v > 1 ? 's' : ''}`)}"><span class="hk">${esc(k)}</span><span class="htrack"><span class="hbar" style="width:${(v / max) * 100}%"></span></span><span class="hv">${v}</span></div>`,
    )
    .join('')}</div>`;
}
const STATUS = { ok: ['✓', 'ok'], pass: ['✓', 'ok'], warn: ['!', 'warn'], error: ['✕', 'err'], fail: ['✕', 'err'], blocked: ['⏸', 'warn'] };
const statusPill = (s) => {
  const [icon, cls] = STATUS[s] ?? ['•', 'muted'];
  return `<span class="pill p-${cls}">${icon} ${esc(s)}</span>`;
};

// ---------- sections ----------
const title = `Execution log PR ${pr.id ?? stem}`;

const tiles = [
  ['Model turns', fmtN(steps.length)],
  ['Input tokens', fmtK(tot.inTotal), `${fmtN(tot.inTotal)}`],
  ['Cache read share', tot.inTotal ? `${((tot.cacheRead / tot.inTotal) * 100).toFixed(1)}%` : '—', `${fmtN(tot.cacheRead)} cached`],
  ['Output tokens', fmtK(tot.output), fmtN(tot.output)],
  ['Tool calls', fmtN(allCalls.length), `${errCount} with error`],
  ['Active time', `${durMin} min`, `${hhmm(firstTs)} → ${hhmm(lastTs)}`],
]
  .map(([k, v, sub]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="muted small">${esc(sub)}</div>` : ''}</div>`)
  .join('');

const phaseRows = phases
  .filter((p) => p.steps.length)
  .map((p) => {
    const ins = sum(p.steps, (s) => s.inTotal), outs = sum(p.steps, (s) => s.out);
    return `<tr><td>${esc(p.title)}</td><td class="num">${p.steps.length}</td><td class="num">${fmtN(ins)}</td><td class="num">${fmtN(outs)}</td><td class="num">${fmtN(Math.round(ins / p.steps.length))}</td></tr>`;
  })
  .join('');

const notesHtml = notes
  ? `<section><h2>Summary</h2>
${notes.objective ? `<p>${esc(notes.objective)}</p>` : ''}
${notes.steps?.length ? `<ol class="nsteps">${notes.steps
      .map(
        (s) => `<li><div class="nhead"><strong>${esc(s.title)}</strong>${statusPill(s.status ?? 'ok')}</div>
${s.assumption ? `<div class="small"><span class="muted">Assumption:</span> ${esc(s.assumption)}</div>` : ''}
${s.result ? `<div class="small"><span class="muted">Result:</span> ${esc(s.result)}</div>` : ''}</li>`,
      )
      .join('')}</ol>` : ''}
${notes.insights?.length ? `<h3>Cost &amp; debug insights</h3><ul>${notes.insights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
</section>`
  : '';

let logHtml = '';
let curPhase = '';
for (const it of items) {
  if (it.kind === 'user') {
    logHtml += `<div class="umsg"><span class="muted small">${hhmm(it.ts)} · User</span><div>${esc(redact(oneLine(it.text, 600)))}</div></div>`;
    continue;
  }
  const s = it;
  const tools = s.calls.map((c) => shortTool(c.name)).join(', ') || 'text only';
  logHtml += `<details class="step" data-err="${s.hasError ? 1 : 0}" id="s${s.n}">
<summary><span class="sn">#${s.n}</span><span class="muted small">${hhmm(s.ts)}</span><span class="stools">${esc(tools)}</span>${s.hasError ? statusPill('error') : ''}<span class="stok">in ${fmtK(s.inTotal)} · out ${fmtN(s.out)}</span></summary>
<div class="sbody">
${s.text.length ? `<blockquote>${esc(redact(s.text.join('\n\n')))}</blockquote>` : ''}
${s.calls
  .map(
    (c) => `<div class="call"><div><code class="tname">${esc(shortTool(c.name))}</code> ${esc(redact(c.label))}</div>
${c.detail ? `<pre>${esc(redact(c.detail))}</pre>` : ''}
${c.result ? `<div class="res ${c.result.ok ? 'r-ok' : 'r-err'}">${c.result.ok ? '✓' : '✕'} ${esc(redact(c.result.text))}</div>` : ''}</div>`,
  )
  .join('')}
<div class="muted small">Tokens — input ${fmtN(s.usage.input_tokens ?? 0)} · cache write ${fmtN(s.usage.cache_creation_input_tokens ?? 0)} · cache read ${fmtN(s.usage.cache_read_input_tokens ?? 0)} · output ${fmtN(s.out)}</div>
</div></details>`;
}

const tip = (i) => {
  const s = steps[i];
  return `Turn #${s.n} · ${hhmm(s.ts)}\nInput ${fmtN(s.inTotal)} · Output ${fmtN(s.out)}\n${s.calls.map((c) => shortTool(c.name)).join(', ') || 'text only'}`;
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f7f5;--card:#fcfcfb;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e0;--grid:#ecebe8;
--series:#2a78d6;--ok:#0ca30c;--ok-ink:#006300;--ok-bg:#e5f4ea;--err:#d03b3b;--err-bg:#fbe9e7;--warn:#8a5a00;--warn-bg:#fff3d6;--accent:#2a78d6}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141416;--card:#1a1a19;--fg:#ececef;--muted:#9a9aa2;--line:#2e2e33;--grid:#262624;
--series:#3987e5;--ok:#0ca30c;--ok-ink:#6fd08f;--ok-bg:#16301f;--err:#ff8a80;--err-bg:#3a1a18;--warn:#ffcc66;--warn-bg:#352a10;--accent:#8fb0ff}}
:root[data-theme="dark"]{--bg:#141416;--card:#1a1a19;--fg:#ececef;--muted:#9a9aa2;--line:#2e2e33;--grid:#262624;
--series:#3987e5;--ok:#0ca30c;--ok-ink:#6fd08f;--ok-bg:#16301f;--err:#ff8a80;--err-bg:#3a1a18;--warn:#ffcc66;--warn-bg:#352a10;--accent:#8fb0ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}h3{font-size:14px;margin:14px 0 6px}
a{color:var(--accent)}.muted{color:var(--muted)}.small{font-size:12px}
.sub{color:var(--muted);margin:0 0 16px}
.verdict{display:inline-block;font-weight:700;padding:4px 12px;border-radius:999px;font-size:13px;background:var(--warn-bg);color:var(--warn)}
.v-PASS{background:var(--ok-bg);color:var(--ok-ink)}.v-FAIL{background:var(--err-bg);color:var(--err)}
.grid6{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.tile .v{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tablewrap{overflow-x:auto}
.chart{width:100%;height:220px;display:block}
.chart .grid{stroke:var(--grid);stroke-width:1}.chart .tick{fill:var(--muted);font-size:11px}
.chart .bar{fill:var(--series)}.chart .hit{fill:transparent;cursor:crosshair}.chart .hit:hover{fill:var(--grid);opacity:.5}
.two{display:grid;grid-template-columns:1fr;gap:16px}
.hbars{display:flex;flex-direction:column;gap:6px}
.hrow{display:grid;grid-template-columns:minmax(120px,190px) 1fr 36px;gap:8px;align-items:center}
.hk{font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}
.htrack{height:12px}.hbar{display:block;height:100%;background:var(--series);border-radius:0 4px 4px 0;min-width:2px}
.hv{text-align:right;font-variant-numeric:tabular-nums}
.pill{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;white-space:nowrap}
.p-ok{background:var(--ok-bg);color:var(--ok-ink)}.p-err{background:var(--err-bg);color:var(--err)}.p-warn{background:var(--warn-bg);color:var(--warn)}.p-muted{color:var(--muted)}
.nsteps{padding-left:20px;margin:0}.nsteps li{margin:0 0 10px}.nhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.filters button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:4px 12px;cursor:pointer;font:inherit}
.filters button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.umsg{border-left:3px solid var(--accent);padding:6px 10px;margin:14px 0 8px;background:var(--bg);border-radius:0 6px 6px 0}
.step{border:1px solid var(--line);border-radius:8px;margin:6px 0}
.step[data-err="1"]{border-left:4px solid var(--err)}
.step>summary{cursor:pointer;padding:8px 10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;list-style:none}
.step>summary::-webkit-details-marker{display:none}
.sn{font-weight:700;font-family:ui-monospace,Consolas,monospace}.stools{flex:1;min-width:160px;font-size:13px}
.stok{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.sbody{padding:0 12px 12px}
blockquote{margin:6px 0 10px;padding:6px 10px;border-left:3px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.call{border-top:1px dashed var(--line);padding:8px 0}
.tname{font-weight:600}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;font-size:12px;background:var(--bg);padding:6px 8px;border-radius:6px}
.res{font-size:12px;overflow-wrap:anywhere;margin-top:4px}.r-ok{color:var(--muted)}.r-err{color:var(--err)}
#tip{position:fixed;pointer-events:none;background:var(--fg);color:var(--bg);padding:6px 8px;border-radius:6px;font-size:12px;white-space:pre;display:none;z-index:9;max-width:320px}
@media print{.filters{display:none}details{display:block}}
</style></head>
<body><main>
<h1>PR #${esc(pr.id ?? '')} — ${esc(pr.title ?? 'Execution log')}</h1>
<p class="sub">Execution log · review-pr-laya-classify · ${esc(pr.repoPath ?? pr.repoId ?? '')}${pr.sourceBranch ? ` · ${esc(pr.sourceBranch)} → ${esc(pr.targetBranch ?? '')}` : ''} · ${esc(models)}${pr.url ? ` · <a href="${esc(pr.url)}">Open PR</a>` : ''}</p>
${outcome ? `<div><span class="verdict v-${outcome.merge === 'Blocked' ? 'FAIL' : outcome.merge === 'Eligible' ? 'PASS' : 'WARN'}">${esc(outcome.verdict)} · Merge: ${esc(outcome.merge)}</span> <span class="muted small">— score ${outcome.score}/100 · 🔴 ${sev.Critical} · 🟠 ${sev.Major} · 🟡 ${sev.Minor} · 🔵 ${sev.Suggestion} (details in ${esc(stem)}.md)</span></div>` : ''}
<p class="small" style="margin:8px 0 0">${esc(layaLine)}</p>
${mergeLine ? `<p class="small" style="margin:4px 0 0">${esc(mergeLine)}</p>` : ''}
${rechecks.length ? `<ul class="small">${rechecks.map((r) => `<li>re-check ${esc(r.id)}: ${esc(r.recheckResult.result)} ${esc(r.recheckResult.from)}${r.final !== r.recheckResult.from ? ` → ${esc(r.final)}` : ''} (Laya ${esc(r.laya?.label ?? '?')} ${r.laya?.confidence ?? ''})${r.recheckResult.reason ? ` — ${esc(r.recheckResult.reason)}` : ''}</li>`).join('')}</ul>` : ''}
<div class="grid6">${tiles}</div>

${notesHtml}

<section><h2>Token usage by phase</h2>
<p class="muted small">Real values from the API <code>usage</code> fields in the session transcript — not estimates. Input = uncached + cache write + cache read.</p>
<div class="tablewrap"><table><tr><th>Phase (user message that started it)</th><th class="num">Turns</th><th class="num">Input</th><th class="num">Output</th><th class="num">Avg input / turn</th></tr>
${phaseRows}
<tr><th>Total</th><th class="num">${steps.length}</th><th class="num">${fmtN(tot.inTotal)}</th><th class="num">${fmtN(tot.output)}</th><th class="num">${fmtN(Math.round(tot.inTotal / Math.max(steps.length, 1)))}</th></tr></table></div>
<p class="muted small">Input split — uncached ${fmtN(tot.input)} · cache write ${fmtN(tot.cacheWrite)} · cache read ${fmtN(tot.cacheRead)}</p>
</section>

<section><h2>Input tokens per model turn</h2>
<p class="muted small">Each turn re-reads the whole conversation, so this tracks context size. A high flat line means a long session before the run started.</p>
${columnChart('cin', steps.map((s) => s.inTotal), tip)}
<h2 style="margin-top:16px">Output tokens per model turn</h2>
${columnChart('cout', steps.map((s) => s.out), tip)}
<p class="muted small">x-axis: turn number. Hover a column for details; click to jump to that step.</p>
</section>

<section><h2>Tool calls by type</h2>${barList(toolCount)}</section>

<section><h2>Step-by-step log</h2>
<p class="muted small">Every model turn with its visible narration, tool calls and a one-line result. Internal reasoning is not logged; token/password-like values are redacted.</p>
<div class="filters"><button class="on" data-f="all">All (${steps.length})</button><button data-f="err">With errors (${steps.filter((s) => s.hasError).length})</button><button data-f="open">Expand all</button></div>
${logHtml}
</section>
<p class="muted small">Transcript: ${esc(path.basename(transcript))} · window ${esc(from ?? 'start')} → ${esc(to ?? 'end')}</p>
</main>
<div id="tip"></div>
<script>
const tipEl=document.getElementById('tip');
document.querySelectorAll('[data-tip]').forEach(el=>{
  el.addEventListener('mousemove',e=>{tipEl.textContent=el.dataset.tip;tipEl.style.display='block';
    const x=Math.min(e.clientX+12,innerWidth-tipEl.offsetWidth-8);tipEl.style.left=x+'px';tipEl.style.top=(e.clientY+12)+'px'});
  el.addEventListener('mouseleave',()=>tipEl.style.display='none');
});
document.querySelectorAll('.chart .hit').forEach((h,i,all)=>{const n=(i%(all.length/2))+1;h.addEventListener('click',()=>{const d=document.getElementById('s'+n);if(d){d.open=true;d.scrollIntoView({behavior:'smooth',block:'center'})}})});
document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{
  const f=b.dataset.f;
  if(f==='open'){const open=b.textContent==='Expand all';document.querySelectorAll('.step').forEach(d=>d.open=open);b.textContent=open?'Collapse all':'Expand all';return}
  document.querySelectorAll('.filters button:not([data-f=open])').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.step').forEach(d=>{d.style.display=(f==='all'||d.dataset.err==='1')?'':'none'});
});
</script>
</body></html>`;

const out = path.join(runDir, `${stem}.execution-log.html`);
fs.writeFileSync(out, html);
console.log(`Turns: ${steps.length} · input ${fmtN(tot.inTotal)} (cache read ${fmtN(tot.cacheRead)}) · output ${fmtN(tot.output)} · tool calls ${allCalls.length} (${errCount} errors) · ${durMin} min`);
if (!notes) console.log(`NOTE: no ${stem}.run-notes.json — Summary section omitted.`);
console.log(`Log: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
