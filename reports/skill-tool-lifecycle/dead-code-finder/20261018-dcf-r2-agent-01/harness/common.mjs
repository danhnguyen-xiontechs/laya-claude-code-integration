import fs from 'node:fs';
import path from 'node:path';

export const SCRATCH = process.env.RETRO_SCRATCH
  ?? '<home>\\AppData\\Local\\Temp\\claude\\D--XionTechs-Laya--claude-worktrees-gracious-ardinghelli-cf8206\\b4ad4a01-0dce-45af-ad3a-983bf75323ed\\scratchpad';
export const PY = 'D:\\XionTechs\\JEV\\.venv\\Scripts\\python.exe';
export const JEV_SRC = path.join(SCRATCH, 'jev-src');
export const USAGE_SCRIPT = process.env.USAGE_SCRIPT ?? 'D:\\XionTechs\\Laya\\.claude\\worktrees\\gracious-ardinghelli-cf8206\\.claude\\skills\\build-skill-tool-workflow\\scripts\\subagent_usage.mjs';
export const FIXTURES = path.join(SCRATCH, 'build');            // build/out (grs), out2 (dcf), out3 (acc), demo copies
export const HERE = import.meta.dirname;
export const EXP_DIR = process.env.EXP_DIR ?? path.resolve(HERE, '..');   // the experiment folder this harness sits in
export const REPS = [1, 2];

export const copyTree = (src, dst, skip = () => false) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    if (skip(s, e)) continue;
    if (e.isDirectory()) copyTree(s, path.join(dst, e.name), skip); else fs.copyFileSync(s, path.join(dst, e.name));
  }
};
// committed evidence: the Windows home folder (user name) is replaced by <home>
export const scrub = (s) => s.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/gi, '<home>');
export const readLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
export const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : '');

// work folders live apart from the answer keys, the harness and the JEV copy that holds the demo gold files
export const WORK_ROOT = process.env.WORK_ROOT ?? '<home>\\AppData\\Local\\Temp\\rw-r2';
// the JEV copy the wrappers import: no gold.json, no saved run outputs, no tests
export const JEV_RUN = path.join(SCRATCH, 'jev-run');
