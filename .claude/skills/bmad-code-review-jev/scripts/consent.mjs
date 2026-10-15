#!/usr/bin/env node
// consent.mjs — per-machine, per-project record of whether code may be sent to the hosted Jev provider.
//
//   node consent.mjs --project-root <dir>                 → prints approved | denied | unknown
//   node consent.mjs --project-root <dir> --approve|--deny
//
// Stored in <skill-dir>/jev.local.json (gitignored) under "projects": { "<abs root>": true|false }.
// Only the hosted provider (jev) needs it; laya and kev run locally.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './decision-provider.mjs';

const LOCAL = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'jev.local.json');

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args['project-root'] || process.cwd()).toLowerCase();
let local = {};
try { local = JSON.parse(fs.readFileSync(LOCAL, 'utf8')); } catch { /* none yet */ }
if (args.approve || args.deny) {
  local.projects = { ...local.projects, [root]: Boolean(args.approve) };
  fs.writeFileSync(LOCAL, `${JSON.stringify(local, null, 2)}\n`);
}
const v = local.projects?.[root];
console.log(v === true ? 'approved' : v === false ? 'denied' : 'unknown');
