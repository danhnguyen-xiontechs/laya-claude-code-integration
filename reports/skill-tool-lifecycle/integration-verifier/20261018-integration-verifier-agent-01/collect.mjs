#!/usr/bin/env node
// collect.mjs — after the case agents finished: real token usage per work folder (subagent_usage.mjs, unchanged,
// with --forbid on arm A), each agent's hand-back answer, the first output it saw, the verifier decision logs.
//
// Usage: node collect.mjs <subagentsDir> <SCRATCH> [aliases.json]
//   aliases.json maps a saved key to the work folder name actually used, e.g. {"c2.A.r1": "c2.A2.r1"} (re-run after contamination)
// Writes: evidence/subagent-usage.json, evidence/forbidden.json, evidence/run-index.json,
//   evidence/answers/<case>.<A|B>.r<n>.txt, evidence/texts/<case>.<A|B>.r<n>.txt, evidence/_logs/*
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXP = import.meta.dirname;
const [subDir, SCRATCH, aliasFile] = process.argv.slice(2);
if (!subDir || !SCRATCH) { console.error('Usage: node collect.mjs <subagentsDir> <SCRATCH> [aliases.json]'); process.exit(2); }
const USAGE = path.resolve(EXP, '..', '..', '..', '..', '.claude', 'skills', 'build-skill-tool-workflow', 'scripts', 'subagent_usage.mjs');
const CASES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], ARMS = ['A', 'B'], REPS = [1, 2];
const alias = aliasFile ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : {};
const keyOf = (c, a, r) => `${c}.${a}.r${r}`;
const folder = (k) => path.join(SCRATCH, 'work', alias[k] ?? k);
const keys = CASES.flatMap((c) => ARMS.flatMap((a) => REPS.map((r) => keyOf(c, a, r))));
const scrub = (s) => s.replaceAll(SCRATCH, '<scratch>').replaceAll(SCRATCH.replace(/\\/g, '/'), '<scratch>').replace(/C:\\\\?Users\\\\?[^\\"/]+/g, '<home>').replace(/C:\/Users\/[^\\"/]+/g, '<home>');

const run = (extra, list) => JSON.parse(spawnSync(process.execPath, [USAGE, subDir, ...extra, ...list], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
const usage = run([], keys.map(folder));
const aKeys = keys.filter((k) => k.split('.')[1] === 'A');
const forb = run(['--forbid', 'integration-verifier|verify\\.mjs|decision-provider|gold\\.json|_logs|_verifier-out|\\.B\\.r\\d|-private'], aKeys.map(folder));
fs.mkdirSync(path.join(EXP, 'evidence', 'answers'), { recursive: true });
fs.mkdirSync(path.join(EXP, 'evidence', 'texts'), { recursive: true });
fs.writeFileSync(path.join(EXP, 'evidence', 'subagent-usage.json'), scrub(JSON.stringify(usage, null, 2)));
fs.writeFileSync(path.join(EXP, 'evidence', 'forbidden.json'), scrub(JSON.stringify(Object.fromEntries(aKeys.map((k) => [k, { forbiddenCalls: forb[folder(k)]?.forbiddenCalls ?? null, workFolder: alias[k] ?? k }])), null, 2)));

const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : '');
const index = {};
for (const k of keys) {
  const u = usage[folder(k)];
  const arm = k.split('.')[1];
  if (!u?.transcript) { index[k] = { transcript: null, error: u?.error ?? 'no entry' }; continue; }
  const ev = lines(u.transcript);
  const stamps = ev.map((e) => Date.parse(e.timestamp ?? '')).filter((t) => !Number.isNaN(t));
  let answer = null, firstOut = null, firstOutKind = null, any = null, ranWrapper = false;
  const calls = {};
  for (const e of ev) {
    if (e.type === 'assistant') for (const c of e.message?.content ?? []) {
      if (c.type !== 'tool_use') continue;
      if (c.name === 'SubagentHandback' && typeof c.input?.message === 'string') answer = c.input.message;
      else { calls[c.name] = (calls[c.name] ?? 0) + 1; if (/verify-batch\.mjs/.test(JSON.stringify(c.input))) ranWrapper = true; }
    }
    if (e.type === 'user' && Array.isArray(e.message?.content)) for (const b of e.message.content) {
      if (b?.type !== 'tool_result') continue;
      const t = textOf(b.content);
      any ??= t;
      if (!firstOut && (arm === 'A' ? /verifier disabled/ : /Integration verification — /).test(t)) { firstOut = t; firstOutKind = 'wrapper output'; }
    }
  }
  if (!firstOut && any) { firstOut = any; firstOutKind = 'first tool result (wrapper never run)'; }
  const model = ev.find((e) => e.type === 'assistant' && e.message?.model)?.message.model ?? null;
  if (answer != null) fs.writeFileSync(path.join(EXP, 'evidence', 'answers', `${k}.txt`), scrub(answer));
  if (firstOut != null) fs.writeFileSync(path.join(EXP, 'evidence', 'texts', `${k}.txt`), scrub(firstOut));
  index[k] = { transcript: path.basename(u.transcript), model, workFolder: alias[k] ?? k,
    startedAt: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null, finishedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    usage: u.usage ?? null, toolCallsByName: calls, ranWrapper, firstOutputKind: firstOutKind, answerFound: answer != null };
}
fs.writeFileSync(path.join(EXP, 'evidence', 'run-index.json'), scrub(JSON.stringify(index, null, 2)));
const logs = path.join(EXP, 'evidence', '_logs');
fs.mkdirSync(logs, { recursive: true });
const src = path.join(process.env.IV_PRIVATE ?? SCRATCH + '-private', '_logs');
for (const f of fs.existsSync(src) ? fs.readdirSync(src) : []) fs.writeFileSync(path.join(logs, f), scrub(fs.readFileSync(path.join(src, f), 'utf8')));
for (const [k, v] of Object.entries(index)) {
  const u = v.usage;
  console.log(`${k}: ${v.transcript ? 'ok' : 'NO TRANSCRIPT'} model=${v.model ?? '-'} tokens=${u ? u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens : 'null'} turns=${u?.modelTurns ?? '-'} tools=${u?.toolCalls ?? '-'} wrapper=${v.ranWrapper ?? '-'} answer=${v.answerFound ?? '-'}${k.includes('.A.') ? ` forbidden=${forb[folder(k)]?.forbiddenCalls ?? 'null'}` : ''}`);
}
