#!/usr/bin/env node
// make_evidence.mjs - saves what Claude would read first in each arm: rebuilds each case fresh (pristine copy of the
// r1 work folder without .tool-output) and runs the wrapper once per arm. Machine paths are shortened.
// Usage: node make_evidence.mjs adv|cur
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const TOOL = process.argv[2];
const EXP = import.meta.dirname;
const SC = process.env.SCRATCH_ROOT ?? '<home>/AppData/Local/Temp/claude/D--XionTechs-Laya--claude-worktrees-magical-shtern-feba85/c4cf5e0b-3d40-4d6a-8707-bea182c14834/scratchpad';
const ROOT = `${SC}/${TOOL}`;
const PY = 'D:/XionTechs/JEV/.venv/Scripts/python.exe';
const map = JSON.parse(fs.readFileSync(`${ROOT}/workmap.json`, 'utf8')).filter((x) => x.rep === 1);
const EW = `${ROOT}/evidence_work`;
fs.rmSync(EW, { recursive: true, force: true });
fs.cpSync(`${ROOT}/work/_shared`, `${EW}/_shared`, { recursive: true });
fs.mkdirSync(`${EXP}/evidence/texts`, { recursive: true });
const BS = String.fromCharCode(92);
const scrub = (s) => s.replaceAll(SC.replaceAll('/', BS), '<scratch>').replaceAll(SC, '<scratch>').replaceAll(process.env.HOME_DIR ?? '<none>', '<home>');
for (const x of map) {
  const dir = `${EW}/${x.caseId}.${x.arm}`;
  fs.cpSync(x.workDir, dir, { recursive: true, filter: (s) => !s.includes('.tool-output') && !s.includes('__pycache__') && !s.includes('.pytest_cache') });
  const r = spawnSync(PY, ['runtest.py'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20, env: process.env });
  const out = scrub(r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : ''));
  fs.writeFileSync(`${EXP}/evidence/texts/${x.caseId}.${x.arm}.txt`, out);
  console.log(x.caseId, x.arm, 'exit', r.status, out.length, 'chars');
}
