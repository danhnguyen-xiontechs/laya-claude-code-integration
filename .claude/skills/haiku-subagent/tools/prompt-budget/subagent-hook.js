#!/usr/bin/env node
// Claude Code PreToolUse hook (matcher "Agent|Task"): shrinks a subagent's prompt to < 90k tokens
// before it is spawned. Passthrough (no change) when already under budget. Every call is logged
// (see log.js / report.js). Registered in .claude/settings.json — nothing to run by hand.
import { optimize } from './optimize.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { logEvent, logPath } from './log.js';

// Testing aid: a lower limit than 90k, from env PROMPT_BUDGET_LIMIT or the file
// .claude/prompt-budget/limit.txt (read on every call, so no settings reload needed). Delete it afterwards.
function testLimit() {
  try {
    const n = Number(process.env.PROMPT_BUDGET_LIMIT || readFileSync(join(dirname(logPath()), 'limit.txt'), 'utf8').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0; // no override file -> default 90k
  }
}

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

try {
  const event = JSON.parse(raw);
  const input = event.tool_input ?? {};
  if (typeof input.prompt === 'string') {
    const r = await optimize(
      { messages: [{ role: 'user', content: input.prompt }] },
      { trim: true, summarize: false, ...(testLimit() && { limit: testLimit() }), apiKey: process.env.PROMPT_BUDGET_EXACT ? process.env.ANTHROPIC_API_KEY : '' },
    );
    const compacted = r.status === 'optimized';
    let text = input.prompt;
    if (compacted) {
      const p = r.payload.messages[0].content;
      text = typeof p === 'string' ? p : p.map((b) => b.text).join('\n');
    }
    logEvent(
      {
        type: 'pre',
        tool_use_id: event.tool_use_id,
        model: input.model,
        description: input.description,
        orig_tokens: r.original_tokens,
        final_tokens: r.final_tokens,
        compacted,
        orig_chars: input.prompt.length,
        final_chars: text.length,
      },
      event.cwd,
    );
    if (compacted) {
      process.stderr.write(`[prompt-budget] subagent prompt ${r.original_tokens} -> ${r.final_tokens} tokens\n`);
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: { ...input, prompt: text },
          },
        }),
      );
    }
  }
} catch (e) {
  process.stderr.write(`[prompt-budget] skipped: ${e.message}\n`); // never block the subagent
}
