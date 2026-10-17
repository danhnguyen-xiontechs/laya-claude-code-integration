#!/usr/bin/env node
// collect_grade.mjs - after the agent run: finds each case agent's subagent transcript (by work folder), saves its
// hand-back answer, real token usage and the engine's run files, grades by script, writes runs/*/r*/results.json.
// Usage: node collect_grade.mjs <adv|cur> <subagentsDir>
// Reads <SC>/<tool>/workmap.json (+ rerun.json: [{caseId, arm:'A', rep, workDir, replaces}] for discarded contaminated A cases).
// Writes evidence/{answers,_logs,usage.json,grades.json,run-index.json} and runs/{A-claude,B-claude-jev}/r<n>/results.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const EXP = import.meta.dirname;
const [TOOL, subDir] = process.argv.slice(2);
if (!['adv', 'cur'].includes(TOOL) || !subDir) { console.error('usage: collect_grade.mjs adv|cur <subagentsDir>'); process.exit(2); }
const EXP_ID = path.basename(EXP);
const SC = process.env.SCRATCH_ROOT ?? '<home>/AppData/Local/Temp/claude/D--XionTechs-Laya--claude-worktrees-magical-shtern-feba85/c4cf5e0b-3d40-4d6a-8707-bea182c14834/scratchpad';
const ROOT = `${SC}/${TOOL}`;
const USAGE = path.resolve(EXP, '../../../../.claude/skills/build-skill-tool-workflow/scripts/subagent_usage.mjs');
const FORBID = 'jev_advisor|jev-advisor|jev_skills|curator|curate|engine|OPENROUTER';

