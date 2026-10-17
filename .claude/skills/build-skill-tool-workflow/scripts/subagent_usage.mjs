#!/usr/bin/env node
// Real usage of agent-run cases that ran as subagents (Agent tool) of this session: finds each case's subagent
// transcript by the work dir named in its prompt, and sums that transcript's API usage (transcript_usage.mjs).
// A work dir that matches no transcript, or more than one, gives null: never a guess.
//
// Usage: node subagent_usage.mjs <subagentsDir> [--forbid <regex>] <workDir...>
//   subagentsDir = ~/.claude/projects/<project>/<sessionId>/subagents (one flat folder of agent-<id>.jsonl files)
//   --forbid     counts the agent's own tool calls (the Skill tool included, by skill name) whose input matches the
//                regex, case-insensitive: use it on arm A with the tool's slug and script name, to see whether the
//                plain arm used the tool. The prompt is not scanned, only what the agent did.
// Prints JSON { "<workDir>": { transcript, usage, forbiddenCalls? } | { transcript: null, error } }.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const fi = argv.indexOf('--forbid');
const forbid = fi >= 0 ? new RegExp(argv[fi + 1], 'i') : null;
if (fi >= 0) argv.splice(fi, 2);
const [subDir, ...dirs] = argv;
if (!subDir || !dirs.length || (fi >= 0 && !forbid)) {
  console.error('Usage: node subagent_usage.mjs <subagentsDir> [--forbid <regex>] <workDir...>');
  process.exit(2);
}
function forbiddenCalls(file) {
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant') continue;
    for (const c of e.message?.content ?? []) {
      if (c.type !== 'tool_use' || c.name === 'SubagentHandback') continue;
      if (forbid.test(`${c.name === 'Skill' ? c.input?.skill ?? '' : ''} ${JSON.stringify(c.input ?? {})}`)) n++;
    }
  }
  return n;
}
const usageScript = path.join(import.meta.dirname, 'transcript_usage.mjs');
// the first user message of a subagent transcript is the prompt it was given
const transcripts = fs.readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).map((f) => {
  const p = path.join(subDir, f);
  const first = fs.readFileSync(p, 'utf8').split('\n').find((l) => l.includes('"type":"user"')) ?? '';
  return { p, first };
});
const out = {};
for (const d of dirs) {
  const abs = path.resolve(d);
  // the path as it appears inside JSON, followed by a line break or quote, so "case.r1" never matches "case.r10"
  const keys = [abs, abs.split(path.sep).join('/')].map((k) => JSON.stringify(k).slice(1, -1));
  const hits = transcripts.filter((t) => keys.some((k) => ['\\n', '\\r', '"', ' '].some((end) => t.first.includes(k + end))));
  if (hits.length !== 1) {
    out[d] = { transcript: null, error: hits.length ? `${hits.length} transcripts match` : 'no transcript' };
    continue;
  }
  const u = JSON.parse(spawnSync(process.execPath, [usageScript, hits[0].p, '--no-subagents'], { encoding: 'utf8' }).stdout);
  out[d] = { transcript: hits[0].p, usage: u, ...(forbid ? { forbiddenCalls: forbiddenCalls(hits[0].p) } : {}) };
}
console.log(JSON.stringify(out, null, 2));
