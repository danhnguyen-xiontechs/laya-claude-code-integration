// run_cascade.mjs — scripted escalation driver for the checked cascade (arm B) and the plain arm (A).
// The orchestrator spawns each case agent itself (Agent tool, model = the tier printed here); this script
// prepares fresh work folders, runs the visible (weak) check, decides the single escalation, and grades the
// final attempt on the hidden strict check. State lives outside the work folders, so case agents never see it.
//
//   node scripts/run_cascade.mjs prepare <case> <A|B> <rep> [--root <dir>]   → tier + prompt file for attempt 1
//   node scripts/run_cascade.mjs check <runDir>        → visible check of the latest attempt; "ESCALATE <tier>" or "DONE"
//   node scripts/run_cascade.mjs escalate <runDir>     → fresh work folder + prompt for the escalated attempt
//   node scripts/run_cascade.mjs grade <runDir>        → hidden strict check of the latest attempt; writes state.json
//
// Arm A: every attempt is sonnet and there is no escalation. Arm B: tier from route.mjs --cascade (provider none),
// one escalation when the visible check fails (route.mjs --escalate-from), graded on the final attempt only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCase, subagentPrompt, freshWorkDir, routeCascade, escalateFrom, runScript } from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };
const positional = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--')));
const DEFAULT_ROOT = path.join(os.homedir(), '.subagent-model-router', 'bench', 'r4-weakcheck');

const readState = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
const writeState = (runDir, s) => fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(s, null, 2) + '\n');
const latest = (s) => s.attempts[s.attempts.length - 1];
const logFile = (runDir) => path.join(runDir, '..', 'route-log.jsonl');

function newAttempt(s, runDir, tier) {
  const n = s.attempts.length + 1;
  const c = loadCase(s.case);
  const dir = freshWorkDir(c, path.join(runDir, `a${n}`));
  const promptFile = path.join(runDir, `a${n}.prompt.txt`);
  fs.writeFileSync(promptFile, subagentPrompt(c.task, dir));
  const attempt = { n, tier, dir, prompt: promptFile, visible: null };
  s.attempts.push(attempt);
  return attempt;
}

if (cmd === 'prepare') {
  const [id, arm, rep] = positional;
  if (!id || !['A', 'B'].includes(arm) || !rep) { console.error('usage: prepare <case> <A|B> <rep> [--root dir]'); process.exit(2); }
  const runDir = path.join(flag('root', DEFAULT_ROOT), `${id}.${arm}.r${rep}`);
  fs.mkdirSync(runDir, { recursive: true });
  const c = loadCase(id);
  const s = { case: id, kind: c.kind, arm, rep: Number(rep), escalated: false, attempts: [], final: null };
  let tier = 'sonnet';
  if (arm === 'B') {
    const promptFile = path.join(runDir, 'route-prompt.txt');
    fs.writeFileSync(promptFile, subagentPrompt(c.task, path.join(runDir, 'a1')));
    const rec = routeCascade(promptFile, logFile(runDir));
    fs.writeFileSync(path.join(runDir, 'route.json'), JSON.stringify(rec, null, 2) + '\n');
    tier = rec.tier;
    if (!tier) { console.error('route.mjs returned no tier'); process.exit(1); }
  }
  const a = newAttempt(s, runDir, tier);
  writeState(runDir, s);
  console.log(`prepared ${id}.${arm}.r${rep} tier=${a.tier} prompt=${a.prompt}`);
} else if (cmd === 'check') {
  const runDir = positional[0];
  const s = readState(runDir);
  const a = latest(s);
  const c = loadCase(s.case);
  fs.copyFileSync(path.join(c.dir, 'check.mjs'), path.join(a.dir, 'check.mjs')); // a fresh copy: agents cannot edit the check
  a.visible = runScript('check.mjs', a.dir);
  writeState(runDir, s);
  if (!a.visible && s.arm === 'B' && !s.escalated) {
    const next = escalateFrom(a.tier, logFile(runDir));
    if (next) { console.log(`ESCALATE ${next}`); process.exit(0); }
  }
  console.log(`DONE visible=${a.visible ? 'pass' : 'fail'}`);
} else if (cmd === 'escalate') {
  const runDir = positional[0];
  const s = readState(runDir);
  if (s.arm !== 'B') { console.error('arm A has no escalation'); process.exit(1); }
  if (s.escalated) { console.error('already escalated once'); process.exit(1); }
  const next = escalateFrom(latest(s).tier, logFile(runDir));
  if (!next) { console.error('no escalation tier above ' + latest(s).tier); process.exit(1); }
  const a = newAttempt(s, runDir, next);
  s.escalated = true;
  writeState(runDir, s);
  console.log(`escalated tier=${a.tier} prompt=${a.prompt}`);
} else if (cmd === 'grade') {
  const runDir = positional[0];
  const s = readState(runDir);
  const a = latest(s);
  if (a.visible === null) { console.error('run check first'); process.exit(1); }
  const c = loadCase(s.case);
  const strict = runScript(path.join(c.dir, 'hidden', 'strict.mjs'), c.dir, { WORK_DIR: a.dir });
  s.final = { attempt: a.n, tier: a.tier, visible: a.visible, strict, silentMiss: a.visible && !strict, attempts: s.attempts.length };
  writeState(runDir, s);
  console.log(`graded ${s.case}.${s.arm}.r${s.rep} strict=${strict ? 'pass' : 'fail'} visible=${a.visible ? 'pass' : 'fail'} silentMiss=${s.final.silentMiss} attempts=${s.attempts.length}`);
} else {
  console.error('usage: run_cascade.mjs <prepare|check|escalate|grade> ...');
  process.exit(2);
}
