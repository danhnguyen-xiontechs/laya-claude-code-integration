// Shared fixtures for the story 2269 tests: a temp run folder and injected Agent, test runner and JEV ask.
// Nothing here makes a network call or touches git: every outside effect of runAuto is a stub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTO_CLI = path.join(SKILL_DIR, 'scripts', 'auto.mjs');
export const STATUS_CLI = path.join(SKILL_DIR, '..', 'haiku-build', 'scripts', 'status.mjs');

/** A spec text that passes savePlanSpec (four required headings, under 800 words). */
export const SPEC = [
  '# Spec: fixture', '', '## 1. Goal & Intent', 'Add a flag.', '',
  '## 6. Tasks & Acceptance Criteria', '- `src/a.mjs` add the flag', '- AC1: flag works', '',
  '## 7. Red Checks', 'red: test "flag" fails before', '', '## 8. Verification', '`node --test`', '',
].join('\n');

export const MAJOR = { severity: 'Major', lens: 'blind-hunter', finding: 'flag ignored on empty input', ref: 'src/a.mjs:3' };
export const MINOR = { severity: 'Minor', lens: 'verification-gap', finding: 'no test for the default', ref: 'src/a.mjs:9' };

export function tmpDir(prefix = 'haiku-build-auto-2269-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * An injected Agent tool. `script` maps a role (plan, implement, sonnet-retry, fix-tests, review, fix,
 * re-review) to a text or a function (req, n) -> text, where n counts the calls of that role from 1.
 * Defaults: plan -> SPEC, review / re-review -> "[]". Every request is kept in `calls`.
 */
export function fakeAgent(script = {}) {
  const calls = [];
  const counts = {};
  const defaults = { plan: SPEC, review: '[]', 're-review': '[]' };
  const agent = async (req) => {
    calls.push(req);
    counts[req.role] = (counts[req.role] ?? 0) + 1;
    const v = req.role in script ? script[req.role] : defaults[req.role] ?? 'ok';
    return typeof v === 'function' ? v(req, counts[req.role]) : v;
  };
  return { agent, calls, count: (role) => calls.filter((c) => c.role === role).length };
}

/** An injected test runner: `results` is a list of booleans (pass/fail) per run; the last one repeats. */
export function fakeTests(results = [true]) {
  const runs = [];
  const runTests = async (req) => {
    runs.push(req);
    const ok = results[Math.min(runs.length - 1, results.length - 1)];
    return { passed: ok ? 3 : 2, failed: ok ? 0 : 1, log: ok ? 'pass 3 fail 0' : 'pass 2 fail 1', command: 'node --test' };
  };
  return { runTests, runs };
}

/** A JEV ask that must never be reached (JEV is off in the base deps). */
export function noAsk() {
  const asked = [];
  return { ask: async (q) => { asked.push(q); throw new Error('network call attempted'); }, asked };
}

/** Base runAuto deps: clean tree, preflight ok, fixed diff, no real commit, JEV off, a fresh run folder. */
export function baseDeps(over = {}) {
  const root = tmpDir();
  const runDir = path.join(root, 'reports', 'haiku-build', '20261022-fixture-01');
  return {
    runDir,
    task: 'add a --flag option to the fixture CLI',
    startModel: 'claude-haiku-5-5',
    env: { HAIKU_BUILD_JEV: 'off' },
    ask: noAsk().ask,
    gitClean: () => true,
    gitDiff: () => 'diff --git a/src/a.mjs b/src/a.mjs\n+export const flag = true;\n',
    gitCommit: () => ({ committed: false, reason: 'fixture' }),
    preflight: () => ({ ok: true, message: 'preflight ok: fixture' }),
    ...over,
  };
}
