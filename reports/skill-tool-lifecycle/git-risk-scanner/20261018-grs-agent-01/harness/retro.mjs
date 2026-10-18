#!/usr/bin/env node
// retro.mjs - shared harness for the retro measurement of the three JEV skills (acceptance-criteria-coverage,
// dead-code-finder, git-risk-scanner). One tool per call; the tool-specific parts are in tools/<slug>.mjs.
//
//   node retro.mjs make <slug> [--reps 1,2] [--a-suffix A2 --only case1,case2]   work folders + prompts
//   node retro.mjs collect <slug> <subagentsDir>                                 usage, answers, first outputs, models
//   node retro.mjs grade <slug>                                                  results.json per arm and repetition
//   node retro.mjs list <slug>                                                   the run keys and work folders
//
// Everything the agents work on lives under SCRATCH (outside the repo). Nothing here edits the JEV repo: its code is
// read from a copy (JEV_SRC) made from the working tree of D:\XionTechs\JEV\.claude\worktrees\review-5-plans-idea-folder-ce4d36.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { SCRATCH, WORK_ROOT, PY, JEV_SRC, USAGE_SCRIPT, FIXTURES, HERE, EXP_DIR, REPS, copyTree, scrub, readLines, textOf } from './common.mjs';

const WRAPPER_A = `#!/usr/bin/env node
// Neutral wrapper, arm A: the tool is not available to this arm.
console.log('tool disabled');
`;

/** run keys for a tool: case x arm x rep. In rep 2 B is listed first (launch order). A suffix other than 'A' (re-run) renames the A folder. */
export function runKeys(tool, { reps = REPS, aSuffix = 'A', only = null } = {}) {
  const out = [];
  for (const rep of reps) for (const c of tool.cases) {
    if (only && !only.includes(c.id)) continue;
    const arms = rep % 2 === 0 ? ['B', 'A'] : ['A', 'B'];
    for (const arm of arms) {
      const folder = `${c.id}.${arm === 'A' ? aSuffix : arm}.r${rep}`;
      out.push({ caseId: c.id, arm, rep, key: `${c.id}.${arm}.r${rep}`, folder, workDir: path.join(WORK_ROOT, tool.slug, folder) });
    }
  }
  return out;
}

export async function loadTool(slug) {
  const m = await import(pathToFileURL(path.join(HERE, 'tools', `${slug}.mjs`)).href);
  return m.default;
}

function make(tool, opts) {
  const logs = path.join(SCRATCH, 'logs', tool.slug);
  fs.mkdirSync(logs, { recursive: true });
  const promptDir = path.join(SCRATCH, 'prompts', tool.slug);
  fs.mkdirSync(promptDir, { recursive: true });
  const runs = runKeys(tool, opts).filter((r) => !opts.arm || r.arm === opts.arm);
  const map = [];
  for (const r of runs) {
    const c = tool.cases.find((x) => x.id === r.caseId);
    fs.rmSync(r.workDir, { recursive: true, force: true });
    fs.mkdirSync(r.workDir, { recursive: true });
    c.build(r.workDir);                                           // fixture copy, answer key never copied
    fs.writeFileSync(path.join(r.workDir, 'tool.mjs'), r.arm === 'A' ? WRAPPER_A : tool.wrapperB({ caseId: c.id, rep: r.rep, logs, workDir: r.workDir }));
    if (tool.afterBuild) tool.afterBuild(r.workDir);
    if (r.arm === 'B') fs.rmSync(path.join(logs, `${c.id}.B.r${r.rep}.jsonl`), { force: true });
    const prompt = tool.prompt(c, r.workDir, r.arm);
    fs.writeFileSync(path.join(promptDir, `${r.folder}.txt`), prompt);
    map.push({ ...r, promptFile: path.join(promptDir, `${r.folder}.txt`) });
  }
  if (opts.aSuffix && opts.aSuffix !== 'A') {   // a re-run of arm A in new folders: remember which folder holds each key
    const rf = path.join(EXP_DIR, 'evidence', 'rerun-map.json');
    const cur = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : {};
    for (const r of map.filter((x) => x.arm === 'A')) cur[r.key] = r.workDir;
    fs.mkdirSync(path.dirname(rf), { recursive: true });
    fs.writeFileSync(rf, JSON.stringify(cur, null, 2));
  }
  const mapFile = path.join(WORK_ROOT, tool.slug, `workmap${opts.aSuffix && opts.aSuffix !== 'A' ? '.' + opts.aSuffix : ''}.json`);
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
  console.log(`${map.length} work folders + prompts under ${path.join(WORK_ROOT, tool.slug)}`);
}

