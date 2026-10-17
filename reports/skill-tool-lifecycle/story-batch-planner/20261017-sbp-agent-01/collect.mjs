#!/usr/bin/env node
// collect.mjs — after the case agents finished: finds each work folder's subagent transcript, saves the real
// token usage (subagent_usage.mjs, unchanged), the first planner-relevant tool output each agent saw (evidence/texts),
// the agent's final answer text (evidence/answers), and copies the planner decision logs (evidence/_logs).
//
// Usage: node collect.mjs <subagentsDir>
//   subagentsDir = C:\Users\ADMIN\.claude\projects\D--XionTechs-Laya--claude-worktrees-skill-build-workflow-review-af9324\82e30143-e152-4ee9-b306-ffbd1654c94d\subagents
// Writes (in this experiment folder): evidence/subagent-usage.json, evidence/run-index.json,
//   evidence/texts/<case>.<A|B>.txt, evidence/answers/<case>.<A|B>.txt, evidence/_logs/*
// A work folder with no transcript, or two, is recorded as null: never guessed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXP = import.meta.dirname;
const SCRATCH = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\claude\\D--XionTechs-Laya--claude-worktrees-skill-build-workflow-review-af9324\\82e30143-e152-4ee9-b306-ffbd1654c94d\\scratchpad\\sbp';
const USAGE_SCRIPT = path.join('D:\\XionTechs\\Laya', '.claude', 'skills', 'build-skill-tool-workflow', 'scripts', 'subagent_usage.mjs');
const CASES = ['03-api-dto', '04-migration', '06-explicit', '07-cycle'];
const ARMS = ['A', 'B'];

const subDir = process.argv[2];
if (!subDir) { console.error('Usage: node collect.mjs <subagentsDir>'); process.exit(2); }
// run 2 re-ran arm A in <case>.A2 folders (SBP_A_SUFFIX=A2); the saved keys stay <case>.A / <case>.B
const A_SUF = process.env.SBP_A_SUFFIX ?? 'A';
const folder = (c, a) => path.join(SCRATCH, 'work', `${c}.${a === 'A' ? A_SUF : a}`);
const dirs = CASES.flatMap((c) => ARMS.map((a) => folder(c, a)));

// 1. real usage per work folder (unchanged script)
const r = spawnSync(process.execPath, [USAGE_SCRIPT, subDir, ...dirs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const usage = JSON.parse(r.stdout);
// the saved copy keeps no machine paths: the home folder and scratch folder are replaced by placeholders
const scrub = (s) => s.replace(/C:\\\\Users\\\\ADMIN/g, '<home>').replace(/C:\/Users\/ADMIN/g, '<home>');
fs.mkdirSync(path.join(EXP, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(EXP, 'evidence', 'subagent-usage.json'), scrub(JSON.stringify(usage, null, 2)));

// 2. transcript reading: first planner-relevant tool result (texts), final assistant text (answers), timing, model
const parseLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : '');
const RESULT_RX = { A: /"stories"/, B: /Story batch plan|planner disabled|planner failed/ };

const index = {};
for (const c of CASES) for (const a of ARMS) {
  const dir = folder(c, a);
  const u = usage[dir];
  const key = `${c}.${a}`;
  if (!u?.transcript) { index[key] = { transcript: null, error: u?.error ?? 'no entry' }; continue; }
  const lines = parseLines(u.transcript);
  const stamps = lines.map((e) => Date.parse(e.timestamp ?? '')).filter((t) => !Number.isNaN(t));
  let firstOutput = null;
  for (const e of lines) {
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message.content) {
      if (block?.type !== 'tool_result') continue;
      const t = textOf(block.content);
      if (!firstOutput && RESULT_RX[a].test(t)) firstOutput = t;
    }
    if (firstOutput) break;
  }
  let finalText = null;
  for (const e of lines) {
    if (e.type !== 'assistant') continue;
    const t = (e.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
    if (t) finalText = t;
  }
  const model = lines.find((e) => e.type === 'assistant' && e.message?.model)?.message.model ?? null;
  if (firstOutput != null) {
    fs.mkdirSync(path.join(EXP, 'evidence', 'texts'), { recursive: true });
    fs.writeFileSync(path.join(EXP, 'evidence', 'texts', `${key}.txt`), firstOutput);
  }
  if (finalText != null) {
    fs.mkdirSync(path.join(EXP, 'evidence', 'answers'), { recursive: true });
    fs.writeFileSync(path.join(EXP, 'evidence', 'answers', `${key}.txt`), finalText);
  }
  index[key] = {
    transcript: path.basename(u.transcript),
    model,
    startedAt: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
    finishedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    usage: u.usage ?? null,
    firstOutputFound: firstOutput != null,
    finalAnswerFound: finalText != null,
  };
}
fs.writeFileSync(path.join(EXP, 'evidence', 'run-index.json'), JSON.stringify(index, null, 2));

// 3. planner decision logs (arm B only), copied as they are; they hold pair ids, labels and latency, no key
const logsSrc = path.join(SCRATCH, '_logs');
const logsDst = path.join(EXP, 'evidence', '_logs');
fs.mkdirSync(logsDst, { recursive: true });
for (const f of fs.existsSync(logsSrc) ? fs.readdirSync(logsSrc) : []) fs.copyFileSync(path.join(logsSrc, f), path.join(logsDst, f));

for (const [k, v] of Object.entries(index)) console.log(`${k}: transcript=${v.transcript ?? 'null'} model=${v.model ?? '-'} tokens=${v.usage ? v.usage.inputTokens + v.usage.outputTokens + v.usage.cacheReadTokens + v.usage.cacheWriteTokens : 'null'} firstOutput=${v.firstOutputFound ?? '-'} answer=${v.finalAnswerFound ?? '-'}`);
