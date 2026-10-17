#!/usr/bin/env node
// Real usage of agent-run cases that ran as subagents (Agent tool) of this session: finds each case's subagent
// transcript by the work dir named in its prompt, and sums that transcript's API usage (transcript_usage.mjs).
// A work dir that matches no transcript, or more than one, gives null: never a guess.
//
// Usage: node subagent_usage.mjs <subagentsDir> <workDir...>
//   subagentsDir = ~/.claude/projects/<project>/<sessionId>/subagents
// Prints JSON { "<workDir>": { transcript, usage } | { transcript: null, error } }.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [subDir, ...dirs] = process.argv.slice(2);
if (!subDir || !dirs.length) {
  console.error('Usage: node subagent_usage.mjs <subagentsDir> <workDir...>');
  process.exit(2);
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
  out[d] = { transcript: hits[0].p, usage: u };
}
console.log(JSON.stringify(out, null, 2));
