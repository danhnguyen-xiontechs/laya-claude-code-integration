// catalog.mjs — every skill, slash command, subagent and BMad workflow Claude Code can reach from a
// project, normalized to one entry shape. Zero dependencies, Node >= 18.
//
//   node catalog.mjs [--project-root <dir>] [--no-cache] [--json]     → summary (or full entries)
//
// Entry: { id, name, kind (skill|command|agent|bmad), source (project|user|plugin:<name>|bmad|builtin),
//          description, head, invocation, explicitOnly, path, shadowed? }
// Only the frontmatter, the description and the first ~700 characters of each body are read
// (files are read through a 16 KB window, never whole).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEAD_CHARS = 700;
const CATALOG_VERSION = 1; // bump when the entry shape changes, to invalidate caches
const READ_WINDOW = 16 * 1024;
export const STATE_DIR = path.join(os.homedir(), '.skills-router');
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Claude Code's bundled skills (no file on disk): builtin.local.json if present, else builtin.json. */
export const BUILTIN_FILES = [path.join(SKILL_DIR, 'builtin.local.json'), path.join(SKILL_DIR, 'builtin.json')];

// ---------------------------------------------------------------- frontmatter

const unquote = (v) => {
  const s = v.trim();
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return s;
};

/**
 * Small YAML-frontmatter reader for top-level `key: value` pairs: plain, 'single' and "double" quoted
 * scalars, multi-line plain or quoted scalars (indented continuation lines), and `|` / `>` block
 * scalars (with -/+ chomping). Nested maps and lists are kept as raw text. Returns { data, body }.
 */
export function parseFrontmatter(text) {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(t);
  if (!m) return { data: {}, body: t };
  const lines = m[1].split('\n');
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const km = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*)|[ \t]*)$/.exec(lines[i]);
    if (!km) continue;
    const key = km[1];
    const first = (km[2] ?? '').trim();
    const cont = [];
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) cont.push(lines[++i]);
    while (cont.length && cont.at(-1).trim() === '') cont.pop();
    const bm = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(first);
    if (bm) {
      const ind = Math.min(...cont.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length), Infinity);
      const rows = cont.map((l) => l.slice(Number.isFinite(ind) ? ind : 0));
      data[key] = bm[1] === '|' ? rows.join('\n') : rows.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ');
      if (bm[2] !== '+') data[key] = data[key].replace(/\n+$/, '');
    } else {
      const joined = [first, ...cont.map((l) => l.trim())].filter(Boolean).join(' ');
      data[key] = unquote(joined);
    }
  }
  return { data, body: t.slice(m[0].length) };
}

/** First `n` characters of a body as one line (headings and markup kept, whitespace collapsed). */
export const bodyHead = (body, n = HEAD_CHARS) => String(body).replace(/\s+/g, ' ').trim().slice(0, n);

/** Reads at most the first 16 KB of a file as UTF-8 ('' on error). */
export function readHead(file, bytes = READ_WINDOW) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

/**
 * True when the skill should run only on an explicit request: `disable-model-invocation: true`, or a
 * description that says it triggers "only on /x" / "only when explicitly asked".
 */
