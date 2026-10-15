// rules-lib.mjs — pure helpers for bmad-code-review-jev: rule-source parsing, globs, unified-diff hunks.
// No I/O except the explicit file readers. Zero dependencies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const GENERATED = path.join('_bmad', 'custom', 'jev-rules.generated.json');
export const OVERRIDES = path.join('_bmad', 'custom', 'jev-rules.json');

export const sha = (s, n = 64) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
/** Stable rule id from its normalized text: edits to other lines never renumber it. */
export const ruleId = (text) => `r_${sha(text.replace(/\s+/g, ' ').trim().toLowerCase(), 6)}`;

// ---------------------------------------------------------------- rule sources

/**
 * Where a project keeps its agent rules, in BMad's two generations:
 *   - legacy `project-context.md` (bmad-generate-project-context), usually under _bmad-output/
 *   - the `<!-- bmad:context -->` block inside AGENTS.md (bmad-project-context)
 * plus literal `persistent_facts` from _bmad/custom/bmad-code-review*.toml.
 */
export function findRuleSources(root) {
  const out = [];
  for (const rel of ['_bmad-output/project-context.md', 'project-context.md', 'docs/project-context.md']) {
    const f = path.join(root, rel);
    if (fs.existsSync(f)) { out.push({ kind: 'project-context', file: rel, text: fs.readFileSync(f, 'utf8') }); break; }
  }
  const agents = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agents)) {
    const m = fs.readFileSync(agents, 'utf8').match(/<!--\s*bmad:context\s*-->([\s\S]*?)<!--\s*\/bmad:context\s*-->/);
    if (m) out.push({ kind: 'agents-block', file: 'AGENTS.md', text: m[1] });
  }
  for (const name of ['bmad-code-review.toml', 'bmad-code-review.user.toml']) {
    const f = path.join(root, '_bmad', 'custom', name);
    if (!fs.existsSync(f)) continue;
    const facts = parsePersistentFacts(fs.readFileSync(f, 'utf8'));
    if (facts.length) out.push({ kind: 'persistent-facts', file: `_bmad/custom/${name}`, text: facts.map((x) => `- ${x}`).join('\n') });
  }
  return out;
}

/** Literal entries of a TOML `persistent_facts = [ "...", ... ]` array; `file:` entries are skipped. */
export function parsePersistentFacts(toml) {
  const m = toml.match(/^\s*persistent_facts\s*=\s*\[([\s\S]*?)\]/m);
  if (!m) return [];
  const facts = [];
  for (const s of m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    const v = (s[1] ?? s[2]).replace(/\\"/g, '"').trim();
    if (v && !v.startsWith('file:')) facts.push(v);
  }
  return facts;
}

/**
 * Candidate rules from markdown: every bullet or `❌` line outside code fences, tables and frontmatter,
 * with its heading path. Nested bullets are joined to their parent so a rule keeps its qualifiers.
 */
export function parseRuleLines(markdown, source = '') {
  const lines = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/);
  const heads = [];
  const out = [];
  let fence = false;
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) { heads.length = h[1].length - 1; heads[h[1].length - 1] = h[2].trim(); continue; }
    if (/^\s*\|/.test(raw)) continue;
    const b = raw.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/) || raw.match(/^(\s*)(❌.*)$/);
    if (!b) continue;
    let text = b[2].replace(/\*\*/g, '').trim();
    if (text.replace(/[`*_~]/g, '').length < 12) continue;
    const indent = b[1].length;
    const prev = out[out.length - 1];
    if (indent >= 2 && prev && prev.indent < indent) { prev.text = `${prev.text} — ${text}`; continue; }
    out.push({ text, heading: heads.filter(Boolean).join(' > '), source, indent });
  }
  return out.map(({ indent, ...r }) => ({ id: ruleId(r.text), ...r }));
}

// ---------------------------------------------------------------- globs

/** Glob → RegExp over forward-slash relative paths. `**` any depth, `*` one segment, `?` one char, `{a,b}`. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`; i = end; }
    else re += escape(c);
  }
  return new RegExp(`^${re}$`, 'i');
}
const escape = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
export const matchesAny = (file, globs) => (globs || []).some((g) => g === '**' || globToRegExp(g).test(file));

