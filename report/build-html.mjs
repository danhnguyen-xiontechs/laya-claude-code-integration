// Build self-contained HTML reports from LAYA-JEV-REPORT.{vi,en}.md.
// Usage: node report/build-html.mjs   (no dependencies)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const VERDICTS = new Set(['ADOPT', 'PILOT', 'SHADOW', 'SHELVED', 'DROP', 'IDEA', 'DONE', 'REWORK', 'INSUFFICIENT_EVIDENCE']);

const LANGS = {
  vi: {
    other: 'en', otherLabel: 'English', toc: 'Mục lục', print: 'In / PDF',
    kpis: [
      ['25', 'skill đã làm', '14 biến thể · 11 skill mới'],
      ['10', 'công cụ mới', 'proxy, hook, 2 mod…'],
      ['14%', 'chi phí subagent', 'rule + leo model, so với luôn Opus'],
      ['18/20', 'ado-classify', 'kết quả tốt nhất của Laya'],
      ['96%', 'Jev write-gate', 'offline, so với Laya 58%'],
      ['1', 'tool giảm token thật', 'smart-context-trimming, A/B agent'],
    ],
  },
  en: {
    other: 'vi', otherLabel: 'Tiếng Việt', toc: 'Contents', print: 'Print / PDF',
    kpis: [
      ['25', 'skills built', '14 variants · 11 new'],
      ['10', 'new tools', 'proxy, hooks, 2 mods…'],
      ['14%', 'subagent cost', 'rules + escalation vs always-Opus'],
      ['18/20', 'ado-classify', "Laya's best result"],
      ['96%', 'Jev write-gate', 'offline, vs Laya 58%'],
      ['1', 'tool cuts tokens', 'smart-context-trimming, agent A/B'],
    ],
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  // Swap code spans for placeholders so bold can wrap them and their content is left untouched.
  const codes = [];
  const masked = text.replace(/`([^`]+)`/g, (_, c) => {
    const code = c.replace(/\\\|/g, '|');
    codes.push(VERDICTS.has(code)
      ? `<span class="v v-${code.toLowerCase()}">${code}</span>`
      : `<code>${esc(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return esc(masked)
    .replace(/\\\|/g, '|')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\\\*/g, '*')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => codes[n]);
}

function splitRow(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
  return cells.map((c) => c.trim());
}

function renderList(lines) {
  // lines: [{indent, ordered, text}] → nested HTML
  let html = '';
  const stack = [];
  for (const it of lines) {
    while (stack.length && it.indent < stack[stack.length - 1].indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    const top = stack[stack.length - 1];
    if (!top || it.indent > top.indent) {
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push({ indent: it.indent, tag });
      html += `<${tag}><li>`;
    } else {
      html += '</li><li>';
    }
    html += inline(it.text);
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function convert(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const toc = [];
  let title = '';
  let meta = '';
  let i = 0;
  let sec = 0;
  let sectionOpen = false;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      const level = m[1].length;
      const text = m[2];
      if (level === 1) {
        title = text;
        // The next non-empty line is the meta line.
        i++;
        while (i < lines.length && !lines[i].trim()) i++;
        meta = inline(lines[i] || '');
        i++;
        continue;
      }
      const id = `s${++sec}`;
      if (level === 2) {
        if (sectionOpen) out.push('</section>');
        out.push(`<section class="${toc.filter((t) => t.level === 2).length === 0 ? 'lead' : ''}">`);
        sectionOpen = true;
      }
      toc.push({ level, id, text });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) { i++; continue; }

    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const paras = buf.join('\n').split(/\n\s*\n/).map((p) => `<p>${p.split('\n').map(inline).join('<br>')}</p>`);
      out.push(`<aside class="note">${paras.join('')}</aside>`);
      continue;
    }

    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const head = splitRow(rows[0]);
      const body = rows.slice(2).map(splitRow);
      let t = '<div class="tw"><table><thead><tr>';
      t += head.map((h) => `<th>${inline(h)}</th>`).join('');
      t += '</tr></thead><tbody>';
      for (const r of body) t += '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
      t += '</tbody></table></div>';
      out.push(t);
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/))) {
        items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      out.push(renderList(items));
      continue;
    }

    // Paragraph: gather until blank line or a block start.
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||---|\s*([-*]|\d+\.)\s)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  if (sectionOpen) out.push('</section>');
  return { title, meta, body: out.join('\n'), toc };
}

