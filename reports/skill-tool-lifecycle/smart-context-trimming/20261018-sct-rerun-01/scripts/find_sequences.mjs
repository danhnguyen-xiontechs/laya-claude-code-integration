// Finds retry sequences in recorded Claude Code transcripts (main sessions and subagents): the same test/build
// command run again in one session, with the output of each run. A sequence is "trimmable" when every run is big
// enough for smart-context-trimming to act on (>=250 lines or >=20 KB), which is what the content run needs.
// Prints (or writes with --out <file>) a JSON list: transcript, command, category, lines/bytes per run, line overlap
// of consecutive runs (same normalisation as the retry-loop replay's repeats.mjs), tool_use ids.
// Usage: node scripts/find_sequences.mjs [--out <file.json>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const core = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../../../../smart-context-trimming/hooks/trim-core.ts')).href);
const PROJ = path.join(os.homedir(), '.claude', 'projects');
const unwrap = (c) => c.replace(/node\s+(?:"[^"]*run\.mjs"|\S*run\.mjs)\s+/g, '');
const norm = (l) => l.replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '#').replace(/\b\d{2}:\d{2}:\d{2}\b/g, '#').trim();
const outArg = process.argv.indexOf('--out');

const files = [];
for (const d of fs.readdirSync(PROJ).filter((d) => d.startsWith('D--XionTechs-Laya'))) {
  for (const f of fs.readdirSync(path.join(PROJ, d))) {
    const full = path.join(PROJ, d, f);
    if (f.endsWith('.jsonl')) files.push({ rel: `${d}/${f}`, full });
    else if (fs.existsSync(path.join(full, 'subagents'))) {
      for (const g of fs.readdirSync(path.join(full, 'subagents'))) if (g.endsWith('.jsonl')) files.push({ rel: `${d}/${f}/subagents/${g}`, full: path.join(full, 'subagents', g) });
    }
  }
}

const sequences = [];
for (const { rel, full } of files) {
  const lines = fs.readFileSync(full, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const res = new Map();
  for (const e of lines) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const b of e.message.content) if (b?.type === 'tool_result')
    res.set(b.tool_use_id, typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x?.text ?? '').join(''));
  const groups = new Map();
  for (const e of lines) if (e.type === 'assistant') for (const c of e.message?.content ?? []) {
    if (c.type !== 'tool_use' || c.name !== 'Bash') continue;
    const cmd = unwrap(c.input?.command ?? '');
    if (!core.classify(cmd)) continue;
    const out = res.get(c.id);
    if (out === undefined) continue;
    // a leading "cd <dir> &&" differs between runs in the same session only by its path style; drop it for the key
    const key = cmd.trim().replace(/^cd\s+("[^"]*"|\S+)\s*(&&|;)\s*/, '').replace(/\s+/g, ' ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: c.id, cmd, out });
  }
  for (const [key, runs] of groups) {
    if (runs.length < 2) continue;
    const overlap = [];
    for (let i = 1; i < runs.length; i++) {
      const a = new Set(runs[i - 1].out.split('\n').map(norm).filter(Boolean));
      const b = runs[i].out.split('\n').map(norm).filter(Boolean);
      overlap.push(b.length ? +(b.filter((l) => a.has(l)).length / b.length).toFixed(3) : 1);
    }
    sequences.push({
      transcript: rel, command: key.slice(0, 160), category: core.classify(runs[0].cmd),
      trimmable: runs.every((r) => r.out.split('\n').length >= 250 || Buffer.byteLength(r.out) >= 20000),
      runs: runs.length, lines: runs.map((r) => r.out.split('\n').length), bytes: runs.map((r) => Buffer.byteLength(r.out)),
      overlapWithPrevious: overlap, ids: runs.map((r) => r.id),
    });
  }
}
const json = JSON.stringify(sequences, null, 2);
if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], json); else console.log(json);
