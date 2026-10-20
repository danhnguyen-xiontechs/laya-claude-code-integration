#!/usr/bin/env node
// hook-pretooluse.mjs — PreToolUse hook (matcher "Agent") that sets the subagent's `model`.
//
// Reads the hook JSON on stdin. Acts only when ALL of these hold:
//   - tool_name is Agent (or the old name Task);
//   - the caller did not pass `model` (an explicit model is never overridden);
//   - the subagent definition (.claude/agents/<type>.md, project or user) has no `model` field
//     (a per-call model would override the definition's frontmatter, so we leave it alone);
//   - mode is apply and the router returned a tier.
// Then it prints { hookSpecificOutput: { permissionDecision: "allow", updatedInput: <full input + model> } }.
// updatedInput REPLACES the input (docs), so every original field is copied. In every other case it
// prints nothing and exits 0, so Claude Code proceeds exactly as without the hook.
// Never blocks: any error → exit 0 without output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, route } from './router.mjs';

const AGENT_TOOLS = new Set(['Agent', 'Task']);

/** The `model` field of a subagent definition's frontmatter, or null. */
export function definitionModel(type, cwd, home = os.homedir()) {
  if (!type) return null;
  const safe = String(type).replace(/[^\w.-]/g, '');
  for (const dir of [path.join(cwd || '.', '.claude', 'agents'), path.join(home, '.claude', 'agents')]) {
    let text;
    try { text = fs.readFileSync(path.join(dir, `${safe}.md`), 'utf8'); } catch { continue; }
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const m = fm?.[1].match(/^model:\s*["']?([^"'\r\n#]+?)["']?\s*$/m);
    return m ? m[1].trim() : null;
  }
  return null;
}

export async function handle(input, { cfg = loadConfig({ defaultPolicy: 'gate+sc' }), decideImpl, env = process.env, home } = {}) {
  if (!input || !AGENT_TOOLS.has(input.tool_name)) return null;
  const ti = input.tool_input || {};
  const base = { source: 'hook', tool_use_id: input.tool_use_id ?? null };
  const session = input.session_id ?? 'hook'; // the spend cap is kept per session id
  if (cfg.mode === 'off') return null;
  if (ti.model) { // explicit model: log in shadow for the history, never override
    await route({ task: ti.prompt ?? '', type: ti.subagent_type ?? '', cfg: { ...cfg, provider: 'none', policy: 'rules' }, decideImpl, env, session, extra: { ...base, skipped: 'caller-model', callerModel: ti.model } });
    return null;
  }
  const defModel = definitionModel(ti.subagent_type, input.cwd, home);
  if (defModel && defModel !== 'inherit') {
    await route({ task: ti.prompt ?? '', type: ti.subagent_type ?? '', cfg: { ...cfg, provider: 'none', policy: 'rules' }, decideImpl, env, session, extra: { ...base, skipped: 'definition-model', definitionModel: defModel } });
    return null;
  }
  const rec = await route({ task: ti.prompt ?? '', type: ti.subagent_type ?? '', cfg, decideImpl, env, session, extra: base });
  if (cfg.mode !== 'apply' || !rec.tier) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `subagent-model-router: ${rec.tier} (${rec.policy}; rule ${rec.rule.tier}${rec.consistency ? `, votes ${JSON.stringify(rec.consistency.votes)}` : ''})`,
      updatedInput: { ...ti, model: rec.tier },
    },
  };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const out = await handle(JSON.parse(raw || '{}'));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch { /* never block the spawn */ }
  process.exit(0);
}

if (process.argv[1]?.endsWith('hook-pretooluse.mjs')) main();
