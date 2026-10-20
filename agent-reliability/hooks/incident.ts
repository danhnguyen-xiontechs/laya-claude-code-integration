// agent-reliability incidents: Rule A (recovery budget), cooperative escalation and
// NEEDS_USER, on top of the Case B records in core.ts. Pure: the hook passes `now`,
// the state and the observed facts in, and stores what comes back.
//
// Only erasable TypeScript here (Node type stripping imports this file in tests).

import type { Attempt, GuardState, Incident, IncidentState } from '../types/index.d.ts';
import { testSummaryOf } from './core.ts';
export type { Attempt, Incident, IncidentState };

export type Classification = 'PASS' | 'FAIL' | 'EXPECTED_NONZERO' | 'USER_DENIED' | 'AMBIGUOUS';

/** What a finished eligible run showed, from the runtime's own fields (docs/api-findings.md). */
export type RunView = { deny?: string; isError?: boolean; text?: string; result?: unknown };

const DENIED = /(permission|denied|doesn't want to proceed|rejected|not allowed)/i;
const TIMED_OUT = /command timed out after/i;

/**
 * `piped`: the command ended in `| tail/head/Select-Object`, so the exit code is the pipe's.
 * A non-error piped run is then judged only by the runner's own summary line, else AMBIGUOUS.
 */
export function classifyRun(ran: RunView, piped = false): { cls: Classification; reason: string } {
  if (ran.deny !== undefined) return { cls: 'AMBIGUOUS', reason: 'denied_by_hook' };
  const r = ran.result as { interrupted?: boolean; backgroundTaskId?: string; returnCodeInterpretation?: string; stdout?: string } | undefined;
  if (r && typeof r === 'object') {
    if (r.interrupted || r.backgroundTaskId) return { cls: 'AMBIGUOUS', reason: 'interrupted_or_background' };
    if (!ran.isError && typeof r.returnCodeInterpretation === 'string' && r.returnCodeInterpretation)
      return { cls: 'EXPECTED_NONZERO', reason: `runtime:${r.returnCodeInterpretation.slice(0, 40)}` };
  }
  if (!ran.isError && piped) {
    const out = ran.text ?? (r && typeof r === 'object' ? String(r.stdout ?? '') : String(ran.result ?? ''));
    const sum = testSummaryOf(out);
    if (sum === 'fail') return { cls: 'FAIL', reason: 'piped_summary_fail' };
    if (sum === 'pass') return { cls: 'PASS', reason: 'piped_summary_pass' };
    return { cls: 'AMBIGUOUS', reason: 'piped_no_summary' };
  }
  if (!ran.isError) return { cls: 'PASS', reason: 'no_error' };
  const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '');
  const code = /exit code:? (-?\d+)/i.exec(text);
  if (TIMED_OUT.test(text)) return { cls: 'AMBIGUOUS', reason: 'timeout' };
  if (!code) {
    if (DENIED.test(text)) return { cls: 'USER_DENIED', reason: 'permission' };
    if (/interrupted/i.test(text)) return { cls: 'AMBIGUOUS', reason: 'interrupted' };
    return { cls: 'AMBIGUOUS', reason: 'error_without_exit_code' };
  }
  if (Number(code[1]) === 0) return { cls: 'AMBIGUOUS', reason: 'error_with_exit_0' };
  return { cls: 'FAIL', reason: `exit_${code[1]}` };
}

// ---------------------------------------------------------------- incidents

export type IncidentOptions = { maxRecoveryStrategies: number; ttlMinutes: number };

const live = (i: Incident) => i.state !== 'CLOSED' && i.state !== 'SUPERSEDED';
export const isLive = live;

export function findIncident(s: GuardState, key: string): Incident | undefined {
  return s.incidents.find((i) => i.key === key && live(i));
}

const put = (s: GuardState, inc: Incident): GuardState =>
  ({ ...s, incidents: [...s.incidents.filter((i) => i.id !== inc.id), inc].slice(-40) });

export function pruneIncidents(s: GuardState, now: number, o: IncidentOptions): GuardState {
  const ttl = o.ttlMinutes * 60_000;
  return { ...s, incidents: s.incidents.filter((i) => now - i.updatedAt <= ttl).slice(-40) };
}

/** A mutation seen in `agent`'s loop: logged on each live incident of that agent. */
export function onMutation(s: GuardState, agent: string, what: string): GuardState {
  const label = what.slice(0, 120);
  let changed = false;
  const incidents = s.incidents.map((i) => {
    if (!live(i) || i.agent !== agent || i.pending.includes(label)) return i;
    changed = true;
    return { ...i, pending: [...i.pending, label].slice(-20) };
  });
  return changed ? { ...s, incidents } : s;
}

export type FailFacts = {
  key: string; agent: string; action: string; errorKey: string; summary: string; epoch: number; token: string | null; now: number;
  /** 0.3: streak incidents (non-verification keys) and the attempt as the advisor sees it. */
  kind?: 'verify' | 'streak';
  attempt?: Omit<Attempt, 'changes'>;
};

