// run-0B.mjs: Phase 0B calibration runner. 13 evaluable stories plus W-19279 (pilot-exposed, provenance only). W-19358 is not_evaluable: no call is made for it.
// Sequential. Order: 42 generations, 42 gradings (Sonnet), 9 repeat gradings (Sonnet), then the label map is read for blind-sample labels only.
// Starts from the rubric-helper spend in baseline-ledger-0B.json. Fails closed (no call) if the ledger is missing or does not match its source.
// Reserve check before every call: if spent + next cap > STOP, no call is made. $15 (CEILING) is a runner stop, not a billing ceiling.
// Halts (no retry) on: call error, unparseable CLI output, empty answer, cost above the per-call cap, malformed grade, held-out id in any prompt, runner stop.
// Raw CLI output is saved before any halt check. results/ must not exist at start; it is written once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, 'results');
const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
const PREFIX_ARGS = []; // empty in the locked runner; test copies only (stub script path)
const STOP = 12; // USD. Reserve check: no call if spent + next cap > STOP
const CEILING = 15; // USD. Runner stop, not a billing ceiling: halts if spent goes above it after a call
const CAP = { haiku: 0.1, sonnet: 0.4, opus: 0.6, grader: 0.4 }; // USD per call, --max-budget-usd
const MODEL = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', grader: 'claude-sonnet-5-5' };
const TIERS = ['haiku', 'sonnet', 'opus']; // fixed order, cheapest first
const POK = 'W-19279'; // pilot-exposed: run for provenance, excluded from conclusions
const REGRADE_N = 9;
const REGRADE_THRESHOLD = 7;
const SEED_REGRADE = '0B-regrade-v1';
const LOCK_FILE = 'run-0B-lock.json';
const CAL_FILE = 'calibration-stories-0B.json';
const SPLIT_FILE = 'split-0B.json';
const MAP_FILE = 'mapping-0B.json';
const BRIEF_FILE = 'pilot/brief.txt';
const GRADER_FILE = 'grader-prompt-0B.txt';
const PILOT_RUBRIC = 'pilot/rubric-W-19279.md';
const STATUS_FILE = 'story-status-0B.json';
const BASE_FILE = 'baseline-ledger-0B.json';

const E3_PATTERNS = [
  /\bI (?:ran|tested|checked|inspected|verified|reviewed|reproduced|executed|confirmed)\b/i,
  /\b(?:tests?|build|suite)\s+(?:pass|passed|passes|are green|is green)\b/i,
  /\b[\w./-]+\.(?:cs|ts|tsx|js|mjs|sql|java|py|xml|cshtml|aspx|config):\d+\b/i,
  /\bline\s+\d+\b/i,
];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (s) => s.replace(/\r\n/g, '\n');
const readText = (rel) => norm(fs.readFileSync(path.join(HERE, rel), 'utf8'));
const readJson = (rel) => JSON.parse(readText(rel));
const write = (rel, s) => {
  const file = path.join(RES, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s, 'utf8');
};
const fill = (tpl, values) => tpl.replace(/<<([A-Z]+)>>/g, (m, k) => (k in values ? values[k] : m));
const prng = (seedText) => {
  let a = crypto.createHash('sha256').update(seedText).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

class Halt extends Error {
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
  }
}

const state = { spent: 0, baseline: 0, n: 0, calls: [] };
let HELD = []; // held-out story ids, from split-0B.json. Never printed.

// Spend made before this runner (the rubric-helper call). Fails closed: any mismatch halts before the first call.
function baselineSpend() {
  let ledger;
  try {
    ledger = readJson(BASE_FILE);
  } catch {
    throw new Halt('baseline-missing', `${BASE_FILE} is missing or unparseable; no call made`);
  }
  let sum = 0;
  for (const e of ledger.entries ?? []) {
    let src;
    try {
      src = readText(e.source);
    } catch {
      throw new Halt('baseline-mismatch', `${e.id}: source file is missing; no call made`);
    }
    if (sha(src) !== e.source_sha256) throw new Halt('baseline-mismatch', `${e.id}: source hash differs from ledger; no call made`);
    if (JSON.parse(src).total_cost_usd !== e.total_cost_usd) throw new Halt('baseline-mismatch', `${e.id}: source cost differs from ledger; no call made`);
    sum += e.total_cost_usd;
  }
  if (typeof ledger.total_usd !== 'number' || ledger.total_usd !== sum) throw new Halt('baseline-mismatch', `${BASE_FILE}: total_usd is not the sum of its entries; no call made`);
  return sum;
}

