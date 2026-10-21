// run-pilot-v2.mjs: one-story pilot (W-19279, calibration split), lock v2. Terms in pilot-lock-v2.md.
// Runs once. Order: Haiku generation (diagnostic), JEV (3 orderings), Sonnet and Opus generation, then 3 blind Sonnet gradings.
// Halts on the first call error or cost anomaly: no later model call runs. No retries.
// Every call's raw CLI output is saved in results/. A cost the CLI does not return is charged at its cap.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V1 = path.resolve(HERE, '../pilot'); // v1 folder: rubric, brief, grader prompt, v1 results (read-only)
const SR = path.resolve(HERE, '../../../../../.claude/skills/subagent-model-router');
const RES = path.join(HERE, 'results');

const STORY_ID = 'W-19279';
const CEILING = 1.5; // USD, whole pilot (JEV + generation + grading). Set in the lock before any model call.
const REUSE_V1 = false; // true: reuse v1 answers and gradings for A and C. false: re-run all three. Set in the lock.
const JEV_ALLOW = 0.05; // USD charged per JEV call when no cost comes back
const CAP = { haiku: 0.1, sonnet: 0.4, opus: 0.6, grader: 0.4 }; // USD per call, --max-budget-usd
const MODEL = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const GRADER = 'sonnet';
const GEN_ORDER = ['haiku', 'sonnet', 'opus'];
const LABEL = { haiku: 'B', sonnet: 'C', opus: 'A' }; // grader sees only the letter

// sha256 of the LF-normalized text (CRLF -> LF). Same values as pilot-lock.md (v1) for the three text files.
const LOCK = {
  'rubric-W-19279.md': 'cf1769430d168cb702abc8a25898d8e414b46ed565da40e6078f6442681879c2',
  'brief.txt': 'aed0f90e3241dff0ec5501b18258120b71b874a5fe80c7fba8eae4492b318a64',
  'grader-prompt.txt': '793ecdca495aad0ebd7ed02396497db455b2a3402012853899f691f09d5cabef',
  'stories-text.json': 'a7202787dc570df8b1f2fcfa832e8b9c3e6fd72f4fe5cad5a4f247de56da6203',
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

if (CEILING == null || REUSE_V1 == null) throw new Error('CEILING and REUSE_V1 are not set: the lock v2 values must be filled in before the run.');
if (fs.existsSync(RES)) throw new Error('results/ exists: the pilot runs once. Make a new lock to re-run.');

const inputs = {
  'rubric-W-19279.md': readText(`${V1}/rubric-W-19279.md`),
  'brief.txt': readText(`${V1}/brief.txt`),
  'grader-prompt.txt': readText(`${V1}/grader-prompt.txt`),
  'stories-text.json': readText(`${SR}/real/stories-text.json`),
};
for (const [name, text] of Object.entries(inputs)) {
  if (sha(text) !== LOCK[name]) throw new Error(`${name} does not match lock v2 (sha256 ${sha(text).slice(0, 16)})`);
}
const selfHash = sha(readText(fileURLToPath(import.meta.url)));

const stories = JSON.parse(inputs['stories-text.json']);
const story = stories.find((s) => s.id === STORY_ID);
if (!story) throw new Error(`story ${STORY_ID} not found`);
const rubric = inputs['rubric-W-19279.md'];
const brief = inputs['brief.txt'].replace('<<TASK>>', () => story.task);
const graderTpl = inputs['grader-prompt.txt'];

fs.mkdirSync(RES);
const save = (name, obj) => fs.writeFileSync(`${RES}/${name}`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));
const NEUTRAL_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v2-'));

const spent = { jev: 0, generation: 0, grading: 0 };
const total = () => spent.jev + spent.generation + spent.grading;
const room = (need) => total() + need <= CEILING;
let halt = null; // { call, reason } once a call misbehaves: no further model call runs