const withAttempt = (prior: Incident | undefined, f: FailFacts): Attempt[] | undefined =>
  f.attempt ? [...(prior?.attempts ?? []), { ...f.attempt, changes: prior?.pending.slice(-5) ?? [] }].slice(-4) : prior?.attempts;

export type Transition = { s: GuardState; inc: Incident; event: string };

/**
 * An eligible verification FAILED. Opens an incident or advances it: a fail after
 * mutations is one more recovery strategy (Rule A); the baseline (epoch + token)
 * is always refreshed so Case B can recognise a new loop after a change.
 */
export function onFail(s: GuardState, f: FailFacts, o: IncidentOptions): Transition {
  const prior = findIncident(s, f.key);
  if (!prior) {
    // A prompt ended this key's NEEDS_USER: that answer gets one attempt (budget 1), no new loop.
    const afterNeedsUser = s.needsUserKeys.includes(f.key);
    const inc: Incident = {
      id: `inc-${s.nextIncident}`, key: f.key, agent: f.agent, action: f.action, state: afterNeedsUser ? 'NEEDS_USER' : 'OPEN',
      fails: 1, strategies: [], pending: [], errorKey: f.errorKey, summary: f.summary,
      baseEpoch: f.epoch, baseToken: f.token, openedAt: f.now, updatedAt: f.now,
      kind: f.kind ?? 'verify', attempts: withAttempt(undefined, f), ...(afterNeedsUser ? { afterNeedsUser: true } : {}),
    };
    return { s: put({ ...s, nextIncident: s.nextIncident + 1 }, inc), inc, event: afterNeedsUser ? 'needs_user:after_prompt' : 'incident_opened' };
  }
  const strategies = prior.pending.length
    ? [...prior.strategies, { changes: prior.pending, errorKey: f.errorKey, summary: f.summary }].slice(-10)
    : prior.strategies;
  let inc: Incident = {
    ...prior, fails: prior.fails + 1, strategies, pending: [], errorKey: f.errorKey, summary: f.summary,
    baseEpoch: f.epoch, baseToken: f.token, updatedAt: f.now, attempts: withAttempt(prior, f),
  };
  let event = prior.pending.length ? 'strategy_failed' : 'repeat_failed';
  if (inc.state === 'OPEN' && (inc.kind ?? 'verify') === 'verify' && strategies.length >= o.maxRecoveryStrategies) {
    inc = { ...inc, state: 'ESCALATION_REQUESTED' };
    event = 'escalation_due';
  } else if (inc.state === 'ESCALATION_REQUESTED' && !inc.recoveryAgentId) {
    // The main loop kept verifying on its own instead of starting recovery.
    inc = { ...inc, state: 'NEEDS_USER' };
    event = 'needs_user:recovery_not_started';
  } else if (inc.state === 'ESCALATED') {
    if (inc.recoveryDone) { inc = { ...inc, state: 'NEEDS_USER' }; event = 'needs_user:recovery_failed'; }
    else event = 'recovery_in_progress';
  }
  return { s: put(s, inc), inc, event };
}

export function onPass(s: GuardState, key: string, now: number): Transition | null {
  const s1 = s.needsUserKeys.includes(key) ? { ...s, needsUserKeys: s.needsUserKeys.filter((k) => k !== key) } : s;
  const prior = findIncident(s1, key);
  if (!prior) return s1 === s ? null : { s: s1, inc: { key } as Incident, event: 'needs_user_key_cleared' };
  const inc: Incident = { ...prior, state: 'CLOSED', resolution: 'pass', updatedAt: now };
  return { s: put(s1, inc), inc, event: 'incident_closed' };
}

/** The recovery agent was spawned: runtime evidence for ESCALATED. Picks the newest waiting incident. */
export function onRecoveryStarted(s: GuardState, agent: string, recoveryAgentId: string, background: boolean, now: number): Transition | null {
  const waiting = s.incidents.filter((i) => i.state === 'ESCALATION_REQUESTED' && i.agent === agent).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!waiting) return null;
  const inc: Incident = { ...waiting, state: 'ESCALATED', recoveryAgentId, recoveryBackground: background, recoveryDone: false, updatedAt: now };
  return { s: put(s, inc), inc, event: 'escalation_started' };
}

export function onRecoveryDone(s: GuardState, recoveryAgentId: string, now: number): Transition | null {
  const inc0 = s.incidents.find((i) => i.recoveryAgentId === recoveryAgentId && i.state === 'ESCALATED');
  if (!inc0 || inc0.recoveryDone) return null;
  const inc: Incident = { ...inc0, recoveryDone: true, updatedAt: now };
  return { s: put(s, inc), inc, event: 'recovery_done' };
}

/**
 * A new user prompt ends the wait, never the question: every live incident except a running
 * recovery (ESCALATED) becomes SUPERSEDED with `resolution: prompt_received` (never "approved").
 * A key that was NEEDS_USER is remembered: its next incident gets budget 1 (onFail).
 */
