#!/usr/bin/env node
// route.mjs — CLI for an orchestrator: pick the model for one subagent before spawning it.
//
//   node route.mjs --task "<subagent prompt>" [--type <subagent_type>] [--task-file f]
//                  [--mode off|shadow|apply] [--provider none|jev|laya] [--policy rules|jev|gate|sc|gate+sc]
//                  [--k 3] [--json] [--escalate-from <tier>]
//
// Prints the tier to pass as the Agent tool's `model` (haiku|sonnet|opus), or nothing when the
// caller should keep its default (mode off/shadow, or the provider failed). --json prints the
// whole decision record. --escalate-from <tier> prints the next tier for the cascade (or nothing).
import fs from 'node:fs';
import { loadConfig, route, nextTier, TIERS } from './router.mjs';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    if (name === 'json') { a.json = true; continue; }
    a[name] = argv[++i];
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args['escalate-from']) {
  if (!TIERS.includes(args['escalate-from'])) { console.error(`--escalate-from must be one of ${TIERS.join(', ')}`); process.exit(2); }
  const n = nextTier(args['escalate-from']);
  if (n) console.log(n);
  process.exit(0);
}
const task = args['task-file'] ? fs.readFileSync(args['task-file'], 'utf8') : args.task;
if (!task) { console.error('usage: route.mjs --task "<subagent prompt>" [--type <subagent_type>] [--json]'); process.exit(2); }

let cfg;
try {
  cfg = loadConfig({ overrides: { mode: args.mode, provider: args.provider, policy: args.policy, k: args.k ? Number(args.k) : undefined } });
} catch (e) { console.error(e.message); process.exit(2); }

const rec = await route({ task, type: args.type ?? '', cfg, source: 'cli' });
if (args.json) console.log(JSON.stringify(rec, null, 2));
else if (cfg.mode === 'apply' && rec.tier) console.log(rec.tier);