/**
 * Scope options for the classifier, from the repo's real layout: source folders two levels deep,
 * plus file-type globs for the extensions that exist. Always ends with `**` (any file).
 */
export function scopeCandidates(root, { maxDirs = 40 } = {}) {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'bin', 'obj', 'coverage', '_bmad', '_bmad-output', '.claude', '.vs', '.idea']);
  const dirs = [];
  const exts = new Map();
  const walk = (dir, rel, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < 2 && dirs.length < maxDirs) dirs.push(`${r}/**`);
        if (depth < 5) walk(path.join(dir, e.name), r, depth + 1);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (ext) exts.set(ext, (exts.get(ext) || 0) + 1);
        if (/\.(test|spec)\.[a-z]+$/i.test(e.name)) exts.set('__test__', 1);
      }
    }
  };
  walk(root, '', 0);
  const code = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cs', '.py', '.java', '.go', '.scss', '.css', '.sql', '.razor', '.cshtml', '.html', '.yml', '.yaml', '.json'];
  const typeGlobs = code.filter((x) => exts.has(x)).map((x) => `**/*${x}`);
  if (exts.has('__test__')) typeGlobs.push('**/*.{test,spec}.*');
  return [...dirs, ...typeGlobs, '**'];
}

// ---------------------------------------------------------------- unified diff

/**
 * Hunks of a unified diff, new side only: { file, startLine, added: [{ line, text }], context: [..] }.
 * Deleted files and binary diffs are skipped. Big hunks are split into chunks of `maxAdded` added lines.
 */
export function parseDiff(diffText, { maxAdded = 60 } = {}) {
  const hunks = [];
  let file = null, cur = null, newLine = 0;
  const push = () => { if (cur && cur.added.length) hunks.push(cur); cur = null; };
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) { push(); file = null; continue; }
    if (line.startsWith('+++ ')) { const p = line.slice(4).trim(); file = p === '/dev/null' ? null : p.replace(/^b\//, ''); continue; }
    if (line.startsWith('--- ') || line.startsWith('index ') || line.startsWith('Binary files')) continue;
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { push(); if (file) { newLine = Number(h[1]); cur = { file, startLine: newLine, added: [], context: [] }; } continue; }
    if (!cur) continue;
    if (line.startsWith('+')) {
      if (cur.added.length >= maxAdded) { const f = cur.file; push(); cur = { file: f, startLine: newLine, added: [], context: [] }; }
      cur.added.push({ line: newLine, text: line.slice(1) }); newLine++;
    } else if (line.startsWith(' ')) { cur.context.push(line.slice(1)); newLine++; }
    else if (line.startsWith('\\')) { /* no newline at end of file */ }
  }
  push();
  return hunks.map((h, i) => ({ id: `h${i + 1}`, ...h }));
}

/** Best line for a finding: first added line containing a backticked token of the rule, else the first added line. */
export function pickLine(hunk, ruleText) {
  const tokens = [...ruleText.matchAll(/`([^`]{2,40})`/g)].map((m) => m[1].replace(/[(){}]/g, '').trim()).filter((t) => t.length >= 2);
  for (const t of tokens) {
    const hit = hunk.added.find((a) => a.text.includes(t));
    if (hit) return hit.line;
  }
  return hunk.added[0]?.line ?? hunk.startLine;
}

// ---------------------------------------------------------------- rule sets

export function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/**
 * The effective rule set: generated rules with per-id overrides applied, plus override-only `extra` rules.
 * Override file shape: { "rules": { "<id>": { kind?, scope?, disabled? } }, "extra": [{ text, scope, kind? }] }
 */
export function effectiveRules(root) {
  const gen = readJson(path.join(root, GENERATED));
  const ov = readJson(path.join(root, OVERRIDES)) || {};
  const rules = (gen?.rules || []).map((r) => ({ ...r, ...(ov.rules?.[r.id] || {}) }));
  for (const x of ov.extra || []) if (x?.text) rules.push({ id: ruleId(x.text), heading: 'override', source: OVERRIDES, kind: 'semantic', scope: ['**'], ...x });
  return { generated: gen, rules: rules.filter((r) => !r.disabled) };
}
