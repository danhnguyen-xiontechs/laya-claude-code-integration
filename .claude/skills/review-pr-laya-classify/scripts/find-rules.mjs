// find-rules.mjs — discover what a pull request in this repository should be reviewed against.
//
//   node find-rules.mjs [--repo-dir <dir>] [--repo-id <id>] [--max <n>]
//       JSON: saved project rules (if any), custom instructions, and candidate rule/context
//       sources found in the repository, each with a short excerpt.
//   node find-rules.mjs save --from <file> [--repo-dir <dir>] [--repo-id <id>] [--repo-level]
//       saves the chosen rules as this project's review rules:
//         default       ~/.xt-skills/review-pr/projects/<repo-id>.md   (only this user)
//         --repo-level  <repo>/.xt-skills/review-pr.md                 (commit it to share)
//   node find-rules.mjs where [--repo-dir <dir>] [--repo-id <id>]
//       prints both candidate paths for the project rules file.
//
// --repo-id overrides the id used for the user-level file (e.g. when reviewing a PR whose
// repository is not checked out; the id comes from pr-fetch.mjs).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO_DIR_NAME, instructionsPath, projectFileCandidates, readText, repoId, writeFileAtomic,
} from './lib/xt-config.mjs';

export const SKILL = 'review-pr';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'bin', 'obj', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '.next', '.nuxt', '.turbo', '.cache', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache',
  '.mypy_cache', '.gradle', '.idea', '.vs', 'artifacts', 'TestResults', '.terraform',
]);
// Hidden folders that commonly hold agent or tool rules.
const HIDDEN_OK = new Set(['.github', '.cursor', '.claude', '.windsurf', '.clinerules', '.gemini', '.junie', '.amazonq', '.xt-skills', '.husky']);
const MAX_DEPTH = 8;
const MAX_READ = 64 * 1024;

export const CATEGORY_ORDER = ['agent-instructions', 'project-context', 'contributing', 'docs', 'adr', 'lint-config'];

