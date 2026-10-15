// GENERATED from shared/lib/xt-config.mjs by tools/sync-shared.mjs — edit the source, not this copy
// xt-config.mjs — user state for xt-skills (profile, per-skill config, custom instructions,
// per-project settings). Zero dependencies, Node >= 18.
//
// Layout (see docs/CONFIG.md):
//   ~/.xt-skills/
//   ├── profile.json
//   └── <skill>/
//       ├── config.json
//       ├── instructions.md
//       └── projects/<repo-id>.{json,md}
//
// A project may also commit team-shared files at <repo>/.xt-skills/<skill>.{json,md}.
// Lookup order for project files: repo file -> user project file -> defaults (or ask).
//
// Every function takes an optional `opts` object:
//   opts.root  explicit xt-skills folder (wins over everything)
//   opts.home  user home folder (tests); when given without opts.env the real
//              environment is ignored, so XT_SKILLS_HOME cannot leak into a test
//   opts.env   environment object (default process.env)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROFILE_FILE = 'profile.json';
export const CONFIG_FILE = 'config.json';
export const INSTRUCTIONS_FILE = 'instructions.md';
export const REPO_DIR_NAME = '.xt-skills';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** The user-state folder: opts.root, else $XT_SKILLS_HOME, else <home>/.xt-skills. */
export function xtHome(opts = {}) {
  if (opts.root) return path.resolve(opts.root);
  const env = opts.env ?? (opts.home !== undefined ? {} : process.env);
  if (env.XT_SKILLS_HOME) return path.resolve(env.XT_SKILLS_HOME);
  return path.join(opts.home ?? os.homedir(), '.xt-skills');
}

/** <xt-home>/profile.json */
export function profilePath(opts = {}) {
  return path.join(xtHome(opts), PROFILE_FILE);
}

/** <xt-home>/<skill> — throws on a name that is not a plain kebab-case skill name. */
export function skillHome(skill, opts = {}) {
  assertSkillName(skill);
  return path.join(xtHome(opts), skill);
}

/** <xt-home>/<skill>/config.json */
export function skillConfigPath(skill, opts = {}) {
  return path.join(skillHome(skill, opts), CONFIG_FILE);
}

/** <xt-home>/<skill>/instructions.md */
export function instructionsPath(skill, opts = {}) {
  return path.join(skillHome(skill, opts), INSTRUCTIONS_FILE);
}

function assertSkillName(skill) {
  if (typeof skill !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill)) {
    throw new Error(`Invalid skill name: ${JSON.stringify(skill)} (expected kebab-case)`);
  }
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/** Reads and parses a JSON file; null when it does not exist. A broken file throws with its path. */
export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`Cannot parse ${file}: ${err.message}`);
  }
}

/** Reads a text file; '' when it does not exist. */
export function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Atomic write: the content goes to a temp file next to the target, which is then renamed
 * over it, so a reader never sees half a file. Parent folders are created. On Windows a
 * rename can fail briefly while another process (antivirus, an editor) holds the target,
 * so it is retried a few times.
 */
export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return file;
    } catch (err) {
      if (attempt < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        const until = Date.now() + 50 * (attempt + 1);
        while (Date.now() < until) { /* short busy wait; no async in a sync API */ }
        continue;
      }
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw err;
    }
  }
}

