#!/usr/bin/env node
// Evidence of what Claude read: rebuilds each task fresh and saves the output of its first test/build run per arm
// (A = raw, B = trimmed by trim-core) to evidence/texts/<case>.<A|B>.txt, then links them from every case in
// runs/*/*/results.json. The first run is deterministic for the rules; a Jev answer (dotnet-build) can differ
// from the one the agents got, so the per-run filter logs stay the record of what Jev decided.
// Usage: node make_evidence.mjs <scratchDir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scratch = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('Usage: node make_evidence.mjs <scratchDir>');
  process.exit(2);
}
const here = import.meta.dirname;
spawnSync(process.execPath, [path.join(here, 'make_tasks.mjs'), scratch, '--reps', '1'], { stdio: 'inherit' });
const tasks = JSON.parse(fs.readFileSync(path.join(scratch, 'tasks.json'), 'utf8'));
const texts = path.join(here, 'evidence', 'texts');
fs.mkdirSync(texts, { recursive: true });
for (const t of tasks) {
  const r = spawnSync(process.execPath, ['run.mjs', t.command.split(' ').pop()], { cwd: t.dir, encoding: 'utf8', maxBuffer: 64 << 20 });
  // machine-specific scratch paths are shortened so the evidence reads the same anywhere
  const out = (r.stdout + r.stderr).split(t.dir).join(`<${t.caseId}>`).split(t.dir.split(path.sep).join('/')).join(`<${t.caseId}>`);
  fs.writeFileSync(path.join(texts, `${t.caseId}.${t.arm}.txt`), out);
  console.log(`${t.caseId}.${t.arm}: ${Buffer.byteLength(out)} bytes`);
}
for (const armDir of ['A-claude', 'B-claude-jev'])
  for (const runId of fs.readdirSync(path.join(here, 'runs', armDir))) {
    const f = path.join(here, 'runs', armDir, runId, 'results.json');
    const res = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const c of res.cases) {
      const text = `../../../evidence/texts/${c.caseId}.${c.arm}.txt`;
      c.evidenceRefs = [text, ...(c.evidenceRefs ?? []).filter((e) => e !== text)];
    }
    fs.writeFileSync(f, JSON.stringify(res, null, 2));
  }