const AGENT_FILES = new Set(['claude.md', 'agents.md', 'gemini.md', '.cursorrules', '.windsurfrules', '.clinerules', 'copilot-instructions.md', 'claude.local.md']);
const DOC_KEYWORDS = /(standard|convention|guideline|style|architecture|decision|coding|review|best-practice|rules?)/i;
const LINT_NAMES = [
  /^\.eslintrc(\..+)?$/, /^eslint\.config\.(c|m)?(js|ts)$/, /^\.prettierrc(\..+)?$/, /^prettier\.config\.(c|m)?js$/,
  /^\.editorconfig$/, /^tsconfig(\..+)?\.json$/, /^jsconfig\.json$/, /^\.stylelintrc(\..+)?$/, /^stylelint\.config\.(c|m)?js$/,
  /^biome\.jsonc?$/, /^ruff\.toml$/, /^\.ruff\.toml$/, /^\.flake8$/, /^mypy\.ini$/, /^\.pylintrc$/, /^pylintrc$/,
  /^directory\.build\.props$/, /^\.globalconfig$/, /\.ruleset$/, /^stylecop\.json$/, /^\.golangci\.ya?ml$/,
  /^rustfmt\.toml$/, /^\.rustfmt\.toml$/, /^clippy\.toml$/, /^\.rubocop\.yml$/, /^checkstyle.*\.xml$/,
  /^detekt.*\.ya?ml$/, /^\.swiftlint\.yml$/, /^sonar-project\.properties$/, /^\.markdownlint.*$/,
  /^\.commitlintrc.*$/, /^commitlint\.config\.(c|m)?js$/,
];
const CONTENT_GATED = new Map([
  ['package.json', { re: /"(eslintConfig|prettier|stylelint)"\s*:/, note: (t) => `package.json has ${[...t.matchAll(/"(eslintConfig|prettier|stylelint)"\s*:/g)].map((m) => m[1]).join(', ')} config` }],
  ['pyproject.toml', { re: /^\[tool\.(ruff|black|mypy|pylint|isort|flake8|pyright)/m, note: (t) => `tools: ${[...new Set([...t.matchAll(/^\[tool\.(ruff|black|mypy|pylint|isort|flake8|pyright)/gm)].map((m) => m[1]))].join(', ')}` }],
  ['setup.cfg', { re: /^\[(flake8|mypy|pylint|isort|pycodestyle)/m, note: () => 'setup.cfg has linter sections' }],
]);

/** Classifies a repo-relative path (forward slashes). Returns a category or null. */
export function classify(rel) {
  const lower = rel.toLowerCase();
  const name = path.posix.basename(lower);
  const segs = lower.split('/');
  if (segs[0] === REPO_DIR_NAME) return null; // saved rules are reported separately
  if (AGENT_FILES.has(name)) return 'agent-instructions';
  if (lower.startsWith('.cursor/rules/') && /\.(md|mdc)$/.test(name)) return 'agent-instructions';
  if (lower.startsWith('.github/instructions/') && name.endsWith('.md')) return 'agent-instructions';
  if ((lower.startsWith('.clinerules/') || lower.startsWith('.claude/rules/') || lower.startsWith('.windsurf/rules/')) && /\.(md|txt)$/.test(name)) return 'agent-instructions';
  if (name === 'project-context.md' || (segs.includes('project-context') && name.endsWith('.md'))) return 'project-context';
  if (/^contributing(\..+)?$/.test(name) || name === 'codestyle.md') return 'contributing';
  if (name.endsWith('.md') && segs.slice(0, -1).some((s) => /^(adr|adrs|decisions|architecture-decisions)$/.test(s))) return 'adr';
  if (name.endsWith('.md') && segs.slice(0, -1).some((s) => /^(docs?|documentation|_bmad-output|review-standards|standards|guidelines)$/.test(s)) && DOC_KEYWORDS.test(name)) return 'docs';
  if (name.endsWith('.md') && segs.slice(0, -1).some((s) => /^(review-standards|standards|guidelines|conventions)$/.test(s))) return 'docs';
  if (LINT_NAMES.some((re) => re.test(name))) return 'lint-config';
  if (CONTENT_GATED.has(name)) return 'lint-config?';
  if (name.endsWith('.csproj')) return 'lint-config?';
  return null;
}

/** Short excerpt of a file: markdown skips frontmatter and keeps the first lines; capped length. */
export function excerpt(text, rel, { maxChars = 400, maxLines = 6 } = {}) {
  let t = text.replace(/^﻿/, '');
  if (/\.(md|mdc)$/i.test(rel)) t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\r?\n/, '');
  const lines = t.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  const out = lines.slice(0, maxLines).join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
}

/** Extra one-line facts for configs (strict mode, warnings-as-errors, ...). */
export function configNote(rel, text) {
  const name = path.posix.basename(rel.toLowerCase());
  if (/^tsconfig/.test(name) || name === 'jsconfig.json') {
    const strict = /"strict"\s*:\s*true/.test(text);
    return `strict: ${strict}`;
  }
  if (name === 'directory.build.props' || name.endsWith('.csproj')) {
    const facts = [];
    for (const k of ['TreatWarningsAsErrors', 'Nullable', 'AnalysisLevel', 'AnalysisMode', 'EnforceCodeStyleInBuild', 'WarningsAsErrors']) {
      const m = new RegExp(`<${k}>([^<]+)</${k}>`, 'i').exec(text);
      if (m) facts.push(`${k}=${m[1].trim()}`);
    }
    return facts.join(', ') || null;
  }
  const gated = CONTENT_GATED.get(name);
  return gated ? gated.note(text) : null;
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(MAX_READ, fs.fstatSync(fd).size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.includes(0) ? null : buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function walk(root, rel, depth, out) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.') && !HIDDEN_OK.has(e.name)) continue;
      if (rel === '.claude' && e.name === 'skills') continue; // installed skills, not project rules
      walk(root, childRel, depth + 1, out);
    } else if (e.isFile()) {
      out.push(childRel);
    }
  }
}

/** The git top-level folder of dir, or dir itself. */
export function repoRoot(dir) {
  try {
    return path.resolve(execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim());
  } catch {
    return path.resolve(dir);
  }
}

/** Saved project rules: first existing of repo file, user project file. */
export function savedRules(repoDir, opts = {}) {
  const candidates = projectFileCandidates(SKILL, repoDir, 'md', opts);
  const hit = candidates.find((c) => fs.existsSync(c.path));
  return {
    candidates: Object.fromEntries(candidates.map((c) => [c.source, c.path])),
    saved: hit ? { source: hit.source, path: hit.path, lines: readText(hit.path).split(/\r?\n/).length, excerpt: excerpt(readText(hit.path), hit.path) } : null,
  };
}

/**
 * Scans a repository. opts: root/home/env (xt-config), repoId (override), max (sources cap).
 * Returns { repoDir, repoId, saved, savedCandidates, customInstructions, sources[], counts, truncated }.
 */
