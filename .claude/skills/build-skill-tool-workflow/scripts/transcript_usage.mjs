#!/usr/bin/env node
// Real usage of one agent run, summed from a Claude Code session transcript (the API usage of every
// assistant message). Paste the result into case.usage of results.json.
//
// Usage: node transcript_usage.mjs <session.jsonl> [--from ISO] [--to ISO]
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) {
  console.error('Usage: node transcript_usage.mjs <session.jsonl> [--from ISO] [--to ISO]');
  process.exit(2);
}
const from = opt('--from') ? Date.parse(opt('--from')) : -Infinity;
const to = opt('--to') ? Date.parse(opt('--to')) : Infinity;
const seen = new Set();
const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, modelTurns: 0, toolCalls: 0, source: file };
let first, last;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const t = Date.parse(e.timestamp ?? '');
  if (e.type !== 'assistant' || !(t >= from && t <= to)) continue;
  const id = e.message?.id; // one API message is split over several transcript lines
  u.toolCalls += (e.message?.content ?? []).filter((c) => c.type === 'tool_use').length;
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const m = e.message.usage ?? {};
  u.inputTokens += m.input_tokens ?? 0;
  u.outputTokens += m.output_tokens ?? 0;
  u.cacheReadTokens += m.cache_read_input_tokens ?? 0;
  u.cacheWriteTokens += m.cache_creation_input_tokens ?? 0;
  u.modelTurns++;
  first ??= t;
  last = t;
}
u.elapsedMs = first != null ? last - first : null;
console.log(JSON.stringify(u, null, 2));