export function isExplicitOnly(description, data = {}) {
  if (String(data['disable-model-invocation']).toLowerCase() === 'true') return true;
  const d = String(description || '');
  return /\btrigger(?:s|ed)?\s+(?:it\s+)?only\s+(?:on|when|if|via|with|for)\b/i.test(d)
    || /\bonly\s+(?:on|via)\s+["'`]?\//i.test(d)
    || /\bonly\s+when\s+(?:the\s+user\s+)?explicitly\b/i.test(d);
}

// ---------------------------------------------------------------- BMad csv (shared with bmad-help-jev)

/** Minimal RFC-4180 CSV parser → arrays of trimmed fields, header row included. */
export function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

const CATALOG_COLS = ['module', 'skill', 'display-name', 'menu-code', 'description', 'action', 'args', 'phase', 'preceded-by', 'followed-by', 'required', 'output-location', 'outputs'];

/** BMad catalog rows, whatever header generation the file has; `_meta` rows dropped. */
export function bmadRows(text) {
  const [head = [], ...body] = parseCsvRows(text);
  const byHeader = (r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']));
  const positional = (r) => Object.fromEntries(CATALOG_COLS.map((h, i) => [h, r[i] ?? '']));
  return body.map((r) => {
    let o;
    if (head.includes('skill')) o = byHeader(r);
    else if (/^[a-z_][a-z0-9_-]*$/.test(r[1] || '') && /^[A-Z0-9]{0,6}$/.test(r[3] || '')) o = positional(r);
    else { const h = byHeader(r); o = { ...h, skill: h.command || h.name, 'display-name': h.name, 'menu-code': h.code, action: '' }; }
    return {
      module: o.module || '', skill: o.skill || '', action: o.action || '', displayName: o['display-name'] || '',
      phase: o.phase || '', description: o.description || '', precededBy: o['preceded-by'] || '', followedBy: o['followed-by'] || '',
    };
  }).filter((r) => r.skill && r.skill !== '_meta');
}

// ---------------------------------------------------------------- discovery

const SOURCE_RANK = { project: 0, user: 1, plugin: 2, bmad: 3, builtin: 4 };
const KIND_RANK = { skill: 0, command: 1, agent: 2, bmad: 3 };
const rankOf = (e) => SOURCE_RANK[e.source.split(':')[0]] * 10 + KIND_RANK[e.kind];

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => path.join(p, d.name)).filter(isDir); } catch { return []; } };

/** `*.md` files under dir (recursive, depth ≤ 3) with their namespace (`sub:dir:name`). */
function mdFiles(dir, depth = 0, ns = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) out.push(...mdFiles(p, depth + 1, [...ns, e.name]));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push({ file: p, name: [...ns, e.name.slice(0, -3)].join(':') });
  }
  return out;
}

/**
 * Installed plugins: from ~/.claude/plugins/installed_plugins.json (user scope, or project scope for
 * this project). Without that file, every `**\/skills/*\/SKILL.md` under ~/.claude/plugins except
 * marketplace checkouts (which hold plugins that are listed, not installed).
 */
export function installedPlugins(home, root) {
  const base = path.join(home, '.claude', 'plugins');
  const out = [];
  try {
    const j = JSON.parse(fs.readFileSync(path.join(base, 'installed_plugins.json'), 'utf8'));
    const norm = (p) => path.resolve(p).toLowerCase();
    for (const [key, installs] of Object.entries(j.plugins || {})) {
      const name = key.split('@')[0];
      for (const ins of [].concat(installs)) {
        if (!ins?.installPath) continue;
        if (ins.scope === 'project' || ins.scope === 'local') { if (!ins.projectPath || norm(ins.projectPath) !== norm(root)) continue; }
        if (isDir(ins.installPath)) { out.push({ name, dir: ins.installPath }); break; }
      }
    }
    return out;
  } catch { /* fall back to a scan */ }
  const walk = (dir, depth) => {
    if (depth > 6) return;
    for (const d of subdirs(dir)) {
      const b = path.basename(d);
      if (b === 'marketplaces' || b === 'node_modules' || b.startsWith('.')) continue;
      if (b === 'skills') {
        // cache/<marketplace>/<plugin>/<version>/skills → the plugin is the folder above the version
        const dir = path.dirname(d), up = path.basename(dir);
        out.push({ name: /^v?\d+(\.\d+)*$/.test(up) ? path.basename(path.dirname(dir)) : up, dir });
        continue;
      }
      walk(d, depth + 1);
    }
  };
  walk(base, 0);
  return out;
}

/**
 * Every candidate file with how to turn it into an entry. Discovery only (readdir + stat), no reads.
 * Returns [{ file, kind, source, name, invocationPrefix }].
 */
