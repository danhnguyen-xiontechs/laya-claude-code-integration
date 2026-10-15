// Helpers for task checks. A check runs with cwd = the task's work directory and exits 0 on pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WORK = process.cwd();
export const readAnswer = () => { try { return fs.readFileSync(path.join(WORK, 'answer.txt'), 'utf8').trim(); } catch { return ''; } };

/** Runs `node --test` on the given test files (absolute paths) with WORK_DIR set; true on pass. */
export function nodeTest(files, { env = {} } = {}) {
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: WORK, env: { ...process.env, WORK_DIR: WORK, ...env }, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0 && process.env.CHECK_VERBOSE) process.stderr.write(r.stdout + r.stderr);
  return r.status === 0;
}

/** Hidden tests of a task: <task>/hidden/*.test.mjs (they import the work dir via process.env.WORK_DIR). */
export function hiddenTests(checkUrl) {
  const dir = path.join(path.dirname(fileURLToPath(checkUrl)), 'hidden');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f));
}

/** Visible tests the agent was given: WORK/test/*.test.mjs */
export function visibleTests() {
  const dir = path.join(WORK, 'test');
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f)); } catch { return []; }
}

/** import() a module from the work dir (for hidden tests). */
export const work = (rel) => import(pathToFileURL(path.join(process.env.WORK_DIR ?? WORK, rel)).href + `?t=${Date.now()}`);

export function grepWork(re, exts = ['.js', '.mjs']) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.some((x) => e.name.endsWith(x)) && re.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(WORK, p));
    }
  };
  walk(WORK);
  return hits;
}
