#!/usr/bin/env node
// Optional JEV advice at three points of a v2 run: intake (stage 01-intake: plan model for 02-plan), recovery
// (stage 04-test: approach before the Sonnet retry) and triage (stage 05-review: severity of a finding). Advisory only: the baseline is used when JEV is off
// (HAIKU_BUILD_JEV=off; default apply), throws, errors, takes over 3000 ms, answers below confidence 0.8,
// answers outside the choices, or after 3 calls in the run. At triage the advice can only keep or raise a
// severity. JEV never sets the run status: the result has no status field and status.mjs takes no JEV input.
//
// Usage: node jev_advice.mjs <runDir> <intake|recovery|triage> <baseline> <choice,choice,...> [--state "<text>"]
//   Calls JEV through ../../subagent-model-router/scripts/decision-provider.mjs (provider jev, needs
//   OPENROUTER_API_KEY), appends the advice to manifest.jev.calls and prints one JSON line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const POINTS = ['intake', 'recovery', 'triage'];
export const MIN_CONFIDENCE = 0.8;
export const TIMEOUT_MS = 3000;
export const MAX_CALLS = 3;
export const SEVERITY_ORDER = ['Minor', 'Major'];

/** apply (default) or off. Only HAIKU_BUILD_JEV=off turns JEV off. */
export function jevMode(env = process.env) {
  return String(env.HAIKU_BUILD_JEV ?? 'apply').trim().toLowerCase() === 'off' ? 'off' : 'apply';
}

const labelsOf = (choices) => (Array.isArray(choices) ? choices : Object.keys(choices ?? {}));

/** Default ask: one JEV choice question through decide(); returns { label, confidence } or throws. */
export async function askJev({ state, choices, question, env = process.env, timeoutMs = TIMEOUT_MS }) {
  const { decide, top } = await import('../../subagent-model-router/scripts/decision-provider.mjs');
  const criteria = Array.isArray(choices) ? Object.fromEntries(choices.map((c) => [c, c])) : choices;
  const r = await decide({
    provider: 'jev', env, timeoutMs,
    state: { text: String(state ?? '') },
    questions: { pick: { type: 'choice', instructions: question ?? 'Which choice fits best?', criteria } },
  });
  if (!r.ok) throw new Error(r.error);
  const ans = r.answers?.pick ?? {};
  const t = top(ans.probabilities);
  return { label: t.label, confidence: ans.confidence ?? t.p };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One advice. Never throws. `used` is the number of JEV calls already made in this run.
 * Returns { point, choice, source: 'jev' | 'baseline', called, reason, confidence, used }.
 */
export async function advise({
  point, baseline, choices, state = '', question, used = 0,
  env = process.env, ask = askJev, timeoutMs = TIMEOUT_MS,
}) {
  const base = (reason, extra = {}) => ({ point, choice: baseline, source: 'baseline', called: false, reason, confidence: null, used, ...extra });
  if (!POINTS.includes(point)) return base(`point "${point}" not allowed`);
  if (jevMode(env) === 'off') return base('off');
  if (used >= MAX_CALLS) return base(`call limit ${MAX_CALLS} reached`);
  const labels = labelsOf(choices);
  const after = used + 1;
  let a;
  try {
    a = await withTimeout(Promise.resolve().then(() => ask({ point, state, choices, question, env, timeoutMs })), timeoutMs);
  } catch (err) {
    const msg = String(err?.message ?? err).split('\n')[0].slice(0, 120);
    return base(msg === 'timeout' ? `timeout ${timeoutMs} ms` : `error: ${msg}`, { called: true, used: after });
  }
  const confidence = typeof a?.confidence === 'number' ? a.confidence : null;
  const called = { called: true, used: after, confidence };
  if (confidence == null || confidence < MIN_CONFIDENCE) return base(`low confidence ${confidence ?? 'none'}`, called);
  if (!labels.includes(a.label)) return base(`not a choice: ${a.label}`, called);
  if (point === 'triage' && SEVERITY_ORDER.indexOf(a.label) < SEVERITY_ORDER.indexOf(baseline)) {
    return base(`would lower severity ${baseline} -> ${a.label}`, called);
  }
  return { point, choice: a.label, source: 'jev', called: true, reason: 'confident', confidence, used: after };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--state');
  const state = si >= 0 ? args.splice(si, 2)[1] : '';
  const [runDir, point, baseline, list] = args;
  if (!runDir || !point || !baseline || !list) {
    console.log('usage: node jev_advice.mjs <runDir> <intake|recovery|triage> <baseline> <choice,choice,...> [--state "<text>"]');
    process.exit(2);
  }
  const mf = path.join(runDir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const calls = m.jev?.calls ?? [];
  const used = calls.filter((c) => c.called).length;
  const r = await advise({ point, baseline, choices: list.split(',').map((s) => s.trim()).filter(Boolean), state, used });
  const { used: _u, ...entry } = r;
  m.jev = { mode: jevMode(), calls: [...calls, { ...entry, at: new Date().toISOString() }] };
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  console.log(JSON.stringify(entry));
}