/** Atomic, pretty-printed JSON write (2-space indent, trailing newline). */
export function writeJsonAtomic(file, data) {
  return writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge for config objects: plain objects merge, everything else (arrays too) replaces. */
export function deepMerge(base, over) {
  if (!isPlainObject(base)) return over === undefined ? base : over;
  if (!isPlainObject(over)) return over === undefined ? { ...base } : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/** Reads `a.b.c` from an object; undefined when any step is missing. */
export function getPath(obj, dotPath) {
  return String(dotPath).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Sets `a.b.c` on an object (mutates), creating intermediate objects. */
export function setPath(obj, dotPath, value) {
  const keys = String(dotPath).split('.');
  if (keys.some((k) => !k || ['__proto__', 'prototype', 'constructor'].includes(k))) {
    throw new Error(`Invalid key path: ${dotPath}`);
  }
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlainObject(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
  return obj;
}

// ---------------------------------------------------------------------------
// Profile (shared identity for all skills)
// ---------------------------------------------------------------------------

/** The profile object, or null when `profile init` has not run yet. */
export function loadProfile(opts = {}) {
  return readJson(profilePath(opts));
}

/** Writes the whole profile atomically. Returns the file path. */
export function saveProfile(profile, opts = {}) {
  if (!isPlainObject(profile)) throw new Error('Profile must be an object');
  return writeJsonAtomic(profilePath(opts), profile);
}

/** Sets one value (dot path, e.g. `email` or `ado.contoso.displayName`) and saves. Returns the profile. */
export function setProfileValue(dotPath, value, opts = {}) {
  const profile = loadProfile(opts) ?? {};
  setPath(profile, dotPath, value);
  profile.updatedAt = new Date().toISOString();
  saveProfile(profile, opts);
  return profile;
}

// ---------------------------------------------------------------------------
// Per-skill config and custom instructions
// ---------------------------------------------------------------------------

/** `defaults` deep-merged with <xt-home>/<skill>/config.json (file values win). */
export function loadSkillConfig(skill, opts = {}) {
  const file = readJson(skillConfigPath(skill, opts));
  return deepMerge(opts.defaults ?? {}, file ?? {});
}

/** True when <xt-home>/<skill>/config.json exists (i.e. setup has run). */
export function hasSkillConfig(skill, opts = {}) {
  return fs.existsSync(skillConfigPath(skill, opts));
}

/** Writes <xt-home>/<skill>/config.json atomically. Returns the file path. */
export function saveSkillConfig(skill, config, opts = {}) {
  if (!isPlainObject(config)) throw new Error('Config must be an object');
  return writeJsonAtomic(skillConfigPath(skill, opts), config);
}

/**
 * Custom instructions for a skill: the user's <xt-home>/<skill>/instructions.md followed by
 * the project's instructions (first found of <repo>/.xt-skills/<skill>.md and
 * <xt-home>/<skill>/projects/<repo-id>.md) when opts.repoDir is given. Returns '' when none.
 */
export function loadInstructions(skill, opts = {}) {
  const parts = [readText(instructionsPath(skill, opts)).trim()];
  if (opts.repoDir) {
    const file = projectFile(skill, opts.repoDir, 'md', opts);
    if (file) parts.push(readText(file).trim());
  }
  return parts.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Repo id and per-project files
// ---------------------------------------------------------------------------

/** Lowercase, URL-decoded, filesystem-safe path segment. */
function cleanSegment(s) {
  let decoded = s;
  try { decoded = decodeURIComponent(s); } catch { /* keep raw */ }
  return decoded.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Normalizes a git remote URL to `host__org__project__repo` (lowercase, no credentials,
 * no `.git`, no `_git/`, no port). Azure DevOps https, ssh and legacy visualstudio.com
 * forms all map to `dev.azure.com__<org>__<project>__<repo>`. Returns null for empty input.
 *
 *   https://user@dev.azure.com/Contoso/My%20Project/_git/app  -> dev.azure.com__contoso__my-project__app
 *   git@ssh.dev.azure.com:v3/Contoso/My%20Project/app         -> dev.azure.com__contoso__my-project__app
 *   https://github.com/contoso/app.git                        -> github.com__contoso__app
 *   git@github.com:contoso/app.git                            -> github.com__contoso__app
 */
export function normalizeRemoteUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let s = url.trim();
  let host;
  let rest;

  const scpLike = /^(?:[^@/]+@)?([^:/]+):(?!\/\/)(.*)$/.exec(s); // git@host:org/repo
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/?(.*)$/i.exec(s);
  if (/^file:/i.test(s)) return null; // a local remote has no stable host
  if (withScheme) {
    host = withScheme[1];
    rest = withScheme[2];
  } else if (scpLike && scpLike[1].length > 1) { // length 1 = Windows drive letter (local path)
    host = scpLike[1];
    rest = scpLike[2];
  } else {
    return null;
  }

  host = host.toLowerCase();
  rest = rest.replace(/[?#].*$/, '');
  let parts = rest.split('/').filter(Boolean);
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/\.git$/i, '');

  // Azure DevOps ssh: ssh.dev.azure.com:v3/org/project/repo, org@vs-ssh.visualstudio.com:v3/...
  if (host === 'ssh.dev.azure.com' || /(^|\.)vs-ssh\.visualstudio\.com$/.test(host)) {
    host = 'dev.azure.com';
    if (parts[0] === 'v3') parts = parts.slice(1);
  }
  // Legacy https://org.visualstudio.com/[DefaultCollection/]project/_git/repo
  const legacy = /^([^.]+)\.visualstudio\.com$/.exec(host);
  if (legacy) {
    host = 'dev.azure.com';
    if (parts[0] && parts[0].toLowerCase() === 'defaultcollection') parts = parts.slice(1);
    parts = [legacy[1], ...parts];
  }
  // Azure DevOps: org/project/_git/repo, or org/_git/repo when the repo is named like the project.
  const gitIdx = parts.indexOf('_git');
  if (gitIdx !== -1) {
    const before = parts.slice(0, gitIdx);
    const after = parts.slice(gitIdx + 1);
    if (host === 'dev.azure.com' && before.length === 1 && after.length) before.push(after[0]);
    parts = [...before, ...after];
  }

  const segments = [host, ...parts].map(cleanSegment).filter(Boolean);
  return segments.length > 1 ? segments.join('__') : null;
}

/** The `origin` remote URL of a git checkout (falls back to the first remote), or null. */
export function gitRemoteUrl(dir) {
  const git = (args) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  try {
    return git(['remote', 'get-url', 'origin']) || null;
  } catch {
    try {
      const first = git(['remote']).split(/\r?\n/).filter(Boolean)[0];
      return first ? git(['remote', 'get-url', first]) || null : null;
    } catch {
      return null;
    }
  }
}

/** Top folder of the git checkout containing dir (so a subfolder maps to its repo), else dir itself. */
export function repoRoot(dir = process.cwd()) {
  try {
    const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return top ? path.resolve(top) : path.resolve(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** Stable id for a repo: normalized remote URL, else the repo's folder name (lowercase, safe). */
export function repoId(dir = process.cwd()) {
  const fromRemote = normalizeRemoteUrl(gitRemoteUrl(dir));
  if (fromRemote) return fromRemote;
  return cleanSegment(path.basename(repoRoot(dir))) || 'unknown-repo';
}

/** Candidate project files for a skill, in lookup order (repo first). */
export function projectFileCandidates(skill, repoDir, ext, opts = {}) {
  assertSkillName(skill);
  const e = String(ext).replace(/^\./, '');
  const id = opts.repoId ?? repoId(repoDir);
  return [
    { source: 'repo', path: path.join(repoRoot(repoDir), REPO_DIR_NAME, `${skill}.${e}`) },
    { source: 'user', path: path.join(skillHome(skill, opts), 'projects', `${id}.${e}`) },
  ];
}

/** First existing project file (repo, then user), or null. */
export function projectFile(skill, repoDir, ext, opts = {}) {
  const hit = projectFileCandidates(skill, repoDir, ext, opts).find((c) => fs.existsSync(c.path));
  return hit ? hit.path : null;
}

/** Where a skill saves per-project settings for this user: <xt-home>/<skill>/projects/<repo-id>.<ext>. */
export function userProjectFile(skill, repoDir, ext, opts = {}) {
  return projectFileCandidates(skill, repoDir, ext, opts)[1].path;
}

/**
 * Per-project settings, first found wins: repo file -> user project file -> defaults.
 * Returns { settings, source: 'repo' | 'user' | 'defaults', path }. When source is
 * 'defaults' an interactive skill should ask the user and save with saveProjectSettings.
 */
export function loadProjectSettings(skill, repoDir, opts = {}) {
  for (const c of projectFileCandidates(skill, repoDir, 'json', opts)) {
    const data = readJson(c.path);
    if (data !== null) return { settings: deepMerge(opts.defaults ?? {}, data), source: c.source, path: c.path };
  }
  return { settings: deepMerge(opts.defaults ?? {}, {}), source: 'defaults', path: null };
}

/** Saves per-project settings to the user project file (never into the repo). Returns the path. */
export function saveProjectSettings(skill, repoDir, settings, opts = {}) {
  return writeJsonAtomic(userProjectFile(skill, repoDir, 'json', opts), settings);
}

/** Saves per-project text (e.g. review rules) to the user project file `<repo-id>.<ext>`. */
export function saveProjectText(skill, repoDir, ext, text, opts = {}) {
  return writeFileAtomic(userProjectFile(skill, repoDir, ext, opts), text);
}

// ---------------------------------------------------------------------------
// Missing-config guard
// ---------------------------------------------------------------------------

function isMissing(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
}

/**
 * Checks that config keys (dot paths) are set. Keys starting with `profile.` are read from
 * the profile instead of the skill config. opts.config may pass an already-loaded config
 * (otherwise loadSkillConfig(skill, opts) is used, honouring opts.defaults).
 *
 *  - unattended (opts.interactive falsy): throws
 *      "Missing config for <skill>: <keys>. Run the skill's setup mode."
 *    with err.code = 'XT_MISSING_CONFIG' and err.missing = [...keys].
 *  - interactive: never throws; returns { config, profile, missing } so the caller can ask
 *    the user for each missing key and save the answers.
 */
export function requireConfig(skill, keys = [], opts = {}) {
  const config = opts.config ?? loadSkillConfig(skill, opts);
  const profile = loadProfile(opts) ?? {};
  const missing = keys.filter((k) =>
    k.startsWith('profile.') ? isMissing(getPath(profile, k.slice(8))) : isMissing(getPath(config, k)),
  );
  if (missing.length && !opts.interactive) {
    const err = new Error(`Missing config for ${skill}: ${missing.join(', ')}. Run the skill's setup mode.`);
    err.code = 'XT_MISSING_CONFIG';
    err.missing = missing;
    throw err;
  }
  return { config, profile, missing };
}
