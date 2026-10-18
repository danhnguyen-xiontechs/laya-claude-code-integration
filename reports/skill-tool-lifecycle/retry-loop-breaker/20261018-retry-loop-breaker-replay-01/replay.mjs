// Offline replay of retry-loop-breaker over real agent transcripts.
// For each subagent transcript, walks its tool calls in order and runs the guard's own decision code
// (decideBefore / recordAfter / classify / bashMayMutate of the given version), the way register.ts wires them:
// Edit/Write/NotebookEdit success and mutating non-eligible Bash bump the epoch; eligible Bash is decided before
// and recorded after. Counts eligible calls, would-block points and the identical calls that a block would have saved.
// Usage: node replay.mjs <outJson>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const PROJ = path.join(os.homedir(), '.claude', 'projects');
const RETRY_DIRS = { r1: 'lucid-dijkstra-a18bb4', r2: 'lucid-bell-e1bc21', r3: 'interesting-shirley-cbbaeb' };
const versions = {};
for (const v of ['orig', 'r2', 'r3']) versions[v] = await import(pathToFileURL(path.join(HERE, v, 'core.ts')).href);

// all subagent transcripts of this project's worktree sessions (and this session)
const files = [];
for (const d of fs.readdirSync(PROJ).filter((d) => d.startsWith('D--XionTechs-Laya'))) {
  const base = path.join(PROJ, d);
  for (const s of fs.readdirSync(base)) {
    const sub = path.join(base, s, 'subagents');
    if (!fs.existsSync(sub)) continue;
    const group = Object.entries(RETRY_DIRS).find(([, w]) => d.endsWith(w))?.[0] ?? 'other';
    for (const f of fs.readdirSync(sub).filter((f) => f.endsWith('.jsonl'))) files.push({ file: path.join(sub, f), group });
  }
}

function calls(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const results = new Map();
  for (const e of lines) if (e.type === 'user' && Array.isArray(e.message?.content))
    for (const b of e.message.content) if (b?.type === 'tool_result') {
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? '').join('') : '';
      results.set(b.tool_use_id, { isError: b.is_error === true, text });
    }
  const out = [];
  let model = null;
  for (const e of lines) if (e.type === 'assistant') {
    model ??= e.message?.model ?? null;
    for (const c of e.message?.content ?? []) if (c.type === 'tool_use') out.push({ name: c.name, input: c.input ?? {}, ts: Date.parse(e.timestamp ?? '') || 0, res: results.get(c.id) });
  }
  return { model, out };
}

function outcome(core, command, res) {
  if (!res) return { kind: 'ignored', reason: 'no_result' };
  const text = res.text;
  if (core.exitHiddenByPipe?.(command)) return { kind: 'ignored', reason: 'pipe' };
  if (core.hasEchoExit?.(command)) {
    const ec = core.echoedExit(command, text);
    if (ec === null) return { kind: 'ignored', reason: 'no_echoed_exit' };
    return ec === 0 ? { kind: 'passed' } : { kind: 'failed', text };
  }
  if (res.isError) return { kind: 'failed', text };
  return { kind: 'passed' };
}

function replay(core, seq) {
  const o = { ...core.DEFAULTS, mode: 'enforce', jevEnabled: false };
  let s = core.emptyState();
  const ws = 'w';
  let bash = 0, eligible = 0, wouldBlock = 0, saved = 0, blockedKey = null;
  for (const c of seq) {
    if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(c.name)) { if (c.res && !c.res.isError) s = { ...s, epoch: s.epoch + 1 }; blockedKey = null; continue; }
    if (c.name !== 'Bash' || typeof c.input.command !== 'string') continue;
    bash++;
    // the retry-loop harness ran the task's command through its wrapper: node [<path>/]run.mjs <cmd>; unwrap it so the replay sees what the agent asked to run
    const cmd = process.env.UNWRAP ? c.input.command.replace(/node\s+(?:"[^"]*run\.mjs"|\S*run\.mjs)\s+/g, '') : c.input.command;
    const cat = core.classify(cmd, '');
    if (!cat) { if (core.bashMayMutate(cmd, false)) { s = { ...s, epoch: s.epoch + 1 }; blockedKey = null; } continue; }
    eligible++;
    const now = c.ts || Date.now();
    const d = core.decideBefore(core.prune(s, now, o), ws, cmd, now, o);
    if (d.kind === 'block') {
      // the first refusal is the intervention; later identical calls at the same epoch are what it would have saved
      if (blockedKey === cmd) saved++; else { wouldBlock++; blockedKey = cmd; }
    }
    s = core.recordAfter(core.prune(s, now, o), ws, cmd, cat, outcome(core, cmd, c.res), now, o);
  }
  return { bash, eligible, wouldBlock, saved };
}

const rows = [];
for (const { file, group } of files) {
  const { model, out } = calls(file);
  if (!out.some((c) => c.name === 'Bash')) continue;
  const r = { file: path.basename(file), group, model };
  for (const [v, core] of Object.entries(versions)) r[v] = replay(core, out);
  rows.push(r);
}
const agg = {};
for (const r of rows) for (const v of Object.keys(versions)) {
  const k = `${r.group}|${v}`;
  agg[k] ??= { agents: 0, bash: 0, eligible: 0, wouldBlock: 0, saved: 0, agentsWithBlock: 0 };
  const a = agg[k], x = r[v];
  a.agents++; a.bash += x.bash; a.eligible += x.eligible; a.wouldBlock += x.wouldBlock; a.saved += x.saved; a.agentsWithBlock += x.wouldBlock ? 1 : 0;
}
fs.writeFileSync(process.argv[2] ?? path.join(HERE, 'replay-result.json'), JSON.stringify({ agg, rows }, null, 2));
console.log('group|version'.padEnd(14), 'agents bash eligible wouldBlock savedCalls agentsWithBlock');
for (const [k, a] of Object.entries(agg).sort()) console.log(k.padEnd(14), String(a.agents).padStart(6), String(a.bash).padStart(5), String(a.eligible).padStart(8), String(a.wouldBlock).padStart(10), String(a.saved).padStart(10), String(a.agentsWithBlock).padStart(15));
