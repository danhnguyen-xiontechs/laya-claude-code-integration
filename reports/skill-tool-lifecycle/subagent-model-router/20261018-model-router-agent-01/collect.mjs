#!/usr/bin/env node
// Collects, per case agent (found by work folder in its prompt): real usage, model, price-weighted cost, forbidden-read count,
// the hand-back answer and the prompt text. Usage: node collect.mjs <subagentsDir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tierOf, usageCost } from '../../../../.claude/skills/subagent-model-router/scripts/pricing.mjs';
const sub = process.argv[2];
const here = import.meta.dirname;
const USAGE = path.join(here, '../../../../.claude/skills/build-skill-tool-workflow/scripts/subagent_usage.mjs');
const FORBID = "subagent-model-router|bench[\\/]+tasks|[\\/]hidden|solution|route\.mjs";
const idx = JSON.parse(fs.readFileSync(path.join(here, 'evidence/run-index.json'), 'utf8'));
const BS = String.fromCharCode(92);
const fwd = (p) => p.split(BS).join("/");
const dirs = idx.map((e) => fwd(e.dir));
const r = spawnSync(process.execPath, [USAGE, sub, '--forbid', FORBID, ...dirs], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (r.status) { console.error(r.stderr); process.exit(1); }
const usage = JSON.parse(r.stdout);
const scrub = (s) => s.split("C:"+BS+BS+"Users"+BS+BS+"ADMIN").join("<home>").split("C:/Users/ADMIN").join("<home>").replace(/[A-Za-z]:[^"s]*?scratchpad[^"s]*?work/g, "<work>");
const out = {};
for (const e of idx) {
  const key = path.basename(e.dir);
  const u = usage[fwd(e.dir)] ?? usage[e.dir];
  if (!u?.transcript) { out[key] = { error: u?.error ?? 'no entry' }; console.log(key, 'NO TRANSCRIPT'); continue; }
  const seen = new Set(); let cost = 0, answer = null, model = null; const models = new Set();
  let first = null, last = null;
  for (const l of fs.readFileSync(u.transcript, 'utf8').split('\n')) {
    let x; try { x = JSON.parse(l); } catch { continue; }
    if (x.timestamp) { first ??= x.timestamp; last = x.timestamp; }
    if (x.type !== 'assistant') continue;
    const m = x.message; if (!m) continue;
    for (const c of m.content ?? []) if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') answer = c.input.message;
    if (m.usage && m.id && !seen.has(m.id)) { seen.add(m.id); model = m.model; models.add(m.model); cost += usageCost(tierOf(m.model), m.usage); }
  }
  fs.writeFileSync(path.join(here, 'evidence/answers', `${e.case}.${e.arm}.r${e.rep}.txt`), (answer ?? '(no hand-back)') + '\n');
  fs.writeFileSync(path.join(here, 'evidence/texts', `${e.case}.${e.arm}.r${e.rep}.txt`), scrub(fs.readFileSync(e.promptFile, 'utf8')));
  out[key] = { case: e.case, arm: e.arm, rep: e.rep, requestedModel: e.model, models: [...models], costUsd: cost, usage: u.usage, forbiddenCalls: u.forbiddenCalls, first, last };
  console.log(key, [...models].join(','), 'cost', cost.toFixed(4), 'forbid', u.forbiddenCalls, 'turns', u.usage.modelTurns);
}
fs.writeFileSync(path.join(here, 'evidence/subagent-usage.json'), scrub(JSON.stringify(out, null, 2)));
