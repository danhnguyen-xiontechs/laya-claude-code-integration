#!/usr/bin/env node
// Routes the seven v2 stages to a model from the session's start model:
//   01-intake   main session (start model; none or unknown -> Sonnet)
//   02-plan     Opus (JEV advice at intake may pick Sonnet; logged)
//   03-implement Haiku, one Sonnet fallback
//   04-test     Haiku
//   05-review   parallel Sonnet reviewers; findings triage happens here (JEV may advise at triage)
//   06-fix      Haiku, at most one Sonnet re-review
//   07-present  main session: report and final status
// Opus is used only for the plan. Only an Opus or Fable start yields one question ("switch main session to
// Sonnet?"); a Haiku or Sonnet start keeps its model, and an unknown or missing start model runs the main
// session on Sonnet.
//
// Usage: node routing.mjs [<startModel>] [--plan-advice opus|sonnet] [--switch yes|no] [--write <runDir>]
//   Prints one JSON line { main, stages, switchQuestion }. --write stores it as manifest.routing; a switch
//   answer already stored there is kept (the question is asked and recorded once).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The seven v2 stages, in order. `runsIn`: main (the main session), or the fixed model of a subagent stage.
 * `jev`: the JEV advice point used in that stage, or null. `fallback`: the one extra model call the stage may
 * make, or null.
 */
export const STAGES = [
  { id: '01-intake', name: 'Intake', runsIn: 'main', jev: 'intake', fallback: null },
  { id: '02-plan', name: 'Plan', runsIn: 'opus', jev: null, fallback: null },
  { id: '03-implement', name: 'Implement', runsIn: 'haiku', jev: null, fallback: { model: 'sonnet', role: 'implement', max: 1 } },
  { id: '04-test', name: 'Test', runsIn: 'haiku', jev: 'recovery', fallback: null },
  { id: '05-review', name: 'Review', runsIn: 'sonnet', jev: 'triage', fallback: null },
  { id: '06-fix', name: 'Fix', runsIn: 'haiku', jev: null, fallback: { model: 'sonnet', role: 're-review', max: 1 } },
  { id: '07-present', name: 'Present', runsIn: 'main', jev: null, fallback: null },
];

export const SWITCH_QUESTION = 'switch main session to Sonnet?';
export const PLAN_MODELS = ['opus', 'sonnet'];

/** Model family of a model id or alias: haiku | sonnet | opus | fable | null. */
export function family(model) {
  const s = String(model ?? '').toLowerCase();
  for (const f of ['haiku', 'sonnet', 'opus', 'fable']) if (s.includes(f)) return f;
  return null;
}

/**
 * Routes the stages. `planAdvice` (opus|sonnet, from the JEV intake advice) may pick the plan model; anything
 * else keeps Opus. `switchAnswer` is the user's one answer to the switch question (yes moves the main session
 * to Sonnet). Returns { start, main, stages: [{ id, name, runsIn, jev, model, fallback }], switchQuestion }.
 */
export function routeStages(startModel, { planAdvice = null, switchAnswer = null } = {}) {
  const start = family(startModel);
  const asks = start === 'opus' || start === 'fable';
  let main = start === 'haiku' || start === 'sonnet' ? start : 'sonnet';
  if (asks) main = /^y(es)?$/i.test(String(switchAnswer ?? '').trim()) ? 'sonnet' : start;
  const plan = PLAN_MODELS.includes(planAdvice) ? planAdvice : 'opus';
  const stages = STAGES.map((s) => ({
    ...s,
    fallback: s.fallback ? { ...s.fallback } : null,
    model: s.id === '02-plan' ? plan : s.runsIn === 'main' ? main : s.runsIn,
  }));
  return { start, main, stages, switchQuestion: asks ? SWITCH_QUESTION : null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const planAdvice = opt('--plan-advice');
  let switchAnswer = opt('--switch');
  const runDir = opt('--write');
  const mf = runDir ? path.join(runDir, 'manifest.json') : null;
  const m = mf ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  // The switch question is asked once: an answer already in the manifest wins over a new one.
  if (m?.routing?.switchAnswer != null) switchAnswer = m.routing.switchAnswer;
  const r = routeStages(args[0], { planAdvice, switchAnswer });
  if (m) {
    m.routing = {
      start: r.start, main: r.main,
      stages: r.stages.map(({ id, model, fallback }) => ({ id, model, fallback })),
      switchQuestion: r.switchQuestion, switchAnswer: switchAnswer ?? null,
    };
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  }
  const fb = (s) => (s.fallback ? `(+${s.fallback.model} ${s.fallback.role} x${s.fallback.max})` : '');
  console.log(JSON.stringify({ main: r.main, stages: r.stages.map((s) => `${s.id}:${s.model}${fb(s)}`).join(' '), switchQuestion: r.switchQuestion }));
}