function recordCalls() {
  write('calls.json', JSON.stringify(state.calls, null, 2));
}

// One CLI call. Saves raw output first, then checks. Sequential, no retry.
function call(kind, label, prompt) {
  const cap = CAP[kind];
  if (state.spent + cap > STOP) {
    throw new Halt('reserve', `${label}: spent ${state.spent.toFixed(6)} + cap ${cap} > ${STOP}; no call made`);
  }
  for (const h of HELD) {
    if (prompt.includes(h)) throw new Halt('held-out-id', `${label}: a held-out id is in the prompt; no call made`);
  }
  state.n += 1;
  const n = String(state.n).padStart(3, '0');
  const args = ['-p', '--model', MODEL[kind], '--output-format', 'json', '--tools', '', '--no-session-persistence', '--max-budget-usd', String(cap)];
  const res = spawnSync(CLAUDE_BIN, [...PREFIX_ARGS, ...args], { input: prompt, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 });
  const rawName = `raw/${n}-${label}.json`;
  write(rawName, res.stdout ?? '');
  if (res.stderr) write(`raw/${n}-${label}.stderr.txt`, res.stderr);
  const rec = { n, label, kind, model: MODEL[kind], capUsd: cap, raw: rawName, exitStatus: res.status, costUsd: null, chargedUsd: null, isError: null, error: null };
  state.calls.push(rec);
  recordCalls();
  if (res.error) {
    rec.error = String(res.error.message);
    recordCalls();
    throw new Halt('call-error', `${label}: ${rec.error}`);
  }
  if (res.status !== 0) {
    rec.error = `exit ${res.status}`;
    recordCalls();
    throw new Halt('call-error', `${label}: exit ${res.status}`);
  }
  let out;
  try {
    out = JSON.parse(res.stdout);
  } catch {
    rec.error = 'unparseable stdout';
    recordCalls();
    throw new Halt('call-error', `${label}: unparseable CLI output (saved in ${rawName})`);
  }
  // A cost the CLI does not return is charged at the cap.
  const cost = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : cap;
  rec.costUsd = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null;
  rec.chargedUsd = cost;
  rec.isError = out.is_error === true;
  state.spent += cost;
  recordCalls();
  if (out.is_error) throw new Halt('call-error', `${label}: is_error`);
  if (typeof out.result !== 'string' || out.result.trim() === '') throw new Halt('empty', `${label}: empty result`);
  if (cost > cap) throw new Halt('over-cap', `${label}: cost ${cost} above per-call cap ${cap}`);
  if (state.spent > CEILING) throw new Halt('runner-stop', `${label}: spent ${state.spent} above ${CEILING}`);
  return norm(out.result);
}

// Criteria from a rubric: lines "- **R1.**", "- **D1.**", "- **E1:**", "- **C1 (required). ...**".
// Decisive = every R, plus a C line marked "(required".
function criteriaOf(text) {
  return [...text.matchAll(/^- \*\*([RCDE]\d+)\b([^\n]*)$/gm)].map((m) => ({
    id: m[1],
    kind: m[1][0],
    decisive: m[1][0] === 'R' || (m[1][0] === 'C' && /\(required/.test(m[2])),
  }));
}

function parseGrade(reply, crit, label) {
  let g;
  try {
    g = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1));
  } catch {
    throw new Halt('grader-malformed', `${label}: reply is not JSON`);
  }
  for (const c of crit) {
    const allowed = c.kind === 'E' ? ['present', 'absent'] : ['pass', 'fail'];
    if (!g[c.id] || !allowed.includes(g[c.id].result) || typeof g[c.id].quote !== 'string') {
      throw new Halt('grader-malformed', `${label}: ${c.id} missing or invalid`);
    }
  }
  if (!['pass', 'fail'].includes(g.overall)) throw new Halt('grader-malformed', `${label}: overall missing or invalid`);
  return g;
}

// Overall is recomputed here from the criteria: all decisive pass AND no E present.
function scoreOf(crit, g, answer) {
  const decisivePass = crit.filter((c) => c.decisive).every((c) => g[c.id].result === 'pass');
  const ePresent = crit.filter((c) => c.kind === 'E' && g[c.id].result === 'present').map((c) => c.id);
  const quoteMismatch = crit.filter((c) => g[c.id].quote !== 'none' && !answer.includes(norm(g[c.id].quote))).map((c) => c.id);
  return {
    overallComputed: decisivePass && ePresent.length === 0 ? 'pass' : 'fail',
    overallGrader: g.overall,
    ePresent,
    e3Grader: crit.some((c) => c.id === 'E3') ? g.E3.result : null,
    quoteMismatch,
  };
}