export function discover({ root, home = os.homedir(), builtinFiles = BUILTIN_FILES }) {
  const items = [];
  const skillDirs = (dir, source, prefix = '') => {
    for (const d of subdirs(dir)) {
      const f = path.join(d, 'SKILL.md');
      if (fs.existsSync(f)) items.push({ file: f, kind: 'skill', source, name: prefix + path.basename(d) });
    }
  };
  skillDirs(path.join(root, '.claude', 'skills'), 'project');
  skillDirs(path.join(root, '.agents', 'skills'), 'project');
  const userSkills = path.join(home, '.claude', 'skills');
  skillDirs(userSkills, 'user');
  // claude.ai skills synced to the desktop app live one level down and are invoked as anthropic-skills:<name>.
  for (const bucket of subdirs(path.join(userSkills, 'synced'))) skillDirs(bucket, 'plugin:anthropic-skills', 'anthropic-skills:');
  for (const p of installedPlugins(home, root)) skillDirs(path.join(p.dir, 'skills'), `plugin:${p.name}`, `${p.name}:`);
  for (const [dir, source] of [[path.join(root, '.claude', 'commands'), 'project'], [path.join(home, '.claude', 'commands'), 'user']]) {
    for (const m of mdFiles(dir)) items.push({ file: m.file, kind: 'command', source, name: m.name });
  }
  for (const [dir, source] of [[path.join(root, '.claude', 'agents'), 'project'], [path.join(home, '.claude', 'agents'), 'user']]) {
    for (const m of mdFiles(dir)) items.push({ file: m.file, kind: 'agent', source, name: m.name });
  }
  const bmad = path.join(root, '_bmad', '_config', 'bmad-help.csv');
  if (fs.existsSync(bmad)) items.push({ file: bmad, kind: 'bmad', source: 'bmad', name: null });
  const builtin = builtinFiles.find((f) => fs.existsSync(f));
  if (builtin) items.push({ file: builtin, kind: 'builtin', source: 'builtin', name: null });
  return items;
}

/** Turns one discovered markdown file into an entry. */
export function entryFromMarkdown(item) {
  const { data, body } = parseFrontmatter(readHead(item.file));
  const name = item.kind === 'agent' ? String(data.name || item.name) : item.name;
  let description = String(data.description || '').trim();
  if (!description) {
    const firstLine = body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
    description = firstLine.slice(0, 300);
  }
  const invocation = item.kind === 'agent' ? `Agent(subagent_type: "${name}")` : `/${name}`;
  return {
    id: name, name, kind: item.kind, source: item.source, description,
    head: bodyHead(body), invocation, explicitOnly: isExplicitOnly(description, data), path: item.file,
  };
}

/** Entries from a BMad catalog file: one per skill, or per skill:action when the row has an action. */
export function entriesFromBmad(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const seen = new Map();
  for (const r of bmadRows(text)) {
    const name = r.action ? `${r.skill}:${r.action}` : r.skill;
    if (seen.has(name)) continue;
    const label = [r.displayName, r.phase && `(${r.phase})`].filter(Boolean).join(' ');
    seen.set(name, {
      id: name, name, kind: 'bmad', source: 'bmad', description: r.description,
      head: [label, r.precededBy && `after ${r.precededBy}`, r.followedBy && `before ${r.followedBy}`].filter(Boolean).join('; '),
      invocation: r.action ? `/${r.skill} ${r.action}` : `/${r.skill}`, explicitOnly: false, path: file,
      bmad: { module: r.module, phase: r.phase, precededBy: r.precededBy, followedBy: r.followedBy },
    });
  }
  return [...seen.values()];
}