// One fresh, tool-less claude -p session. Raw stdout and stderr are saved as results/raw-<name>.txt.
// The npm 'claude' is a .cmd shim, which spawnSync cannot run without a shell. The shell would drop the empty --tools argument, so the exe is called directly.
const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
function claude(name, model, prompt, cap) {
  const r = spawnSync(CLAUDE_BIN, ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--max-budget-usd', String(cap)], { input: prompt, encoding: 'utf8', cwd: NEUTRAL_CWD, timeout: 300000, maxBuffer: 50 * 1024 * 1024 });
  save(`raw-${name}.txt`, `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n--- error ---\n${r.error ? String(r.error.message) : ''}\n--- exit ---\n${r.status}`);
  if (r.error) return { ran: false, error: String(r.error.message), text: '', cost: null, usage: null };
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { return { ran: Boolean(r.stdout), error: `non-JSON stdout (exit ${r.status})`, text: '', cost: null, usage: null }; }
  const text = typeof j.result === 'string' ? j.result : '';
  let error = j.is_error ? String(j.result ?? j.subtype ?? 'is_error').slice(0, 300) : null;
  if (!error && !text.trim()) error = 'empty result';
  return { ran: true, error, text, cost: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, usage: j.usage ?? null };
}

// Charge one claude call. Returns the charged amount; sets halt on an error or a cost above the cap.
function settle(kind, name, r, cap) {
  const charged = r.cost ?? (r.ran ? cap : 0);
  spent[kind] += charged;
  if (r.error) halt = { call: name, reason: `error: ${r.error}` };
  else if (r.cost != null && r.cost > cap) halt = { call: name, reason: `cost ${r.cost} above cap ${cap}` };
  return charged;
}

// 1. Haiku generation first: the diagnostic. Haiku answers are always re-run (v1 Haiku call returned no answer).
const gen = {};
const genRun = {};
const reusable = (tier) => REUSE_V1 && (tier === 'sonnet' || tier === 'opus');
const v1Gen = (tier) => JSON.parse(fs.readFileSync(`${V1}/results/gen-${LABEL[tier]}-${tier}.json`, 'utf8'));

for (const tier of GEN_ORDER) {
  if (halt) { gen[tier] = { skipped: `halted at ${halt.call}` }; continue; }
  if (reusable(tier)) { // A (opus) and C (sonnet) from v1: copied, no new call, cost not charged to this pilot
    const v = v1Gen(tier);
    gen[tier] = { label: LABEL[tier], model: MODEL[tier], reusedFrom: 'pilot v1 (lock v1)', error: v.error, costUsd: v.costUsd, chargedUsd: 0, text: v.text };
    save(`gen-${LABEL[tier]}-${tier}.json`, gen[tier]);
    if (v.text) save(`answer-${LABEL[tier]}.md`, v.text);
    continue;
  }
  if (!room(CAP[tier])) { gen[tier] = { skipped: 'ceiling' }; continue; }
  const r = claude(`gen-${LABEL[tier]}-${tier}`, MODEL[tier], brief, CAP[tier]);
  const charged = settle('generation', `gen-${LABEL[tier]}-${tier}`, r, CAP[tier]);
  gen[tier] = { label: LABEL[tier], model: MODEL[tier], error: r.error, costUsd: r.cost, chargedUsd: charged, usage: r.usage, text: r.text };
  save(`gen-${LABEL[tier]}-${tier}.json`, gen[tier]);
  if (r.text && !r.error) save(`answer-${LABEL[tier]}.md`, r.text);
}

// 2. JEV: the same three orderings route.mjs uses for k=3. Skipped if generation halted.
const jev = [];
let jevPrediction = null;
if (!halt) {
  const { askOnce, orderings, consistency } = await import(pathToFileURL(`${SR}/scripts/router.mjs`).href);
  const jevCfg = { provider: 'jev', jev: {}, timeoutMs: 20000 };
  for (const order of orderings(3)) {
    if (!room(JEV_ALLOW)) { jev.push({ order, skipped: 'ceiling' }); continue; }
    const a = await askOnce({ task: story.task, type: null, order, cfg: jevCfg });
    const charged = a.cost ?? JEV_ALLOW;
    spent.jev += charged;
    jev.push({ order, ...a, chargedUsd: charged });
  }
  const withTier = jev.filter((x) => x.tier);
  jevPrediction = withTier.length ? consistency(withTier) : null;
  save('jev.json', { prediction: jevPrediction, calls: jev, spentUsd: spent.jev });
}

// 3. Grading: one fresh Sonnet session per answer, rubric and task only, no tier name.
const grades = {};
for (const tier of GEN_ORDER) {
  const g = gen[tier];
  const label = LABEL[tier];
  if (reusable(tier) && g?.text) { // A and C: v1 grading reused with the same answer text
    const v = JSON.parse(fs.readFileSync(`${V1}/results/grade-${label}.json`, 'utf8'));
    grades[label] = { ...v, reusedFrom: 'pilot v1 (lock v1)' };
    save(`grade-${label}.json`, grades[label]);
    continue;
  }
  if (!g || g.skipped || !g.text || g.error) { grades[label] = { skipped: g?.skipped ?? 'no answer', generationError: g?.error ?? null }; continue; }
  if (halt) { grades[label] = { skipped: `halted at ${halt.call}` }; continue; }
  if (!room(CAP.grader)) { grades[label] = { skipped: 'ceiling' }; continue; }
  const prompt = graderTpl.replace('<<RUBRIC>>', () => rubric).replace('<<TASK>>', () => story.task).replace('<<ANSWER>>', () => g.text);
  const r = claude(`grade-${label}`, MODEL[GRADER], prompt, CAP.grader);
  const charged = settle('grading', `grade-${label}`, r, CAP.grader);
  let parsed = null, parseError = null;
  try { parsed = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)); } catch (x) { parseError = String(x.message).slice(0, 120); }
  grades[label] = { grader: MODEL[GRADER], error: r.error, parseError, parsed, costUsd: r.cost, chargedUsd: charged };
  save(`grade-${label}.json`, grades[label]);
}

// 4. Summary. The label-to-tier map is written here, after grading, and never shown to a grader.
const summary = {
  storyId: STORY_ID,
  lock: 'v2',
  runnerSha256: selfHash,
  ceilingUsd: CEILING,
  reuseV1: REUSE_V1,
  halt,
  spentUsd: { jev: spent.jev, generation: spent.generation, grading: spent.grading, total: total() },
  labelMap: LABEL,
  jevPrediction,
  generation: Object.fromEntries(GEN_ORDER.map((t) => [t, { label: LABEL[t], costUsd: gen[t]?.costUsd ?? null, chargedUsd: gen[t]?.chargedUsd ?? null, error: gen[t]?.error ?? null, skipped: gen[t]?.skipped ?? null, reusedFrom: gen[t]?.reusedFrom ?? null }])),
  grading: grades,
};
save('summary.json', summary);
console.log(JSON.stringify({ halt, spentUsd: summary.spentUsd, jevPrediction, overall: Object.fromEntries(Object.entries(grades).map(([l, g]) => [l, g.parsed?.overall ?? g.skipped ?? g.error ?? g.parseError ?? 'no grade'])) }));
