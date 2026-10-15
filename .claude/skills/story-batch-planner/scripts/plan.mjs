#!/usr/bin/env node
// CLI: node scripts/plan.mjs --in batch.json [--out plan.json] [--jev] [--max-concurrency N] [--summary]
// Prints the JSON plan (or the human summary with --summary). Jev runs in shadow mode only.
import fs from 'node:fs';
import { plan, jevShadow, loadConfig, summary } from './planner.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
if (!val('--in')) { console.error('usage: plan.mjs --in batch.json [--out plan.json] [--jev] [--max-concurrency N] [--summary]'); process.exit(2); }

const batch = JSON.parse(fs.readFileSync(val('--in'), 'utf8'));
const overrides = { ...(batch.policy || {}) };
if (val('--max-concurrency')) overrides.maxConcurrency = Number(val('--max-concurrency'));
const cfg = loadConfig({ overrides });
if (flag('--jev')) cfg.jev.enabled = true;
if (flag('--no-jev')) cfg.jev.enabled = false;
let result = plan(batch, cfg);
if (cfg.jev.enabled) result = await jevShadow(batch, result, cfg);
if (val('--out')) fs.writeFileSync(val('--out'), JSON.stringify(result, null, 2));
console.log(flag('--summary') ? summary(result) : JSON.stringify(result, null, 2));
