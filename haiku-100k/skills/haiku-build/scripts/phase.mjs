#!/usr/bin/env node
// Opens and closes phase windows in manifest.phases with the real clock, so no timestamp is typed or estimated.
// The 100k check counts each request inside these windows; a hand-typed or zero-width window makes it wrong
// or not_measured.
//
// Usage: node phase.mjs <runDir> start <phase>   closes the open window (if any) now, opens <phase> now
//        node phase.mjs <runDir> end             closes the open window now
//   Prints one line with the phase and time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function startPhase(m, phase, now = new Date()) {
  const at = now.toISOString();
  const phases = (m.phases ?? []).map((p) => (p.to ? p : { ...p, to: at }));
  return { ...m, phases: [...phases, { phase, from: at }] };
}

export function endPhase(m, now = new Date()) {
  const at = now.toISOString();
  return { ...m, phases: (m.phases ?? []).map((p) => (p.to ? p : { ...p, to: at })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runDir, cmd, phase] = process.argv.slice(2);
  if (!runDir || !['start', 'end'].includes(cmd) || (cmd === 'start' && !phase)) {
    console.log('usage: node phase.mjs <runDir> start <phase> | end');
    process.exit(2);
  }
  const mf = path.join(runDir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const next = cmd === 'start' ? startPhase(m, phase) : endPhase(m);
  fs.writeFileSync(mf, JSON.stringify(next, null, 2));
  const last = next.phases.at(-1);
  console.log(cmd === 'start' ? `phase ${phase} from ${last.from}` : `phases closed at ${last?.to ?? 'n/a'}`);
}