const CSS = `
:root{--bg:#f6f7f9;--surface:#fff;--surface2:#f0f2f5;--text:#1b1f24;--muted:#5b6470;--border:#dde1e6;--accent:#3b5bdb;--accent-soft:#e8edff;
--adopt:#1f7a3f;--adopt-bg:#e3f4e8;--pilot:#8a5a00;--pilot-bg:#fff2d6;--shadow:#4a4fb3;--shadow-bg:#eceefe;--drop:#b4232f;--drop-bg:#fde6e8;--shelved:#5b6470;--shelved-bg:#eceef1;--idea:#6b4fa0;--idea-bg:#f1eafb}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111418;--surface:#1a1e24;--surface2:#222831;--text:#e6e9ee;--muted:#9aa4b1;--border:#2e3540;--accent:#8ea2ff;--accent-soft:#232b4a;
--adopt:#6fd38f;--adopt-bg:#17301f;--pilot:#f2c25b;--pilot-bg:#33290f;--shadow:#a9adff;--shadow-bg:#25274a;--drop:#ff8c95;--drop-bg:#3a1a1e;--shelved:#aab3be;--shelved-bg:#272c33;--idea:#c6a8f2;--idea-bg:#2d2340}}
:root[data-theme="dark"]{--bg:#111418;--surface:#1a1e24;--surface2:#222831;--text:#e6e9ee;--muted:#9aa4b1;--border:#2e3540;--accent:#8ea2ff;--accent-soft:#232b4a;
--adopt:#6fd38f;--adopt-bg:#17301f;--pilot:#f2c25b;--pilot-bg:#33290f;--shadow:#a9adff;--shadow-bg:#25274a;--drop:#ff8c95;--drop-bg:#3a1a1e;--shelved:#aab3be;--shelved-bg:#272c33;--idea:#c6a8f2;--idea-bg:#2d2340}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 "Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif}
header.top{background:var(--surface);border-bottom:1px solid var(--border);padding:28px 16px 22px}
.wrap{max-width:1180px;margin:0 auto}
header.top h1{margin:0 0 6px;font-size:28px;line-height:1.25;letter-spacing:-.01em}
header.top .meta{color:var(--muted);font-size:13.5px}
header.top .tools{float:right;display:flex;gap:8px}
header.top .tools a,header.top .tools button{font:inherit;font-size:13px;color:var(--accent);background:var(--accent-soft);border:0;border-radius:6px;padding:5px 10px;text-decoration:none;cursor:pointer}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-top:20px}
.kpi{background:var(--surface2);border-radius:10px;padding:12px 14px}
.kpi b{display:block;font-size:24px;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi span{display:block;font-size:13px;font-weight:600;margin-top:4px}
.kpi small{display:block;color:var(--muted);font-size:12px}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:28px;padding:24px 16px 60px}
nav.toc{position:sticky;top:16px;align-self:start;max-height:calc(100vh - 32px);overflow:auto;font-size:13px}
nav.toc .h{font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:11px;color:var(--muted);margin-bottom:8px}
nav.toc a{display:block;color:var(--text);text-decoration:none;padding:3px 8px;border-radius:5px;border-left:2px solid transparent}
nav.toc a.l3{padding-left:20px;color:var(--muted);font-size:12.5px}
nav.toc a:hover{background:var(--surface2)}
nav.toc a.on{border-left-color:var(--accent);background:var(--accent-soft)}
main section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:6px 24px 18px;margin-bottom:18px}
main section.lead{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
h2{font-size:20px;margin:18px 0 10px;scroll-margin-top:16px}
h3{font-size:16px;margin:22px 0 8px;scroll-margin-top:16px}
p{margin:8px 0}
ul,ol{margin:6px 0 10px;padding-left:22px}
li{margin:3px 0}
code{font-family:Consolas,"Cascadia Mono",Menlo,monospace;font-size:.88em;background:var(--surface2);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
a{color:var(--accent)}
aside.note{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:8px;padding:6px 16px;margin:0 0 18px;font-size:13.5px}
.tw{overflow-x:auto;margin:10px 0 14px;border:1px solid var(--border);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{padding:7px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}
th{background:var(--surface2);font-weight:600;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--surface2)}
td:first-child{font-weight:500}
.v{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;padding:1px 7px;border-radius:999px;white-space:nowrap;vertical-align:1px}
.v-adopt,.v-done{color:var(--adopt);background:var(--adopt-bg)}
.v-pilot{color:var(--pilot);background:var(--pilot-bg)}
.v-shadow{color:var(--shadow);background:var(--shadow-bg)}
.v-drop{color:var(--drop);background:var(--drop-bg)}
.v-shelved{color:var(--shelved);background:var(--shelved-bg)}
.v-idea{color:var(--idea);background:var(--idea-bg)}
footer{color:var(--muted);font-size:12px;text-align:center;padding:0 16px 30px}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}nav.toc{display:none}.kpis{grid-template-columns:repeat(3,1fr)}}
@media (max-width:560px){.kpis{grid-template-columns:repeat(2,1fr)}main section{padding:4px 14px 14px}header.top .tools{float:none;margin-bottom:10px}header.top h1{font-size:23px}}
@media print{body{background:#fff;font-size:12px}nav.toc,header.top .tools{display:none}.layout{display:block;padding:0}main section{break-inside:auto;box-shadow:none!important;border:0;padding:0}.tw{overflow:visible;border:0}th,td{padding:4px 6px}header.top{border:0;padding:0 0 10px}}
`;

