#!/usr/bin/env node
// Builds a self-contained report.html from <runDir>/results.json + <runDir>/shots/.
// Usage: node build_report.mjs <runDir> [--out report.html]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const runDir = args.find((a) => !a.startsWith('--'));
if (!runDir) {
  console.error('Usage: node build_report.mjs <runDir> [--out report.html]');
  process.exit(2);
}
const outIdx = args.indexOf('--out');
const outFile = path.resolve(runDir, outIdx >= 0 ? args[outIdx + 1] : 'report.html');
const results = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));

// Worst-status-wins, so a hand-edited case status can't mask a failed step.
const RANK = { fail: 4, blocked: 3, skipped: 2, 'not-run': 1, pass: 0 };
const worst = (statuses) =>
  statuses.reduce((w, s) => ((RANK[s] ?? 1) > (RANK[w] ?? 1) ? s : w), 'pass');

const cases = results.cases ?? [];
for (const c of cases) {
  const steps = c.steps ?? [];
  if (steps.length) c.status = worst(steps.map((s) => s.status ?? 'not-run'));
  c.status ??= 'not-run';
}
// Steps left not-run although they were clearly executed (a screenshot exists or actual was written) mean
// results.json was not updated during the run — the report would show the case as never run.
const stale = cases.flatMap((c) => (c.steps ?? []).filter((s) => (s.status ?? 'not-run') === 'not-run' &&
  (s.actual || (s.screenshot && fs.existsSync(path.join(runDir, s.screenshot))))).map((s) => `${c.id}-S${s.n}`));
if (stale.length) {
  console.error(`WARNING: ${stale.length} executed step(s) still not-run in results.json: ${stale.join(', ')} — record them with record.mjs and rebuild`);
  process.exitCode = 3;
}
const count = (s) => cases.filter((c) => c.status === s).length;
const totals = {
  pass: count('pass'),
  fail: count('fail'),
  blocked: count('blocked'),
  skipped: count('skipped'),
  'not-run': count('not-run'),
};
const verdict = totals.fail
  ? 'FAIL'
  : totals.blocked
    ? 'BLOCKED'
    : totals['not-run'] && !totals.pass
      ? 'NOT RUN'
      : totals['not-run']
        ? 'INCOMPLETE'
        : 'PASS';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const missing = [];
function inlineImage(rel) {
  if (!rel) return '';
  const abs = path.resolve(runDir, rel);
  if (!fs.existsSync(abs)) {
    missing.push(rel);
    return `<div class="missing">Screenshot missing: ${esc(rel)}</div>`;
  }
  const mime = MIME[path.extname(abs).toLowerCase()] ?? 'image/png';
  const b64 = fs.readFileSync(abs).toString('base64');
  return `<a class="shot" href="#" data-full="1"><img loading="lazy" alt="${esc(rel)}" src="data:${mime};base64,${b64}"></a>`;
}

const badge = (s) => `<span class="badge s-${esc(s)}">${esc(s)}</span>`;

function diagnostics(d) {
  if (!d) return '';
  const con = d.console ?? [];
  const net = d.network ?? [];
  if (!con.length && !net.length) return '';
  const conHtml = con.length
    ? `<h5>Console</h5><pre>${con.map((m) => esc(typeof m === 'string' ? m : JSON.stringify(m))).join('\n')}</pre>`
    : '';
  const netHtml = net.length
    ? `<h5>Network</h5><table class="net"><tr><th>Method</th><th>Status</th><th>URL</th><th>Excerpt</th></tr>${net
        .map(
          (n) =>
            `<tr><td>${esc(n.method)}</td><td>${esc(n.status)}</td><td class="url">${esc(n.url)}</td><td><code>${esc(
              n.excerpt ?? n.body ?? '',
            )}</code></td></tr>`,
        )
        .join('')}</table>`
    : '';
  return `<details class="diag" open><summary>Diagnostics</summary>${conHtml}${netHtml}</details>`;
}

