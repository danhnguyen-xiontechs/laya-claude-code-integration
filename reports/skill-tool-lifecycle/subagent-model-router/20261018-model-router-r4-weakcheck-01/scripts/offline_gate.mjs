// offline_gate.mjs — no agent spend. Checks the case set against the frozen design (design.md, "Offline gate"):
//   good ref   passes visible and strict;
//   weak case  wrong ref passes visible and fails strict;
//   control    wrong ref fails visible (and strict).
// Needs at least 4 weak cases. Also records the tier route.mjs --cascade gives each case (provider none);
// the design keeps a case whatever its tier, so the tier is recorded, not gated.
// Usage: node scripts/offline_gate.mjs   (prints one line per case and PASS/FAIL; writes offline-gate.json)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCases, loadCase, subagentPrompt, routeCascade, runScript, EXP } from './lib.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mr4-gate-'));
const logFile = path.join(scratch, 'route-log.jsonl');

function materialize(c, variant) {
  const dir = path.join(scratch, `${c.id}.${variant}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(c.dir, 'ref', variant, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(c.dir, 'check.mjs'), path.join(dir, 'check.mjs'));
  return dir;
}

const rows = [];
for (const id of listCases()) {
  const c = loadCase(id);
  const outcome = {};
  for (const variant of ['good', 'wrong']) {
    const dir = materialize(c, variant);
    const visible = runScript('check.mjs', dir);
    const strict = runScript(path.join(c.dir, 'hidden', 'strict.mjs'), c.dir, { WORK_DIR: dir });
    outcome[variant] = { visible, strict };
  }
  const promptFile = path.join(scratch, `${c.id}.prompt.txt`);
  fs.writeFileSync(promptFile, subagentPrompt(c.task, path.join(scratch, `${c.id}.a1`)));
  const rec = routeCascade(promptFile, logFile);
  const tier = rec.tier ?? null;

  const goodOk = outcome.good.visible && outcome.good.strict;
  // runScript returns true on exit 0 (pass): "wrong fails strict" is !outcome.wrong.strict
  const weakOk = c.kind === 'weak' && outcome.wrong.visible && !outcome.wrong.strict;
  const controlOk = c.kind === 'control' && !outcome.wrong.visible && !outcome.wrong.strict;
  const ok = goodOk && (weakOk || controlOk);
  rows.push({ id, kind: c.kind, good: outcome.good, wrong: outcome.wrong, tier, ok });
  const flag = (b) => (b ? 'pass' : 'fail');
  console.log(`${id.padEnd(12)} ${c.kind.padEnd(8)} good v:${flag(outcome.good.visible)} s:${flag(outcome.good.strict)} | wrong v:${flag(outcome.wrong.visible)} s:${flag(outcome.wrong.strict)} | tier ${tier} | ${ok ? 'OK' : 'FAIL'}`);
}

const weak = rows.filter((r) => r.kind === 'weak').length;
const allOk = rows.length === 6 && weak >= 4 && rows.every((r) => r.ok);
const summary = { gate: allOk ? 'PASS' : 'FAIL', cases: rows.length, weak, control: rows.length - weak, haikuFirst: rows.filter((r) => r.tier === 'haiku').length, rows };
fs.writeFileSync(path.join(EXP, 'offline-gate.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`offline gate ${summary.gate}: ${rows.length} cases, ${weak} weak, ${summary.haikuFirst} routed to haiku first`);
process.exitCode = allOk ? 0 : 1;