/** Entries from builtin.json: { skills: [{ name, description }] }. */
export function entriesFromBuiltin(file) {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  return (j.skills || []).filter((s) => s?.name).map((s) => ({
    id: s.name, name: s.name, kind: 'skill', source: 'builtin', description: String(s.description || ''), head: '',
    invocation: `/${s.name}`, explicitOnly: isExplicitOnly(s.description), path: file,
  }));
}

/** Bare name used for deduplication: plugin namespace dropped, lower-cased. */
export const bareName = (name) => String(name).split(':').at(-1).toLowerCase();

/**
 * Keeps one entry per name, by precedence project > user > plugin > bmad (then skill > command >
 * agent). Shadowed copies are recorded on the winner as `shadowed: [{ source, kind, path }]`.
 * A BMad row that a real skill shadows lends its phase metadata to that skill.
 */
export function dedupe(entries) {
  const byName = new Map();
  for (const e of [...entries].sort((a, b) => rankOf(a) - rankOf(b))) {
    const k = e.kind === 'bmad' ? e.name.toLowerCase() : bareName(e.name);
    const win = byName.get(k);
    if (!win) { byName.set(k, { ...e }); continue; }
    (win.shadowed ||= []).push({ source: e.source, kind: e.kind, name: e.name, path: e.path });
    if (e.bmad && !win.bmad) win.bmad = e.bmad;
  }
  return [...byName.values()];
}

/** Hash of every source file's path, mtime and size: the cache key. */
export function fingerprint(items) {
  const h = crypto.createHash('sha1');
  h.update(`catalog-v${CATALOG_VERSION}\n`);
  for (const it of [...items].sort((a, b) => a.file.localeCompare(b.file))) {
    let st = null;
    try { st = fs.statSync(it.file); } catch { /* vanished */ }
    h.update(`${it.file}|${it.kind}|${it.source}|${st ? `${st.mtimeMs}|${st.size}` : 'x'}\n`);
  }
  return h.digest('hex');
}

/**
 * The catalog for a project. Cached in ~/.skills-router/cache/ keyed by the fingerprint, so a run
 * that finds no changed file reads nothing but the cache.
 * Returns { entries, counts, fingerprint, cached }.
 */
export function loadCatalog({ root, home = os.homedir(), cacheDir = path.join(STATE_DIR, 'cache'), useCache = true, builtinFiles } = {}) {
  root = path.resolve(root || process.cwd());
  const items = discover({ root, home, builtinFiles });
  const fp = fingerprint(items);
  const cacheFile = path.join(cacheDir, `catalog-${crypto.createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 12)}.json`);
  if (useCache) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c.fingerprint === fp && Array.isArray(c.entries)) return { ...c, cached: true };
    } catch { /* miss */ }
  }
  const raw = [];
  for (const it of items) {
    if (it.kind === 'bmad') raw.push(...entriesFromBmad(it.file));
    else if (it.kind === 'builtin') raw.push(...entriesFromBuiltin(it.file));
    else raw.push(entryFromMarkdown(it));
  }
  const entries = dedupe(raw);
  const counts = {};
  for (const e of raw) counts[e.source] = (counts[e.source] || 0) + 1;
  const out = { root, fingerprint: fp, counts, rawCount: raw.length, entries };
  if (useCache) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(out)); } catch { /* best-effort */ }
  }
  return { ...out, cached: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const c = loadCatalog({ root: opt('project-root'), useCache: !argv.includes('--no-cache') });
  if (argv.includes('--json')) console.log(JSON.stringify(c, null, 2));
  else {
    const byKind = {};
    for (const e of c.entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    console.log(JSON.stringify({
      root: c.root, cached: c.cached, rawPerSource: c.counts, afterDedupe: c.entries.length, perKind: byKind,
      explicitOnly: c.entries.filter((e) => e.explicitOnly).map((e) => e.name),
      shadowed: c.entries.filter((e) => e.shadowed).map((e) => ({ name: e.name, kept: e.source, shadowed: e.shadowed.map((s) => s.source) })),
    }, null, 2));
  }
}