// answer key: lives only here, never in a folder an agent works in
const SPEC = {
  h01_layered_config: { cause: [/99-ci/i, /timeout/i], ev: /http\.timeout=0 layer=99-ci\.json/ },
  h03_clock_leak: { cause: [/clock/i, /7200|offset|leak|pollut|never reset|not reset|didn'?t reset/i], ev: /clock offset=7200s/ },
  h05_deadline_budget: { cause: [/geo_lookup/i, /geo_cache|4800|cache/i], ev: /stage=geo_lookup elapsed_ms=4800/ },
  h07_payload_trace: { cause: [/sanitize/i, /usd|lowercase|currency/i], ev: /stage=sanitize payload=.*initech/ },
  h02_stale_migration: { cause: [/0042/, /checksum/i], ev: /0042_orders_region checksum differs/ },
  h04_session_fixture: { cause: [/v1/i, /v2/i, /fixture/i], ev: /fixture set v1 does not match schema v2/ },
  h06_swallowed_exception: { cause: [/flush/i, /swallow|except|KeyError|silent/i], ev: /flush failed for batch of 4 entries/ },
};

const map = JSON.parse(fs.readFileSync(`${ROOT}/workmap.json`, 'utf8'));
const rerunFile = `${ROOT}/rerun.json`;
const rerun = fs.existsSync(rerunFile) ? JSON.parse(fs.readFileSync(rerunFile, 'utf8')) : [];
const replaced = new Set(rerun.map((r) => r.replaces));
const all = [...map, ...rerun];

const dirs = all.map((x) => x.workDir);
const r = spawnSync(process.execPath, [USAGE, subDir, '--forbid', FORBID, ...dirs], { encoding: 'utf8', maxBuffer: 256 << 20 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const usage = JSON.parse(r.stdout);
// second pass: did any agent (either arm) touch the answer key (gold.json, this grading script)?
const rk = spawnSync(process.execPath, [USAGE, subDir, '--forbid', 'gold|collect_grade|grades.json|skill-tool-lifecycle|JEV.{1,4}(docs|examples|jev_advisor|jev_skills|tests|.claude)|docs.{1,4}runs|shadow-eval', ...dirs], { encoding: 'utf8', maxBuffer: 256 << 20 });
const keyUsage = JSON.parse(rk.stdout);

const scrub = (s) => s.replaceAll(process.env.HOME_DIR ?? '<none>', '<home>');
const slug = (x) => `${x.caseId}.${x.arm}${x.workDir.match(/\.(A2)\./) ? '2' : ''}.r${x.rep}`;
fs.mkdirSync(`${EXP}/evidence/answers`, { recursive: true });
fs.mkdirSync(`${EXP}/evidence/_logs`, { recursive: true });
const index = {};
for (const x of all) {
  const u = usage[x.workDir];
  const key = slug(x);
  const row = { ...x, key, discarded: replaced.has(x.workDir), transcript: u?.transcript ?? null, usage: u?.usage ?? null, forbiddenCalls: u?.forbiddenCalls ?? null, keyCalls: keyUsage[x.workDir]?.forbiddenCalls ?? null, model: null, answer: null, runs: 0 };
  if (u?.transcript) {
    let first = null, last = null;
    for (const l of fs.readFileSync(u.transcript, 'utf8').split('\n')) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.timestamp) { first ??= e.timestamp; last = e.timestamp; }
      if (e.type !== 'assistant') continue;
      row.model ??= e.message?.model ?? null;
      for (const c of e.message?.content ?? []) {
        if (c.type !== 'tool_use') continue;
        if (c.name === 'SubagentHandback' && typeof c.input?.message === 'string') row.answer = c.input.message;
        if (c.name === 'Bash' && /runtest\.py/.test(c.input?.command ?? '')) row.runs++;
      }
    }
    row.siblingReads = 0;
    const own = path.basename(x.workDir);
    for (const l of fs.readFileSync(u.transcript, 'utf8').split('\n')) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.type !== 'assistant') continue;
      for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name !== 'SubagentHandback')
        for (const mm of JSON.stringify(c.input ?? {}).matchAll(/work[\\/]+(\w+\.[AB]2?\.r\d+)/g)) if (mm[1] !== own) row.siblingReads++;
    }
    row.startedAt = first; row.finishedAt = last;
    if (row.answer) fs.writeFileSync(`${EXP}/evidence/answers/${key}.txt`, scrub(row.answer.endsWith('\n') ? row.answer : row.answer + '\n'));
  }
  // engine run files left in the B work folder (every run the agent made)
  if (x.arm === 'B') {
    const od = path.join(x.workDir, '.tool-output');
    const lines = [];
    if (fs.existsSync(od)) for (const f of fs.readdirSync(od).filter((f) => f.endsWith('.run.json')).sort()) {
      const run = JSON.parse(fs.readFileSync(path.join(od, f), 'utf8'));
      const advF = path.join(od, f.replace('.run.json', '.advice.json'));
      const adv = fs.existsSync(advF) ? JSON.parse(fs.readFileSync(advF, 'utf8')) : null;
      const cur = fs.existsSync(path.join(od, f.replace('.run.json', '.curate.json'))) ? JSON.parse(fs.readFileSync(path.join(od, f.replace('.run.json', '.curate.json')), 'utf8')) : null;
      lines.push({ runId: run.runId, exitCode: run.exitCode, lines: run.lines, bytes: run.bytes, eligible: run.eligible, jevState: run.jev?.state ?? 'none', waitedMs: run.jev?.waitedMs ?? null,
        hints: (run.jev?.hints ?? []).length, questions: run.request?.questions ?? 0, adviceStatus: adv?.status ?? null, adviceError: adv?.error ?? null,
        answered: adv ? Object.keys(adv.answers ?? {}).length : 0, invalid: (adv?.invalid ?? []).length, latencyMs: adv?.latencyMs ?? null, cost: adv?.usage?.cost ?? null,
        curator: cur ? { omittedChunks: cur.blocks.filter((b) => b.decision === 'omit').length, chunks: cur.blocks.length, omittedLines: cur.omittedLines.length, totalLines: cur.totalLines, reduction: cur.reduction } : null });
    }
    row.engineRuns = lines;
    fs.writeFileSync(`${EXP}/evidence/_logs/${key}.jsonl`, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  }
  index[key] = row;
}

// ---- grading (from the hand-back text, never the agent's claim) ----
function grade(caseId, text) {
  const s = SPEC[caseId];
  if (text == null) return { status: 'error', cause: false, ev: false, note: 'no hand-back answer' };
  const m = text.match(/CAUSE:([\s\S]*?)(?:\nEVIDENCE:|$)/i);
  const ca = (m ? m[1] : text) + ' ' + (text.match(/LOCATION:(.*)/i)?.[1] ?? '');
  const ev = text.match(/EVIDENCE:([\s\S]*?)(?:\nRUNS:|$)/i)?.[1] ?? text;
  const cause = s.cause.every((rx) => rx.test(ca));
  const evOk = s.ev.test(ev);
  return { status: cause && evOk ? 'pass' : 'fail', cause, ev: evOk, note: `cause terms ${cause ? 'ok' : 'missing'}; gold evidence line ${evOk ? 'quoted' : 'not quoted'}` };
}

