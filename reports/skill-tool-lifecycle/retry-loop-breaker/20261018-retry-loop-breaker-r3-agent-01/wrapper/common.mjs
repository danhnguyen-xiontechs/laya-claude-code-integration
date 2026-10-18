// Shared by the two filters (copied to <ctl>/_lib by make_tasks.mjs; never inside a work folder).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SKIP = new Set(['node_modules', '.git']);

/**
 * Per-file sha256 of the work folder (relative path -> short hash). It is compared before each call with the tree
 * saved after the previous call: a difference is a change made between calls (the agent's edits, deletes, new files),
 * the stand-in for the hook's "successful Edit/Write" epoch bump. Files the guarded run itself writes are not counted.
 */
export function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of fs.readdirSync(d).sort()) {
      if (SKIP.has(n)) continue;
      const p = path.join(d, n);
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p);
      else out[path.relative(dir, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
    }
  };
  walk(dir);
  return out;
}

export function diff(a, b) {
  if (!a) return [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

export const load = (f, init) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : init());
export const save = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
export const log = (f, e) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(e) + '\n'); };