export function findRules(dir = process.cwd(), opts = {}) {
  const repoDir = repoRoot(dir);
  const id = opts.repoId ?? repoId(repoDir);
  const xopts = { ...opts, repoId: id };
  const { saved, candidates } = savedRules(repoDir, xopts);
  const instrFile = instructionsPath(SKILL, xopts);
  const instrText = readText(instrFile).trim();

  const files = [];
  if (fs.existsSync(repoDir)) walk(repoDir, '', 0, files);
  const sources = [];
  for (const rel of files) {
    let category = classify(rel);
    if (!category) continue;
    const text = readHead(path.join(repoDir, rel));
    if (text == null) continue;
    if (category === 'lint-config?') {
      const name = path.posix.basename(rel.toLowerCase());
      const gated = CONTENT_GATED.get(name);
      if (gated && !gated.re.test(text)) continue;
      if (!gated && !configNote(rel, text)) continue;
      category = 'lint-config';
    }
    const note = category === 'lint-config' ? configNote(rel, text) : null;
    sources.push({
      category,
      path: rel,
      lines: text.split(/\r?\n/).length,
      ...(note ? { note } : {}),
      excerpt: category === 'lint-config' ? excerpt(text, rel, { maxChars: 240, maxLines: 4 }) : excerpt(text, rel),
    });
  }
  sources.sort((a, b) =>
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
    a.path.split('/').length - b.path.split('/').length ||
    a.path.localeCompare(b.path));
  const counts = {};
  for (const s of sources) counts[s.category] = (counts[s.category] ?? 0) + 1;
  const max = opts.max ?? 150;
  return {
    repoDir,
    repoId: id,
    saved,
    savedCandidates: candidates,
    customInstructions: { path: instrFile, exists: Boolean(instrText), text: instrText || null },
    sources: sources.slice(0, max),
    counts,
    truncated: sources.length > max ? sources.length - max : 0,
  };
}

/** Saves rules text. Default user-level; repoLevel writes <repo>/.xt-skills/review-pr.md. Returns the path. */
export function saveRules(dir, text, { repoLevel = false, ...opts } = {}) {
  if (!String(text ?? '').trim()) throw new Error('Refusing to save empty rules.');
  const repoDir = repoRoot(dir);
  const id = opts.repoId ?? repoId(repoDir);
  const { candidates } = savedRules(repoDir, { ...opts, repoId: id });
  const target = repoLevel ? candidates.repo : candidates.user;
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return writeFileAtomic(target, body);
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--repo-dir', '--repo-id', '--from', '--max'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '--repo-level') a.repoLevel = true;
    else if (t === '-h' || t === '--help') a.help = true;
    else a._.push(t);
  }
  return a;
}

export function main(argv = process.argv.slice(2), { log = console.log, error = console.error, env = process.env } = {}) {
  const a = parseArgs(argv);
  const cmd = a._[0] ?? 'scan';
  const dir = path.resolve(a['repo-dir'] ?? process.cwd());
  const opts = { env, ...(a['repo-id'] ? { repoId: a['repo-id'] } : {}) };
  try {
    if (a.help) {
      log('Usage: node find-rules.mjs [scan|save|where] [--repo-dir <dir>] [--repo-id <id>] [--from <file>] [--repo-level] [--max <n>]');
      return 0;
    }
    if (cmd === 'scan') {
      log(JSON.stringify(findRules(dir, { ...opts, ...(a.max ? { max: Number(a.max) } : {}) }), null, 2));
      return 0;
    }
    if (cmd === 'where') {
      const repoDir = repoRoot(dir);
      const id = opts.repoId ?? repoId(repoDir);
      const { saved, candidates } = savedRules(repoDir, { ...opts, repoId: id });
      log(JSON.stringify({ repoDir, repoId: id, ...candidates, active: saved?.path ?? null }, null, 2));
      return 0;
    }
    if (cmd === 'save') {
      if (!a.from) { error('save needs --from <file> (the rules text to save)'); return 1; }
      const text = fs.readFileSync(path.resolve(a.from), 'utf8');
      const file = saveRules(dir, text, { ...opts, repoLevel: a.repoLevel });
      log(JSON.stringify({ ok: true, saved: file, level: a.repoLevel ? 'repo' : 'user' }, null, 2));
      return 0;
    }
    error(`Unknown command "${cmd}" (use scan, save or where)`);
    return 1;
  } catch (err) {
    error(`find-rules: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
