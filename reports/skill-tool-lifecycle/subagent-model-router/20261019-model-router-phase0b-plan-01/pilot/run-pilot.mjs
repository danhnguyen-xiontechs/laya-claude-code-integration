// run-pilot.mjs: one-story pilot (W-19279, calibration split). Runs once; terms are in pilot-lock.md.
// Order: JEV (3 orderings), then generation (haiku, sonnet, opus), then grading (3 blind Sonnet calls).
// No retries. Every call counts against the ceiling. A cost the CLI does not return is charged at its cap.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PILOT = 'D:/Laya/reports/skill-tool-lifecycle/subagent-model-router/20261019-model-router-phase0b-plan-01/pilot';
const SR = 'D:/Laya/.claude/skills/subagent-model-router';
const NEUTRAL_CWD = 'C:/Users/LENOVO2/AppData/Local/Temp/claude/D--Laya/aa8ec66b-bb4f-4542-a780-7f24a22eb8e1/scratchpad';
const STORY_ID = 'W-19279';
const CEILING = 1.5; // USD, whole pilot: JEV + generation + grading
const JEV_ALLOW = 0.05; // USD charged per JEV call when no cost comes back
const CAP = { haiku: 0.1, sonnet: 0.4, opus: 0.6, grader: 0.4 }; // USD per call, --max-budget-usd
const MODEL = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
const GRADER = 'sonnet';
const GEN_ORDER = ['haiku', 'sonnet', 'opus'];
const LABEL = { haiku: 'B', sonnet: 'C', opus: 'A' }; // grader sees only the label

const RES = `${PILOT}/results`;
if (fs.existsSync(RES)) throw new Error('results/ exists: the pilot runs once. Make a new lock to re-run.');
fs.mkdirSync(RES);
const save = (name, obj) => fs.writeFileSync(`${RES}/${name}`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1));

const stories = JSON.parse(fs.readFileSync(`${SR}/real/stories-text.json`, 'utf8'));
const story = stories.find((s) => s.id === STORY_ID);
if (!story) throw new Error(`story ${STORY_ID} not found`);
const rubric = fs.readFileSync(`${PILOT}/rubric-W-19279.md`, 'utf8');
const brief = fs.readFileSync(`${PILOT}/brief.txt`, 'utf8').replace('<<TASK>>', () => story.task);
const graderTpl = fs.readFileSync(`${PILOT}/grader-prompt.txt`, 'utf8');

const spent = { jev: 0, generation: 0, grading: 0 };
const total = () => spent.jev + spent.generation + spent.grading;
const room = (need) => total() + need <= CEILING;

// One fresh, tool-less claude -p session. `ran` is true once the CLI produced output (the call may have cost money).
function claude(model, prompt, cap) {
  const r = spawnSync('claude', ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--max-budget-usd', String(cap)], { input: prompt, encoding: 'utf8', cwd: NEUTRAL_CWD, timeout: 300000, maxBuffer: 50 * 1024 * 1024 });
  if (r.error) return { ran: false, error: String(r.error.message), text: null, cost: null };
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { return { ran: Boolean(r.stdout), error: `non-JSON stdout (exit ${r.status}): ${String(r.stdout).slice(0, 200)} ${String(r.stderr).slice(0, 300)}`, text: null, cost: null }; }
  return { ran: true, error: j.is_error ? String(j.result).slice(0, 300) : null, text: j.result ?? '', cost: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null, usage: j.usage ?? null, raw: j };
}

// 1. JEV: the same three orderings route.mjs uses for k=3.
const { askOnce, orderings, consistency } = await import(pathToFileURL(`${SR}/scripts/router.mjs`).href);
const jevCfg = { provider: 'jev', jev: {}, timeoutMs: 20000 };
const jev = [];
for (const order of orderings(3)) {
  if (!room(JEV_ALLOW)) { jev.push({ order, skipped: 'ceiling' }); continue; }
  const a = await askOnce({ task: story.task, type: null, order, cfg: jevCfg });
  const charged = a.cost ?? JEV_ALLOW;
  spent.jev += charged;
  jev.push({ order, ...a, chargedUsd: charged });
}
const withTier = jev.filter((x) => x.tier);
const jevPrediction = withTier.length ? consistency(withTier) : null;
save('jev.json', { prediction: jevPrediction, calls: jev, spentUsd: spent.jev });

// 2. Generation: same brief, tools off, one attempt per tier.
const gen = {};
for (const tier of GEN_ORDER) {
  if (!room(CAP[tier])) { gen[tier] = { skipped: 'ceiling' }; continue; }
  const r = claude(MODEL[tier], brief, CAP[tier]);
  const charged = r.cost ?? (r.ran ? CAP[tier] : 0);
  spent.generation += charged;
  gen[tier] = { label: LABEL[tier], model: MODEL[tier], error: r.error, costUsd: r.cost, chargedUsd: charged, usage: r.usage, text: r.text };
  save(`gen-${LABEL[tier]}-${tier}.json`, gen[tier]);
  if (r.text) save(`answer-${LABEL[tier]}.md`, r.text);
}

// 3. Grading: one fresh Sonnet session per answer, rubric and task only, no tier name.
const grades = {};
for (const tier of GEN_ORDER) {
  const g = gen[tier];
  if (!g || g.skipped || !g.text || g.error) { grades[LABEL[tier]] = { skipped: g?.skipped ?? 'no answer', generationError: g?.error ?? null }; continue; }
  if (!room(CAP.grader)) { grades[LABEL[tier]] = { skipped: 'ceiling' }; continue; }
  const prompt = graderTpl.replace('<<RUBRIC>>', () => rubric).replace('<<TASK>>', () => story.task).replace('<<ANSWER>>', () => g.text);
  const r = claude(MODEL[GRADER], prompt, CAP.grader);
  const charged = r.cost ?? (r.ran ? CAP.grader : 0);
  spent.grading += charged;
  let parsed = null, parseError = null;
  try { parsed = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)); } catch (x) { parseError = String(x.message).slice(0, 120); }
  grades[LABEL[tier]] = { grader: MODEL[GRADER], error: r.error, parseError, parsed, costUsd: r.cost, chargedUsd: charged };
  save(`grade-${LABEL[tier]}.json`, grades[LABEL[tier]]);
}

// 4. Summary. The label-to-tier map is written here, after grading, and never shown to a grader.
const summary = {
  storyId: STORY_ID,
  ceilingUsd: CEILING,
  spentUsd: { jev: spent.jev, generation: spent.generation, grading: spent.grading, total: total() },
  labelMap: LABEL,
  jevPrediction,
  generation: Object.fromEntries(GEN_ORDER.map((t) => [t, { label: LABEL[t], costUsd: gen[t]?.costUsd ?? null, chargedUsd: gen[t]?.chargedUsd ?? null, error: gen[t]?.error ?? null, skipped: gen[t]?.skipped ?? null }])),
  grading: grades,
};
save('summary.json', summary);
console.log(JSON.stringify({ spentUsd: summary.spentUsd, jevPrediction, overall: Object.fromEntries(Object.entries(grades).map(([l, g]) => [l, g.parsed?.overall ?? g.skipped ?? g.error ?? g.parseError ?? 'no grade'])) }));