const JS = `
const links=[...document.querySelectorAll('nav.toc a')];
const heads=links.map(a=>document.getElementById(a.getAttribute('href').slice(1)));
const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){links.forEach(l=>l.classList.toggle('on',l.getAttribute('href')==='#'+e.target.id));}})},{rootMargin:'0px 0px -75% 0px'});
heads.forEach(h=>h&&io.observe(h));
`;

for (const [lang, cfg] of Object.entries(LANGS)) {
  const md = readFileSync(join(here, `LAYA-JEV-REPORT.${lang}.md`), 'utf8');
  const { title, meta, body, toc } = convert(md);
  const kpis = cfg.kpis.map(([n, l, s]) => `<div class="kpi"><b>${n}</b><span>${l}</span><small>${s}</small></div>`).join('');
  const tocHtml = toc.map((t) => `<a class="l${t.level}" href="#${t.id}">${inline(t.text)}</a>`).join('');
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap">
<div class="tools"><a href="LAYA-JEV-REPORT.${cfg.other}.html">${cfg.otherLabel}</a><button onclick="window.print()">${cfg.print}</button></div>
<h1>${esc(title)}</h1>
<div class="meta">${meta}</div>
<div class="kpis">${kpis}</div>
</div></header>
<div class="layout wrap">
<nav class="toc"><div class="h">${cfg.toc}</div>${tocHtml}</nav>
<main>
${body}
</main>
</div>
<footer>Generated from LAYA-JEV-REPORT.${lang}.md · node report/build-html.mjs</footer>
<script>${JS}</script>
</body>
</html>
`;
  writeFileSync(join(here, `LAYA-JEV-REPORT.${lang}.html`), html);
  console.log(`wrote LAYA-JEV-REPORT.${lang}.html (${toc.length} headings)`);
}