function e3Flags(answer) {
  const out = [];
  for (const re of E3_PATTERNS) {
    for (const m of answer.matchAll(new RegExp(re.source, 'gi'))) {
      const from = Math.max(0, m.index - 100);
      const to = Math.min(answer.length, m.index + m[0].length + 100);
      out.push({ match: m[0], context: answer.slice(from, to).replace(/\n/g, ' ') });
    }
  }
  return out;
}

function preflight() {
  if (fs.existsSync(RES)) throw new Error('results/ exists: this runner runs once. Make a new lock to re-run.');
  const lock = readJson(LOCK_FILE);
  for (const [rel, want] of Object.entries(lock.files)) {
    if (sha(readText(rel)) !== want) throw new Error(`hash mismatch: ${rel}`);
  }
  return lock;
}

function main() {
  preflight();
  const started = new Date().toISOString();
  write('status.json', JSON.stringify({ status: 'running', started }, null, 2));
  try {
    state.baseline = baselineSpend();
    state.spent = state.baseline;
    const split = readJson(SPLIT_FILE).assignments;
    const calIds = Object.keys(split).filter((id) => split[id].split === 'calibration');
    HELD = Object.keys(split).filter((id) => split[id].split === 'held-out');

    const stories = readJson(CAL_FILE);
    const ids = stories.map((s) => s.id);
    if (ids.length !== calIds.length || ids.some((id) => !calIds.includes(id))) throw new Error('calibration story set differs from split-0B.json');
    const statusOf = Object.fromEntries(readJson(STATUS_FILE).stories.map((s) => [s.id, s.status]));
    if (Object.keys(statusOf).sort().join() !== [...ids].sort().join()) throw new Error('story-status-0B.json differs from the calibration file');
    if (Object.values(statusOf).some((v) => !['evaluable', 'pilot_exposed', 'not_evaluable'].includes(v))) throw new Error('unknown status in story-status-0B.json');
    if (statusOf[POK] !== 'pilot_exposed') throw new Error(`${POK} must be pilot_exposed`);
    const runStories = stories.filter((s) => statusOf[s.id] !== 'not_evaluable');
    const runIds = runStories.map((s) => s.id);
    const evaluable = runIds.filter((id) => statusOf[id] === 'evaluable');
    for (const s of stories) {
      for (const h of HELD) {
        if (s.summary.includes(h) || s.task.includes(h)) throw new Halt('held-out-id', `${s.id}: a held-out id is in calibration text`);
      }
    }

    const brief = readText(BRIEF_FILE);
    const graderTpl = readText(GRADER_FILE);
    const rubricOf = (id) => readText(id === POK ? PILOT_RUBRIC : `rubrics/rubric-${id}.md`);
    const crit = {};
    for (const id of runIds) {
      crit[id] = criteriaOf(rubricOf(id));
      if (!crit[id].some((c) => c.decisive)) throw new Halt('no-required-criterion', `${id}: mark non_discriminative before any model call`);
    }
    const taskOf = Object.fromEntries(stories.map((s) => [s.id, s.task]));

    // 1. Generation: 15 stories x 3 tiers.
    const answers = {};
    for (const s of runStories) {
      for (const t of TIERS) {
        const text = call(t, `gen-${s.id}-${t}`, fill(brief, { TASK: taskOf[s.id] }));
        answers[`${s.id}.${t}`] = text;
        write(`answers/${s.id}.${t}.md`, text);
      }
    }

    // 2. Grading and scoring.
    const gradeOne = (id, t, label) => {
      const answer = answers[`${id}.${t}`];
      const reply = call('grader', label, fill(graderTpl, {
        IDS: crit[id].map((c) => c.id).join(', '),
        RUBRIC: rubricOf(id),
        TASK: taskOf[id],
        ANSWER: answer,
      }));
      const g = parseGrade(reply, crit[id], label);
      const rec = { storyId: id, tier: t, label, ...scoreOf(crit[id], g, answer) };
      write(`grades/${label}.json`, JSON.stringify(rec, null, 2));
      return rec;
    };
    const grades = {};
    for (const s of runStories) {
      for (const t of TIERS) grades[`${s.id}.${t}`] = gradeOne(s.id, t, `grade-${s.id}-${t}`);
    }

    // 3. Repeat grading: 9 of the 39 evaluable outputs (13 stories x 3 tiers), chosen by seeded shuffle before any label is read.
    const keys = evaluable.flatMap((id) => TIERS.map((t) => `${id}.${t}`)).sort();
    const rnd = prng(SEED_REGRADE);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    const sample = keys.slice(0, REGRADE_N);
    const regrades = {};
    for (const k of sample) {
      const [id, t] = k.split('.');
      regrades[k] = gradeOne(id, t, `regrade-${id}-${t}`);
    }
    const agree = sample.filter((k) => regrades[k].overallComputed === grades[k].overallComputed).length;

    // 4. Labels. The mapping is read here, after all grading. Used for blind-sample labels only.
    // Tier results are not written here: analyse-0B.mjs reads them after the user's blind grades are saved.
    const mapping = readJson(MAP_FILE).map;
    const letterOf = {};
    for (const id of runIds) {
      letterOf[id] = {};
      for (const [letter, tier] of Object.entries(mapping[id])) letterOf[id][tier] = letter;
      if (TIERS.some((t) => !letterOf[id][t])) throw new Error(`mapping incomplete for ${id}`);
    }

    const flagsByKey = Object.fromEntries(Object.keys(answers).map((k) => [k, e3Flags(answers[k])]));
    const flagLines = [];
    for (const s of runStories) {
      for (const t of TIERS) {
        const k = `${s.id}.${t}`;
        if (flagsByKey[k].length === 0) continue;
        flagLines.push(`## ${s.id} answer ${letterOf[s.id][t]}${s.id === POK ? ' (pilot-exposed)' : ''}`);
        for (const f of flagsByKey[k]) flagLines.push(`- "${f.match}": ...${f.context}...`);
        flagLines.push('');
      }
    }
    write('e3-flags.md', `# E3 flags (pattern hits, not verdicts)\n\nEach hit must be read by a person before E3 is final. A regex cannot tell a claim from advice or a stated limit.\n\n${flagLines.join('\n')}`);

    fs.mkdirSync(path.join(RES, 'blind-sample'), { recursive: true });
    sample.forEach((k, i) => {
      const [id, t] = k.split('.');
      const body = `# Blind sample ${String(i + 1).padStart(2, '0')} of ${REGRADE_N} (Phase 0B)\n\nAnswer label: ${letterOf[id][t]}\n\n## Task\n${taskOf[id]}\n\n## Rubric\n${rubricOf(id)}\n\n## Answer ${letterOf[id][t]}\n${answers[k]}\n`;
      write(`blind-sample/sample-${String(i + 1).padStart(2, '0')}.md`, body);
    });

    const disagreements = [...Object.values(grades), ...Object.values(regrades)].filter((r) => r.overallGrader !== r.overallComputed).length;
    const quoteMismatches = [...Object.values(grades), ...Object.values(regrades)].reduce((n, r) => n + r.quoteMismatch.length, 0);
    const summary = {
      status: 'complete',
      started,
      finished: new Date().toISOString(),
      stories: ids.length,
      notEvaluable: ids.length - runIds.length,
      runnable: runIds.length,
      evaluable: evaluable.length,
      pilotExposed: POK,
      baselineUsd: Number(state.baseline.toFixed(6)),
      gradings: Object.keys(grades).length,
      repeatGradings: sample.length,
      repeatAgreement: `${agree} of ${REGRADE_N}`,
      repeatThreshold: REGRADE_THRESHOLD,
      repeatResult: agree >= REGRADE_THRESHOLD ? 'threshold met' : 'below threshold',
      graderOverallDisagreements: disagreements,
      quoteMismatches,
      e3FlagHits: Object.values(flagsByKey).reduce((n, f) => n + f.length, 0),
      heldOutIdsChecked: HELD.length,
      heldOutCheck: 'passed (no held-out id in any prompt or calibration text)',
      spentUsd: Number(state.spent.toFixed(6)),
      calls: state.calls.length,
      note: 'Tier results are not in this file. analyse-0B.mjs reads them after the blind grades are saved.',
    };
    write('summary.json', JSON.stringify(summary, null, 2));
    write('status.json', JSON.stringify({ status: 'complete', started, finished: summary.finished, spentUsd: summary.spentUsd, calls: summary.calls }, null, 2));
    recordCalls();
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    const reason = e instanceof Halt ? e.reason : 'error';
    write('status.json', JSON.stringify({ status: 'incomplete', reason, message: e.message, started, spentUsd: Number(state.spent.toFixed(6)), calls: state.calls.length }, null, 2));
    recordCalls();
    console.error(`INCOMPLETE (${reason}): ${e.message}`);
    process.exitCode = 1;
  }
}

main();
