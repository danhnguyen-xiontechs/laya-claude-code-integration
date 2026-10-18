// lib.mjs — shared helpers for the round-4 experiment: paths, the subagent prompt, the router CLI.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const here = import.meta.dirname;
export const EXP = path.resolve(here, '..');
export const CASES = path.join(EXP, 'cases');
// experiment → subagent-model-router → skill-tool-lifecycle → reports → repo root
export const ROUTE = path.join(EXP, '../../../..', '.claude/skills/subagent-model-router/scripts/route.mjs');
export const ROUTE_TYPE = 'general-purpose';

export const listCases = () => fs.readdirSync(CASES).filter((d) => fs.existsSync(path.join(CASES, d, 'case.json'))).sort();
export const loadCase = (id) => {
  const dir = path.join(CASES, id);
  return { dir, ...JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')), task: fs.readFileSync(path.join(dir, 'task.md'), 'utf8').trim() };
};

/** The prompt a case agent receives: the work folder, then the task (identical in both arms). */
export function subagentPrompt(task, dir) {
  return `Work only inside the directory ${dir.replace(/\\/g, '/')} (it is the project root; do not read or write outside it). Use Node.js (\`node\`), no npm installs.\n\n${task}\n\nOnly use files inside that directory; other folders of the machine hold unrelated material and must not be read.`;
}

/** Puts a fresh work folder in place: empty, plus the visible (weak) check copied from the case. */
export function freshWorkDir(c, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(c.dir, 'check.mjs'), path.join(dir, 'check.mjs'));
  return dir;
}

/** Runs the router CLI in cascade mode with no provider call; returns the parsed decision record. */
export function routeCascade(promptFile, logFile) {
  const r = spawnSync(process.execPath, [ROUTE, '--cascade', '--mode', 'apply', '--provider', 'none', '--task-file', promptFile, '--type', ROUTE_TYPE, '--json'], {
    encoding: 'utf8', env: { ...process.env, SUBAGENT_ROUTER_LOG: logFile }, timeout: 60000,
  });
  if (r.status !== 0) throw new Error(`route.mjs failed: ${(r.stderr || r.stdout).slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

/** Next tier after `tier` for the cascade, or '' at the top (route.mjs --escalate-from). */
export function escalateFrom(tier, logFile) {
  const r = spawnSync(process.execPath, [ROUTE, '--escalate-from', tier], { encoding: 'utf8', env: { ...process.env, SUBAGENT_ROUTER_LOG: logFile }, timeout: 60000 });
  return (r.stdout || '').trim();
}

/** Runs one script with cwd and WORK_DIR; returns true on exit 0. */
export function runScript(script, cwd, env = {}, timeout = 120000) {
  const r = spawnSync(process.execPath, [script], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout });
  return r.status === 0;
}