function caseHtml(c) {
  const steps = (c.steps ?? [])
    .map(
      (s) => `
      <div class="step s-${esc(s.status)}">
        <div class="step-head"><span class="n">Step ${esc(s.n)}</span>${badge(s.status ?? 'not-run')}</div>
        <dl>
          <dt>Action</dt><dd>${esc(s.action)}</dd>
          <dt>Expected</dt><dd>${esc(s.expected)}</dd>
          <dt>Actual</dt><dd>${esc(s.actual) || '<span class="muted">—</span>'}</dd>
        </dl>
        ${diagnostics(s.diagnostics)}
        ${inlineImage(s.screenshot)}
      </div>`,
    )
    .join('');
  const meta = [
    c.ac?.length ? `AC: ${esc(c.ac.join(', '))}` : '',
    c.role ? `Role: ${esc(c.role)}` : '',
    c.priority ? `Priority: ${esc(c.priority)}` : '',
    c.type ? `Type: ${esc(c.type)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `
  <details class="case" id="${esc(c.id)}" data-status="${esc(c.status)}" ${c.status === 'fail' ? 'open' : ''}>
    <summary><span class="cid">${esc(c.id)}</span><span class="ctitle">${esc(c.title)}</span>${badge(c.status)}</summary>
    <div class="case-body">
      <p class="meta">${meta}</p>
      ${c.preconditions ? `<p><strong>Preconditions:</strong> ${esc(c.preconditions)}</p>` : ''}
      ${c.notes ? `<p class="notes"><strong>Notes:</strong> ${esc(c.notes)}</p>` : ''}
      ${steps}
    </div>
  </details>`;
}

// AC traceability: every AC the cases claim, with the cases covering it and the worst result.
const acMap = new Map();
for (const c of cases) for (const ac of c.ac ?? []) (acMap.get(ac) ?? acMap.set(ac, []).get(ac)).push(c);
const acRows = [...acMap.entries()]
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(
    ([ac, cs]) =>
      `<tr><td>${esc(ac)}</td><td>${cs.map((c) => `<a href="#${esc(c.id)}">${esc(c.id)}</a>`).join(', ')}</td><td>${badge(
        worst(cs.map((c) => c.status)),
      )}</td></tr>`,
  )
  .join('');

const t = results.ticket ?? {};
const env = results.environment ?? {};
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { hour12: false }) : '');
const title = `Test report ${t.id ?? ''} ${env.key ?? ''}`.trim();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e0;
--pass:#1f7a3f;--pass-bg:#e5f4ea;--fail:#b3261e;--fail-bg:#fbe9e7;--blocked:#8a5a00;--blocked-bg:#fff3d6;
--skip:#555;--skip-bg:#ececec;--accent:#2f5bd3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141416;--card:#1d1d20;--fg:#ececef;--muted:#9a9aa2;--line:#2e2e33;
--pass:#6fd08f;--pass-bg:#16301f;--fail:#ff8a80;--fail-bg:#3a1a18;--blocked:#ffcc66;--blocked-bg:#352a10;--skip:#bbb;--skip-bg:#2a2a2e;--accent:#8fb0ff}}
:root[data-theme="dark"]{--bg:#141416;--card:#1d1d20;--fg:#ececef;--muted:#9a9aa2;--line:#2e2e33;
--pass:#6fd08f;--pass-bg:#16301f;--fail:#ff8a80;--fail-bg:#3a1a18;--blocked:#ffcc66;--blocked-bg:#352a10;--skip:#bbb;--skip-bg:#2a2a2e;--accent:#8fb0ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}
a{color:var(--accent)}
.sub{color:var(--muted);margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:16px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.tile .v{font-size:24px;font-weight:600}
.verdict{display:inline-block;font-weight:700;padding:4px 12px;border-radius:999px;font-size:14px}
.v-PASS{background:var(--pass-bg);color:var(--pass)}.v-FAIL{background:var(--fail-bg);color:var(--fail)}
.v-BLOCKED,.v-INCOMPLETE,.v-NOT-RUN{background:var(--blocked-bg);color:var(--blocked)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
section h2{font-size:16px;margin:0 0 10px}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px}
.badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-left:8px;white-space:nowrap}
.s-pass.badge{background:var(--pass-bg);color:var(--pass)}.s-fail.badge{background:var(--fail-bg);color:var(--fail)}
.s-blocked.badge{background:var(--blocked-bg);color:var(--blocked)}.s-skipped.badge,.s-not-run.badge{background:var(--skip-bg);color:var(--skip)}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.filters button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:4px 12px;cursor:pointer;font:inherit}
.filters button.on{background:var(--accent);border-color:var(--accent);color:#fff}
.case{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--card)}
.case>summary{cursor:pointer;padding:10px 12px;display:flex;align-items:center;gap:10px;list-style:none}
.case>summary::-webkit-details-marker{display:none}
.case[data-status="fail"]{border-left:4px solid var(--fail)}.case[data-status="blocked"]{border-left:4px solid var(--blocked)}
.case[data-status="pass"]{border-left:4px solid var(--pass)}
.cid{font-weight:700;font-family:ui-monospace,Consolas,monospace}.ctitle{flex:1}
.case-body{padding:0 12px 12px}
.meta{color:var(--muted);margin:0 0 8px}
.step{border-top:1px dashed var(--line);padding:10px 0}
.step-head{display:flex;align-items:center}.n{font-weight:600}
dl{display:grid;grid-template-columns:80px 1fr;gap:2px 10px;margin:6px 0}
dt{color:var(--muted)}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.shot img{display:block;max-width:100%;border:1px solid var(--line);border-radius:6px;margin-top:6px;cursor:zoom-in}
.missing{color:var(--fail);font-style:italic}
.diag{margin:6px 0;background:var(--fail-bg);border-radius:6px;padding:6px 10px}
.diag h5{margin:6px 0 2px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:12px}
.net td{font-size:12px}.url{overflow-wrap:anywhere}
.muted{color:var(--muted)}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:9;cursor:zoom-out}
#lb img{max-width:96vw;max-height:94vh}
@media print{.filters{display:none}.case{break-inside:avoid}details{display:block}}
</style></head>
<body><main>
<h1>${esc(t.id ? `#${t.id} — ` : '')}${esc(t.title)}</h1>
<p class="sub">${esc(t.type)}${t.state ? ` · ${esc(t.state)}` : ''}${t.url ? ` · <a href="${esc(t.url)}">Open in ADO</a>` : ''}</p>

<div><span class="verdict v-${esc(verdict.replace(/ /g, '-'))}">${esc(verdict)}</span></div>
<div class="grid">
  <div class="tile"><div class="k">Environment</div><div class="v" style="font-size:16px">${esc(env.key)}</div><div class="muted" style="overflow-wrap:anywhere">${esc(env.url)}</div></div>
  <div class="tile"><div class="k">Cases</div><div class="v">${cases.length}</div></div>
  <div class="tile"><div class="k">Pass</div><div class="v" style="color:var(--pass)">${totals.pass}</div></div>
  <div class="tile"><div class="k">Fail</div><div class="v" style="color:var(--fail)">${totals.fail}</div></div>
  <div class="tile"><div class="k">Blocked</div><div class="v" style="color:var(--blocked)">${totals.blocked}</div></div>
  <div class="tile"><div class="k">Skipped / not run</div><div class="v">${totals.skipped + totals['not-run']}</div></div>
</div>

<section><h2>Run details</h2><table>
<tr><th>Started</th><td>${esc(fmt(results.startedAt))}</td><th>Finished</th><td>${esc(fmt(results.finishedAt))}</td></tr>
<tr><th>Browser</th><td>${esc(results.browser)}</td><th>Build</th><td>${esc(env.build) || '<span class="muted">not captured</span>'}</td></tr>
<tr><th>Roles</th><td>${esc([...new Set(cases.map((c) => c.role).filter(Boolean))].join(', '))}</td><th>Tester</th><td>${esc(results.tester)}</td></tr>
</table>${results.scope ? `<p>${esc(results.scope)}</p>` : ''}</section>

${acRows ? `<section><h2>Acceptance criteria coverage</h2><table><tr><th>AC</th><th>Cases</th><th>Result</th></tr>${acRows}</table></section>` : ''}

<section><h2>Test cases</h2>
<div class="filters">
  <button class="on" data-f="all">All</button><button data-f="fail">Fail</button><button data-f="blocked">Blocked</button><button data-f="pass">Pass</button>
</div>
${cases.map(caseHtml).join('')}
</section>

${results.observations?.length ? `<section><h2>Other observations</h2><ul>${results.observations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></section>` : ''}
</main>
<div id="lb"><img alt=""></div>
<script>
document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.filters button').forEach(x=>x.classList.toggle('on',x===b));
  const f=b.dataset.f;
  document.querySelectorAll('.case').forEach(c=>{c.style.display=(f==='all'||c.dataset.status===f)?'':'none'});
});
const lb=document.getElementById('lb'),lbi=lb.querySelector('img');
document.querySelectorAll('.shot').forEach(a=>a.onclick=e=>{e.preventDefault();lbi.src=a.querySelector('img').src;lb.style.display='flex'});
lb.onclick=()=>{lb.style.display='none'};
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.style.display='none'});
</script>
</body></html>`;

fs.writeFileSync(outFile, html);
console.log(`Verdict: ${verdict} | pass ${totals.pass} · fail ${totals.fail} · blocked ${totals.blocked} · skipped ${totals.skipped} · not-run ${totals['not-run']}`);
if (missing.length) console.log(`WARNING: ${missing.length} screenshot(s) missing: ${missing.join(', ')}`);
console.log(`Report: ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