const runs = {};
const grades = {};
const final = Object.values(index).filter((r) => !r.discarded);
for (const row of final) {
  const g = row.answer == null ? grade(row.caseId, null) : grade(row.caseId, row.answer);
  const armDir = row.arm === 'A' ? 'A-claude' : 'B-claude-jev';
  const rid = `r${row.rep}`;
  const bucket = (runs[`${armDir}/${rid}`] ??= { arm: row.arm, rid, cases: [] });
  const now = new Date().toISOString();
  const u = row.usage;
  const eng = row.engineRuns ?? [];
  const status = !row.transcript ? 'blocked' : g.status;
  const calls = row.arm === 'B' ? eng.reduce((n, e) => n + (e.questions > 0 ? 1 : 0), 0) : null;
  const lat = row.arm === 'B' ? eng.map((e) => e.latencyMs).filter((v) => v != null).sort((a, b) => a - b) : [];
  bucket.cases.push({
    experimentId: EXP_ID, caseId: row.caseId, arm: row.arm, runId: rid, startedAt: row.startedAt ?? now, finishedAt: row.finishedAt ?? now,
    status, correct: status === 'pass' ? true : status === 'fail' ? false : null,
    observedOutcome: `${g.note}; agent ran the test command ${row.runs}x`,
    criteriaResults: [{ criterionId: 'cause-terms', status: g.cause ? 'pass' : 'fail', notes: '' }, { criterionId: 'gold-evidence-line-quoted', status: g.ev ? 'pass' : 'fail', notes: '' }],
    usage: u ? { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, modelTurns: u.modelTurns, toolCalls: u.toolCalls, elapsedMs: u.elapsedMs ?? null,
      providerCalls: row.arm === 'B' ? calls : null, fallbackCount: row.arm === 'B' ? eng.filter((e) => e.questions > 0 && e.adviceStatus !== 'ok').length : null, providerLatencyMs: lat.length ? lat[Math.floor((lat.length - 1) / 2)] : null,
      source: 'subagent transcript (subagent_usage.mjs --no-subagents), all tokens of the case agent session' } : {},
    evidenceRefs: [`../../../evidence/answers/${row.key}.txt`, `../../../evidence/texts/${row.caseId}.${row.arm}.txt`],
    errors: row.transcript ? [] : ['no subagent transcript found'], deviations: row.arm === 'A' && row.forbiddenCalls > 0 ? [`forbiddenCalls=${row.forbiddenCalls}`] : [],
  });
  grades[row.key] = { ...g, model: row.model, runs: row.runs, forbiddenCalls: row.forbiddenCalls, keyCalls: row.keyCalls, siblingReads: row.siblingReads };
}
for (const [k, b] of Object.entries(runs)) {
  const dir = `${EXP}/runs/${k}`;
  fs.mkdirSync(dir, { recursive: true });
  const st = b.cases.map((c) => c.startedAt).sort(); const en = b.cases.map((c) => c.finishedAt).sort();
  fs.writeFileSync(`${dir}/results.json`, JSON.stringify({ experimentId: EXP_ID, arm: b.arm, runId: b.rid, startedAt: st[0], finishedAt: en.at(-1), cases: b.cases }, null, 2));
}
const slim = Object.fromEntries(Object.entries(index).map(([k, v]) => [k, { ...v, answer: undefined, transcript: v.transcript ? '<transcript>' : null }]));
fs.writeFileSync(`${EXP}/evidence/run-index.json`, scrub(JSON.stringify(slim, null, 2)));
fs.writeFileSync(`${EXP}/evidence/grades.json`, JSON.stringify(grades, null, 2));
fs.writeFileSync(`${EXP}/evidence/usage.json`, scrub(JSON.stringify(Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, { ...v, transcript: v.transcript ? '<transcript>' : null }])), null, 2)));
for (const [k, g] of Object.entries(grades)) console.log(k.padEnd(34), g.status.padEnd(6), g.note, `model=${g.model} runs=${g.runs} forbidden=${g.forbiddenCalls} keyCalls=${g.keyCalls} sibling=${g.siblingReads}`);