export function onUserPrompt(s: GuardState, now: number): GuardState {
  const ending = s.incidents.filter((i) => live(i) && i.state !== 'ESCALATED');
  if (!ending.length) return s;
  const nu = ending.filter((i) => i.state === 'NEEDS_USER').map((i) => i.key);
  return {
    ...s,
    needsUserKeys: [...new Set([...s.needsUserKeys, ...nu])].slice(-50),
    incidents: s.incidents.map((i) => (ending.includes(i) ? { ...i, state: 'SUPERSEDED' as const, resolution: 'prompt_received', updatedAt: now } : i)),
  };
}

// ---------------------------------------------------------------- before a verification

export type Gate =
  | { kind: 'none' }
  | { kind: 'escalate'; inc: Incident }
  | { kind: 'needs_user'; inc: Incident }
  | { kind: 'hold'; inc: Incident }; // 0.3: BLOCKED / STOPPED (applied Jev decisions)

/** Gate for a call on an incident's key (Rule A, and applied Jev decisions). */
export function gateBefore(s: GuardState, key: string): Gate {
  const inc = findIncident(s, key);
  if (!inc) return { kind: 'none' };
  if (inc.state === 'NEEDS_USER') return { kind: 'needs_user', inc };
  if (inc.state === 'ESCALATION_REQUESTED') return { kind: 'escalate', inc };
  if (inc.state === 'BLOCKED' || inc.state === 'STOPPED') return { kind: 'hold', inc };
  return { kind: 'none' };
}

/** BLOCKED lifts when the state changed since the decision (an edit, a mutating command). */
export function liftBlocked(s: GuardState, key: string, epoch: number, now: number): GuardState {
  const inc = findIncident(s, key);
  if (!inc || inc.state !== 'BLOCKED' || inc.baseEpoch === epoch) return s;
  return put(s, { ...inc, state: 'OPEN', decidedBy: undefined, updatedAt: now });
}

/** Store an incident as given (the advisor's applied decisions). */
export const putIncident = put;

/** Second attempt to verify while escalation is still only requested: the main loop is not escalating. */
export function onEscalationIgnored(s: GuardState, key: string, now: number): Transition | null {
  const inc0 = findIncident(s, key);
  if (!inc0 || inc0.state !== 'ESCALATION_REQUESTED' || !inc0.escalationDenied) return null;
  const inc: Incident = { ...inc0, state: 'NEEDS_USER', updatedAt: now };
  return { s: put(s, inc), inc, event: 'needs_user:recovery_not_started' };
}

export function markEscalationDenied(s: GuardState, key: string, now: number): GuardState {
  const inc = findIncident(s, key);
  return inc ? put(s, { ...inc, escalationDenied: true, updatedAt: now }) : s;
}

// ---------------------------------------------------------------- texts

export const RECOVERY_AGENT = 'opus-recovery';

export function escalationText(inc: Incident, pluginName: string): string {
  const tried = inc.strategies.map((st, n) => `  ${n + 1}. changed ${st.changes.join(', ')} → still failed (${st.errorKey}: "${st.summary}")`).join('\n');
  return [
    `Escalation requested (agent-reliability, ${inc.id}): \`${inc.action}\` still fails after ${inc.strategies.length} different recovery attempts.`,
    'Do not run it again unchanged and do not start a third attempt yourself. Call the Agent tool with',
    `subagent_type "${pluginName}:${RECOVERY_AGENT}" and a prompt that contains the block below, then rerun the verification once after it returns.`,
    'If you cannot or should not escalate, stop and ask the user how to proceed.',
    '--- incident ---',
    `objective: make \`${inc.action}\` pass`,
    `last failure: ${inc.errorKey} "${inc.summary}"`,
    'attempts so far:', tried || '  (none recorded)',
    `verify with: ${inc.action}`,
  ].join('\n');
}

export function needsUserText(inc: Incident): string {
  const why = inc.recoveryDone ? 'the Opus recovery attempt finished and it still fails' : 'escalation was requested but no recovery agent was started';
  return `Blocked (agent-reliability, ${inc.id}): \`${inc.action}\` needs the user's decision: ${why} `
    + `(last failure ${inc.errorKey}: "${inc.summary}"). Stop retrying. Explain what was tried and ask the user how to proceed. `
    + 'The next user message re-opens it; /reliability observe or /reliability reset also lift it.';
}

export const RECOVERY_PROMPT = `You are a recovery engineer brought in after a coding agent failed to make a verification command pass.
The task prompt gives the objective, the failing command, the last error and the attempts already made.
1. Read the relevant code, configuration and logs first. Find the root cause before changing anything.
2. Do not repeat an attempt listed as already tried; choose a substantiated, different approach.
3. Make the smallest change that fixes the root cause, then run the verification command once.
4. Report: root cause, what you changed (files), the verification command and its actual result.
If the fix needs a user decision (credentials, product choice, destructive action), stop and say so instead of guessing.
Never claim success without the verification output.`;
