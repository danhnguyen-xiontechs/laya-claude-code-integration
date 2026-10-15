#!/usr/bin/env node
// mine-history.mjs — labelled routing cases from Claude Code transcripts.
//
//   node mine-history.mjs [--projects ~/.claude/projects] [--out ~/.skills-router/eval/cases.jsonl]
//                         [--include-sdk] [--max-chars 1500] [--min-words 3]
//
// A case pairs a user prompt with what it led to:
//   - a typed slash command `/x args`  → { query: args, expected: "x", via: "slash" }
//   - a plain prompt whose assistant turn (up to the next prompt) called the Skill tool
//                                      → { query: prompt, expected: <skill>, via: "skill-tool" }
//   - a plain prompt that invoked none  → { query: prompt, expected: null, via: "prompt" }
// Built-in commands (/model, /clear, ...) are dropped, as are prompts from other sessions or the SDK
// (turnOrigin "sdk") unless --include-sdk, task notifications and system-injected messages.
// Prompts are private: the default output is outside any repo, in ~/.skills-router/eval/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_DIR } from './catalog.mjs';
import { parseArgs } from './decision-provider.mjs';

export const DEFAULT_OUT = path.join(STATE_DIR, 'eval', 'cases.jsonl');

export const BUILTIN_COMMANDS = new Set(('add-dir agents bug clear compact config context cost doctor exit export feedback help hooks ide init '
  + 'install-github-app login logout mcp memory model output-style permissions plugin plugins pr-comments privacy-settings release-notes '
  + 'reload-plugins resume review rewind sandbox security-review status statusline terminal-setup todos upgrade usage vim fast effort '
  + 'theme btw copy branch tasks agents-list loop remote-control desktop mobile extra-usage stats').split(' '));

/** Plain text of a user message ('' for tool results and non-text content). */
export function userText(rec) {
  const c = rec?.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.some((b) => b?.type === 'tool_result')) return '';
  return c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
}

/**
 * What a user record is: { kind: 'slash', command, args } | { kind: 'prompt', text } |
 * { kind: 'break' } (system-injected, interrupted, other session: closes the open prompt) | null
 * (not a prompt at all: tool results, meta).
 */
export function classifyUser(rec, { includeSdk = false } = {}) {
  if (rec?.type !== 'user' || rec.isSidechain) return null;
  if (rec.isMeta) return null;
  const text = userText(rec);
  if (!text.trim()) return null;
  const cmd = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(text);
  if (cmd) {
    const args = (/<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] || '').trim();
    return { kind: 'slash', command: cmd[1], args };
  }
  const origin = rec.turnOrigin;
  if (rec.promptSource === 'system' || origin === 'task_notification' || (origin === 'sdk' && !includeSdk)) return { kind: 'break' };
  const t = text.trim();
  if (t.startsWith('<') || t.startsWith('[Request interrupted') || t.startsWith('Caveat:')) return { kind: 'break' };
  return { kind: 'prompt', text: t };
}

/** Skill invoked by an assistant record (Skill or legacy SlashCommand tool), or null. */
export function invokedSkill(rec) {
  if (rec?.type !== 'assistant' || rec.isSidechain) return null;
  for (const b of rec.message?.content || []) {
    if (b?.type !== 'tool_use') continue;
    if (b.name === 'Skill' && typeof b.input?.skill === 'string') return b.input.skill.replace(/^\//, '');
    if (b.name === 'SlashCommand' && typeof b.input?.command === 'string') return b.input.command.replace(/^\//, '').split(/\s/)[0];
  }
  return null;
}

/** Cases from one transcript's records (already parsed), in order. */
export function casesFromRecords(records, opts = {}) {
  const { maxChars = 1500, minWords = 3 } = opts;
  const out = [];
  const drop = { builtin: 0, shortArgs: 0, long: 0 };
  let open = null;
  const close = () => { if (open) out.push(open); open = null; };
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  for (const rec of records) {
    const u = classifyUser(rec, opts);
    if (u) {
      close();
      const base = { session: rec.sessionId || null, cwd: rec.cwd || null, ts: rec.timestamp || null };
      if (u.kind === 'slash') {
        const name = u.command.toLowerCase();
        if (BUILTIN_COMMANDS.has(name)) { drop.builtin++; continue; }
        if (words(u.args) < minWords) { drop.shortArgs++; continue; }
        if (u.args.length > maxChars) { drop.long++; continue; }
        out.push({ ...base, query: u.args, expected: u.command, via: 'slash' });
      } else if (u.kind === 'prompt') {
        if (u.text.length > maxChars) { drop.long++; continue; }
        if (words(u.text) < 1) continue;
        open = { ...base, query: u.text, expected: null, via: 'prompt' };
      }
      continue;
    }
    const s = open && invokedSkill(rec);
    if (s) { open.expected = s; open.via = 'skill-tool'; close(); }
  }
  close();
  return { cases: out, drop };
}

/** Parses a JSONL file, skipping bad lines. */
export function readJsonl(file) {
  const out = [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const l of text.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch { /* skip */ } }
  return out;
}

/** Top-level session transcripts under the projects folder (subagent transcripts skipped). */
export function transcriptFiles(projectsDir) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    const dd = path.join(projectsDir, d.name);
    try { for (const f of fs.readdirSync(dd)) if (f.endsWith('.jsonl')) out.push(path.join(dd, f)); } catch { /* skip */ }
  }
  return out;
}

/** Mines every transcript; dedupes on (query, expected). */
export function mine({ projectsDir = path.join(os.homedir(), '.claude', 'projects'), ...opts } = {}) {
  const seen = new Set();
  const cases = [];
  const drop = { builtin: 0, shortArgs: 0, long: 0, duplicate: 0 };
  for (const f of transcriptFiles(projectsDir)) {
    const r = casesFromRecords(readJsonl(f), opts);
    for (const k of Object.keys(r.drop)) drop[k] += r.drop[k];
    for (const c of r.cases) {
      const key = `${c.query.replace(/\s+/g, ' ').trim().toLowerCase()}\u0000${c.expected}`;
      if (seen.has(key)) { drop.duplicate++; continue; }
      seen.add(key);
      cases.push(c);
    }
  }
  return { cases, drop };
}

function main(argv) {
  const a = parseArgs(argv);
  const out = typeof a.out === 'string' ? a.out : DEFAULT_OUT;
  const { cases, drop } = mine({
    projectsDir: typeof a.projects === 'string' ? a.projects : undefined,
    includeSdk: Boolean(a['include-sdk']),
    maxChars: Number(a['max-chars']) || 1500,
    minWords: a['min-words'] !== undefined ? Number(a['min-words']) : 3,
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, cases.map((c) => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : ''));
  const labels = {};
  for (const c of cases) labels[c.expected ?? '(none)'] = (labels[c.expected ?? '(none)'] || 0) + 1;
  const via = {};
  for (const c of cases) via[c.via] = (via[c.via] || 0) + 1;
  console.log(JSON.stringify({ out, cases: cases.length, via, dropped: drop, labels }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