/** final assistant text, hand-back message, first matching tool result, model, timing for one transcript */
export function readTranscript(file, firstOutputRx) {
  const lines = readLines(file);
  const stamps = lines.map((e) => Date.parse(e.timestamp ?? '')).filter((t) => !Number.isNaN(t));
  let answer = null; let model = null; let first = null; let toolCalls = [];
  for (const e of lines) {
    if (e.type === 'assistant') {
      model ??= e.message?.model ?? null;
      for (const c of e.message?.content ?? []) {
        if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') answer = c.input.message;
        else if (c.type === 'tool_use') toolCalls.push({ name: c.name, input: JSON.stringify(c.input ?? {}).slice(0, 300) });
      }
    } else if (e.type === 'user' && Array.isArray(e.message?.content) && !first && firstOutputRx) {
      for (const b of e.message.content) {
        if (b?.type !== 'tool_result') continue;
        const t = textOf(b.content);
        if (firstOutputRx.test(t)) { first = t; break; }
      }
    }
  }
  return {
    answer, model, first, toolCalls,
    startedAt: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
    finishedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
  };
}

function collect(tool, subDir) {
  const runs = runKeys(tool);
  const idxFile = path.join(EXP_DIR, 'evidence', 'run-index.json');
  const index = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : {};
  const usageFile = path.join(EXP_DIR, 'evidence', 'subagent-usage.json');
  const prevUsage = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, 'utf8')) : {};
  // which folder holds each key: a re-run of A recorded in evidence/rerun-map.json overrides the default
  const rerunFile = path.join(EXP_DIR, 'evidence', 'rerun-map.json');
  const rerun = fs.existsSync(rerunFile) ? JSON.parse(fs.readFileSync(rerunFile, 'utf8')) : {};
  const todo = runs.map((r) => ({ ...r, workDir: rerun[r.key] ?? r.workDir }));
  const forbidRx = tool.forbid;
  const args = [USAGE_SCRIPT, subDir, ...todo.map((r) => r.workDir)];
  const u = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (u.status !== 0) { console.error(u.stderr); process.exit(1); }
  const usage = JSON.parse(u.stdout);
  const uf = spawnSync(process.execPath, [USAGE_SCRIPT, subDir, '--forbid', forbidRx, ...todo.map((r) => r.workDir)], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (uf.status !== 0) { console.error('forbid check failed: ' + uf.stderr); process.exit(1); }
  const forbid = JSON.parse(uf.stdout);
  fs.mkdirSync(path.join(EXP_DIR, 'evidence', 'answers'), { recursive: true });
  fs.mkdirSync(path.join(EXP_DIR, 'evidence', 'texts'), { recursive: true });
  for (const r of todo) {
    const un = usage[r.workDir];
    if (!un?.transcript) { index[r.key] = { transcript: null, error: un?.error ?? 'no entry' }; continue; }
    const t = readTranscript(un.transcript, r.arm === 'A' ? tool.firstOutputA : tool.firstOutputB);
    if (t.answer) fs.writeFileSync(path.join(EXP_DIR, 'evidence', 'answers', `${r.key}.txt`), scrub(t.answer.endsWith('\n') ? t.answer : t.answer + '\n'));
    // "the first output the agent saw": the first wrapper / tool output (B) or the first run of tests or listing (A)
    if (t.first) fs.writeFileSync(path.join(EXP_DIR, 'evidence', 'texts', `${r.key}.txt`), scrub(t.first.replaceAll(r.workDir, '<work>').replaceAll(r.workDir.replaceAll('\\', '/'), '<work>')));
    index[r.key] = {
      folder: path.basename(r.workDir), transcript: path.basename(un.transcript), model: t.model, startedAt: t.startedAt, finishedAt: t.finishedAt,
      usage: un.usage ?? null, forbiddenCalls: forbid[r.workDir]?.forbiddenCalls ?? null,
      answerFound: !!t.answer, firstOutputFound: !!t.first,
      toolCallNames: t.toolCalls.map((c) => c.name),
      wrapperRuns: t.toolCalls.filter((c) => /tool\.mjs/.test(c.input)).length,
    };
  }
  fs.mkdirSync(path.join(EXP_DIR, 'evidence'), { recursive: true });
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 2));
  fs.writeFileSync(usageFile, scrub(JSON.stringify({ ...prevUsage, ...usage }, null, 2)));
  // engine logs of arm B: pair ids / labels / latency only, no key
  const logsSrc = path.join(SCRATCH, 'logs', tool.slug);
  const logsDst = path.join(EXP_DIR, 'evidence', '_logs');
  fs.mkdirSync(logsDst, { recursive: true });
  for (const f of fs.existsSync(logsSrc) ? fs.readdirSync(logsSrc) : []) fs.writeFileSync(path.join(logsDst, f), scrub(fs.readFileSync(path.join(logsSrc, f), 'utf8')));
  for (const [k, v] of Object.entries(index)) {
    const tot = v.usage ? v.usage.inputTokens + v.usage.outputTokens + v.usage.cacheReadTokens + v.usage.cacheWriteTokens : null;
    console.log(`${k}: ${v.transcript ?? 'NO TRANSCRIPT'} ${v.model ?? '-'} tokens=${tot} turns=${v.usage?.modelTurns ?? '-'} tools=${v.usage?.toolCalls ?? '-'} forbidden=${v.forbiddenCalls ?? '-'} answer=${v.answerFound ?? '-'} firstOut=${v.firstOutputFound ?? '-'}`);
  }
}

