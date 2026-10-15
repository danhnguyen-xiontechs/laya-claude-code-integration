// preview.ts — what fast-compact would do to the current session, and the switch that arms it.
//
//   node scripts/preview.ts [--session <transcript.jsonl>] [--cwd <dir>] [--arm] [--disarm] [--json]
//
// Reads the session transcript (newest *.jsonl of the project unless --session),
// takes the part after the last compaction, runs the hook's own rules over it and
// prints the expected reduction and what would be cut. --arm writes
// ~/.claude/fast-compact/arm.json so the next manual /compact (within 15 min) uses
// the rules; --disarm removes the switch. Node >= 22.18 (type stripping), no deps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionMessage, ToolUseSummary } from 'claude-code';
import { ARM_TTL_MS, DEFAULTS, planCompaction, summarize } from '../hooks/fast-compact.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const armDir = path.join(os.homedir(), '.claude', 'fast-compact');
const armPath = path.join(armDir, 'arm.json');

if (flag('--disarm')) {
  fs.rmSync(armPath, { force: true });
  console.log('fast-compact: disarmed');
  process.exit(0);
}

const cwd = path.resolve(value('--cwd') ?? process.cwd());
const slug = cwd.replace(/[:\\/.]/g, '-');
const projectDir = path.join(os.homedir(), '.claude', 'projects', slug);

function newestTranscript(): string {
  const files = fs.existsSync(projectDir)
    ? fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(projectDir, f))
    : [];
  if (files.length === 0) throw new Error(`no transcript found in ${projectDir}; pass --session <file.jsonl>`);
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]!;
}

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };

/** Transcript lines → SessionMessage-shaped entries, from the last compaction on. */
export function loadTranscript(file: string): SessionMessage[] {
  let out: SessionMessage[] = [];
  let lastAssistantId: string | undefined;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'system' && e.subtype === 'compact_boundary') { out = []; lastAssistantId = undefined; continue; }
    if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || e.isMeta) continue;
    const content = e.message?.content;
    const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const role: 'user' | 'assistant' = e.message?.role === 'assistant' ? 'assistant' : 'user';
    const prev = out[out.length - 1];
    // Streamed assistant blocks of one API message share message.id: one message.
    const m: SessionMessage = role === 'assistant' && prev?.role === 'assistant' && e.message?.id && e.message.id === lastAssistantId
      ? prev
      : { role, text: '', toolUses: [] };
    if (m !== prev) out.push(m);
    if (role === 'assistant') lastAssistantId = e.message?.id;
    for (const b of blocks) {
      if (b.type === 'text' && b.text) m.text += (m.text ? '\n' : '') + b.text;
      else if (b.type === 'tool_use' && b.id && b.name) m.toolUses.push({ tool_use_id: b.id, tool: b.name, input: b.input ?? {} } as ToolUseSummary);
      else if (b.type === 'tool_result' && b.tool_use_id) {
        const c = b.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => (x?.type === 'text' ? x.text : `[${x?.type}]`)).join('\n') : '';
        (m.toolResults ??= []).push({ tool_use_id: b.tool_use_id, text, isError: !!b.is_error });
      }
    }
  }
  return out.filter((m) => m.text || m.toolUses.length || m.toolResults?.length);
}

const file = value('--session') ?? newestTranscript();
const messages = loadTranscript(file);
const plan = planCompaction(messages, DEFAULTS);
const fallback = plan.stats.reduction < DEFAULTS.minReductionRatio;

if (flag('--json')) {
  console.log(JSON.stringify({ file, stats: plan.stats, fallback, decisions: plan.decisions }, null, 1));
} else {
  const byTool = new Map<string, Record<string, number>>();
  for (const d of plan.decisions) {
    const row = byTool.get(d.tool) ?? {};
    row[d.result] = (row[d.result] ?? 0) + 1;
    if (d.input === 'trimmed') row['input trimmed'] = (row['input trimmed'] ?? 0) + 1;
    byTool.set(d.tool, row);
  }
  console.log(`transcript: ${file}`);
  console.log(`estimate:   ${summarize(plan.stats)}`);
  console.log(fallback
    ? `outcome:    below the ${DEFAULTS.minReductionRatio * 100}% minimum, /compact would fall back to the built-in summary`
    : 'outcome:    /compact would keep the conversation verbatim, without a summary');
  console.log('per tool:');
  for (const [tool, row] of [...byTool].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${tool.padEnd(28)} ${Object.entries(row).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  console.log(`hooks on:   ${process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === '1' ? 'yes' : 'NO (CLAUDE_CODE_ENABLE_FUNCTION_HOOKS is not 1 here; the hook will not load)'}`);
}

if (flag('--arm')) {
  fs.mkdirSync(armDir, { recursive: true });
  fs.writeFileSync(armPath, JSON.stringify({ armedAt: Date.now(), cwd }));
  console.log(`armed:      the next manual /compact within ${ARM_TTL_MS / 60_000} min uses fast-compact (once)`);
}
