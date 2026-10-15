// Mutation check for test-writing tasks: the agent's test file must pass on the original source and
// fail on every mutant in <task>/mutants/*.js (each swapped in for the source in a temp copy).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WORK } from './check-util.mjs';

const runTest = (dir, testRel) => spawnSync(process.execPath, ['--test', testRel], { cwd: dir, encoding: 'utf8', timeout: 60000 }).status === 0;

export function mutationCheck(checkUrl, srcRel, testRel) {
  if (!fs.existsSync(path.join(WORK, testRel))) return false;
  if (!runTest(WORK, testRel)) return false;
  const mdir = path.join(path.dirname(fileURLToPath(checkUrl)), 'mutants');
  let killed = 0, total = 0;
  for (const m of fs.readdirSync(mdir).filter((f) => f.endsWith('.js'))) {
    total++;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
    fs.cpSync(WORK, tmp, { recursive: true });
    fs.copyFileSync(path.join(mdir, m), path.join(tmp, srcRel));
    if (!runTest(tmp, testRel)) killed++;
    else if (process.env.CHECK_VERBOSE) console.error(`survived: ${m}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return total > 0 && killed === total;
}
