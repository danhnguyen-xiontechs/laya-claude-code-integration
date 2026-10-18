#!/usr/bin/env node
// Collects what the 8 case agents produced, from their subagent transcripts (found by the work folder in each prompt):
//   evidence/answers/<case>.<A|B>.txt  the agent's final answer (the message it handed back, verbatim)
//   evidence/usage.json                real token usage per work folder (subagent_usage.mjs), machine paths shortened
//   <scratch>/models.json              the model each agent ran on, read from its transcript
// Usage: node collect.mjs <subagentsDir> <scratchCteDir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [subDir, scratch] = process.argv.slice(2);
if (!subDir || !scratch) {
  console.error('Usage: node collect.mjs <subagentsDir> <scratchCteDir>');
  process.exit(2);
}
const EXP = import.meta.dirname;
const USAGE = 'D:/XionTechs/Laya/.claude/skills/build-skill-tool-workflow/scripts/subagent_usage.mjs';
const map = JSON.parse(fs.readFileSync(path.join(scratch, 'workmap.json'), 'utf8'));
const r = spawnSync(process.execPath, [USAGE, subDir, ...map.map((x) => x.workDir)], { encoding: 'utf8', maxBuffer: 64 << 20 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const usage = JSON.parse(r.stdout);

fs.mkdirSync(path.join(EXP, 'evidence', 'answers'), { recursive: true });
const models = {};
for (const x of map) {
  const u = usage[x.workDir];
  const key = `${x.key}.${x.arm}`;
  if (!u?.transcript) { console.log(key, 'NO TRANSCRIPT', u?.error); continue; }
  let answer = null;
  for (const l of fs.readFileSync(u.transcript, 'utf8').split('\n')) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e.type !== 'assistant') continue;
    models[key] ??= e.message?.model ?? null;
    for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') answer = c.input.message;
  }
  if (answer) fs.writeFileSync(path.join(EXP, 'evidence', 'answers', `${key}.txt`), answer.endsWith('\n') ? answer : answer + '\n');
  console.log(key, models[key], answer ? `answer ${answer.length} chars` : 'NO ANSWER');
}
fs.writeFileSync(path.join(scratch, 'models.json'), JSON.stringify(models, null, 2));
// the saved usage keeps no machine paths
const scrub = (s) => s.replace(/C:\\\\Users\\\\ADMIN/g, '<home>').replace(/C:\/Users\/ADMIN/g, '<home>');
fs.writeFileSync(path.join(EXP, 'evidence', 'usage.json'), JSON.stringify(usage, null, 2));
fs.writeFileSync(path.join(EXP, 'evidence', 'usage.scrubbed.json'), scrub(JSON.stringify(usage, null, 2)));
