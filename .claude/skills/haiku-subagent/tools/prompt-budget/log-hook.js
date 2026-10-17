#!/usr/bin/env node
// Claude Code hook for PostToolUse (Agent|Task) and SubagentStop: records what each subagent run
// actually consumed, so report.js can compare it with what the optimizer did.
//  - PostToolUse  -> {type:'post'}: tool_use_id <-> agent_id link + usage of the final request
//  - SubagentStop -> {type:'stop'}: whole-run token usage + size of the prompt the subagent received
//    (parsed best-effort from the transcript, whose line format is undocumented).
import { readFileSync } from 'node:fs';
import { logEvent } from './log.js';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

const textLen = (c) =>
  typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((n, b) => n + (b?.text?.length ?? 0), 0) : 0;

function readTranscript(path) {
  const out = { usage: null, first_prompt_chars: null };
  const byMsg = new Map(); // dedupe repeated streaming entries of the same assistant message
  raw: for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const msg = e.message ?? e;
    if (out.first_prompt_chars === null && (msg.role === 'user' || e.type === 'user')) {
      out.first_prompt_chars = textLen(msg.content);
      continue raw;
    }
    if (msg.usage) byMsg.set(msg.id ?? byMsg.size, msg.usage);
  }
  if (byMsg.size) {
    const sum = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    for (const u of byMsg.values()) for (const k of Object.keys(sum)) sum[k] += u[k] ?? 0;
    out.usage = sum;
    out.requests = byMsg.size; // report.js prices the tier per request (average), not on the run total
  }
  return out;
}

try {
  const ev = JSON.parse(raw);
  if (ev.hook_event_name === 'PostToolUse') {
    const r = ev.tool_response ?? {};
    logEvent({ type: 'post', tool_use_id: ev.tool_use_id, agent_id: r.agentId, status: r.status, duration_ms: ev.duration_ms ?? r.totalDurationMs, last_request_usage: r.usage }, ev.cwd);
  } else if (ev.hook_event_name === 'SubagentStop') {
    let t = {};
    try { if (ev.agent_transcript_path) t = readTranscript(ev.agent_transcript_path); } catch { /* transcript unreadable */ }
    logEvent({ type: 'stop', agent_id: ev.agent_id, agent_type: ev.agent_type, ...t }, ev.cwd);
  }
} catch (e) {
  process.stderr.write(`[prompt-budget] log skipped: ${e.message}\n`);
}