async function grade(tool) {
  const index = JSON.parse(fs.readFileSync(path.join(EXP_DIR, 'evidence', 'run-index.json'), 'utf8'));
  const rerunFile = path.join(EXP_DIR, 'evidence', 'rerun-map.json');
  const rerun = fs.existsSync(rerunFile) ? JSON.parse(fs.readFileSync(rerunFile, 'utf8')) : {};
  const grades = {};
  const byArmRep = {};
  for (const r of runKeys(tool)) {
    const c = tool.cases.find((x) => x.id === r.caseId);
    const idx = index[r.key] ?? {};
    const workDir = rerun[r.key] ?? r.workDir;
    const ansFile = path.join(EXP_DIR, 'evidence', 'answers', `${r.key}.txt`);
    const text = fs.existsSync(ansFile) ? fs.readFileSync(ansFile, 'utf8') : null;
    const now = new Date().toISOString();
    let g;
    if (!idx.transcript) g = { status: 'blocked', observed: 'no subagent transcript found for this work folder', criteria: [], errors: ['no transcript'] };
    else g = await tool.grade(c, { workDir, answer: text, arm: r.arm, rep: r.rep, idx });
    grades[r.key] = { ...g, model: idx.model ?? null, forbiddenCalls: idx.forbiddenCalls ?? null };
    const u = idx.usage;
    const log = r.arm === 'B' ? tool.engineStats(c.id, r.rep, path.join(EXP_DIR, 'evidence', '_logs')) : null;
    const res = {
      experimentId: tool.expId, caseId: r.caseId, arm: r.arm, runId: `r${r.rep}`, startedAt: idx.startedAt ?? now, finishedAt: idx.finishedAt ?? now,
      status: g.status, goldOutcome: c.goldSummary, observedOutcome: g.observed, correct: g.status === 'pass' ? true : g.status === 'fail' ? false : null,
      criteriaResults: g.criteria ?? [],
      usage: u ? {
        inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens,
        modelTurns: u.modelTurns, toolCalls: u.toolCalls, elapsedMs: u.elapsedMs ?? null,
        providerCalls: log ? log.calls : null, fallbackCount: log ? log.fallbacks : null, providerLatencyMs: log ? log.medianLatencyMs : null,
        cost: null, costKind: 'unavailable',
        source: 'subagent transcript (subagent_usage.mjs), all tokens of the case agent session',
      } : {},
      evidenceRefs: ['texts', 'answers'].map((d) => `evidence/${d}/${r.key}.txt`).filter((p) => fs.existsSync(path.join(EXP_DIR, p))).map((p) => `../../../${p}`),
      errors: g.errors ?? [],
      deviations: [...(g.deviations ?? []), ...(log && log.invalid ? [`${log.invalid} engine answer(s) invalid or failed (see evidence/_logs)`] : [])],
    };
    (byArmRep[`${r.arm}.r${r.rep}`] ??= []).push(res);
  }
  for (const [k, cases] of Object.entries(byArmRep)) {
    const [arm, rid] = k.split('.');
    const dir = path.join(EXP_DIR, 'runs', arm === 'A' ? 'A-claude' : 'B-claude-jev', rid);
    fs.mkdirSync(dir, { recursive: true });
    const s = cases.map((c) => c.startedAt).sort(); const e = cases.map((c) => c.finishedAt).sort();
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ experimentId: tool.expId, arm, runId: rid, startedAt: s[0], finishedAt: e.at(-1), cases }, null, 2));
  }
  fs.writeFileSync(path.join(EXP_DIR, 'evidence', 'grades.json'), JSON.stringify(grades, null, 2));
  for (const [k, v] of Object.entries(grades)) console.log(`${k}: ${v.status} | ${v.observed}`);
}

const [cmd, slug, ...rest] = process.argv.slice(2);
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!cmd || !slug) { console.error('Usage: node retro.mjs make|collect|grade|list <slug> ...'); process.exit(2); }
  const tool = await loadTool(slug);
  if (cmd === 'make') {
    const opt = {};
    const get = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : null; };
    if (get('--reps')) opt.reps = get('--reps').split(',').map(Number);
    if (get('--a-suffix')) opt.aSuffix = get('--a-suffix');
    if (get('--only')) opt.only = get('--only').split(',');
    if (get('--arm')) opt.arm = get('--arm');
    make(tool, opt);
  } else if (cmd === 'collect') collect(tool, rest[0]);
  else if (cmd === 'grade') await grade(tool);
  else if (cmd === 'list') for (const r of runKeys(tool)) console.log(r.key, r.workDir);
}
