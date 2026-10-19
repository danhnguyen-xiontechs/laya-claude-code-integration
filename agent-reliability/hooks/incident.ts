// agent-reliability incidents: Rule A (recovery budget), cooperative escalation and
// NEEDS_USER, on top of the Case B records in core.ts. Pure: the hook passes `now`,
// the state and the observed facts in, and stores what comes back.
//
// Only erasable TypeScript here (Node type stripping imports this file in tests).

import type { GuardState, Incident, IncidentState } from '../types/index.d.ts';
export type { Incident, IncidentState };

export type Classification = 'PASS' | 'FAIL' | 'EXPECTED_NONZERO' | 'USER_DENIED' | 'AMBIGUOUS';

/** What a finished eligible run showed, from the runtime's own fields (docs/api-findings.md). */
export type RunView = { deny?: string; isError?: boolean; text?: string; result?: unknown };

const DENIED = /(permission|denied|doesn't want to proceed|rejected|not allowed)/i;
const TIMED_OUT = /command timed out after/i;

export function classifyRun(ran: RunView): { cls: Classification; reason: string } {
  if (ran.deny !== undefined) return { cls: 'AMBIGUOUS', reason: 'denied_by_hook' };
  const r = ran.result as { interrupted?: boolean; backgroundTaskId?: string; returnCodeInterpretation?: string } | undefined;
  if (r && typeof r === 'object') {
    if (r.interrupted || r.backgroundTaskId) return { cls: 'AMBIGUOUS', reason: 'interrupted_or_background' };
    if (!ran.isError && typeof r.returnCodeInterpretation === 'string' && r.returnCodeInterpretation)
      return { cls: 'EXPECTED_NONZERO', reason: `runtime:${r.returnCodeInterpretation.slice(0, 40)}` };
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

const live = (i: Incident) => i.state !== 'CLOSED';

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

export type FailFacts = { key: string; agent: string; action: string; errorKey: string; summary: string; epoch: number; token: string | null; now: number };

export type Transition = { s: GuardState; inc: Incident; event: string };

/**
 * An eligible verification FAILED. Opens an incident or advances it: a fail after
 * mutations is one more recovery strategy (Rule A); the baseline (epoch + token)
 * is always refreshed so Case B can recognise a new loop after a change.
 */
export function onFail(s: GuardState, f: FailFacts, o: IncidentOptions): Transition {
  const prior = findIncident(s, f.key);
  if (!prior) {
    const inc: Incident = {
      id: `inc-${s.nextIncident}`, key: f.key, agent: f.agent, action: f.action, state: 'OPEN',
      fails: 1, strategies: [], pending: [], errorKey: f.errorKey, summary: f.summary,
      baseEpoch: f.epoch, baseToken: f.token, openedAt: f.now, updatedAt: f.now,
    };
    return { s: put({ ...s, nextIncident: s.nextIncident + 1 }, inc), inc, event: 'incident_opened' };
  }
  const strategies = prior.pending.length
    ? [...prior.strategies, { changes: prior.pending, errorKey: f.errorKey, summary: f.summary }].slice(-10)
    : prior.strategies;
  let inc: Incident = {
    ...prior, fails: prior.fails + 1, strategies, pending: [], errorKey: f.errorKey, summary: f.summary,
    baseEpoch: f.epoch, baseToken: f.token, updatedAt: f.now,
  };
  let event = prior.pending.length ? 'strategy_failed' : 'repeat_failed';
  if (inc.state === 'OPEN' && strategies.length >= o.maxRecoveryStrategies) {
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
  const prior = findIncident(s, key);
  if (!prior) return null;
  const inc: Incident = { ...prior, state: 'CLOSED', updatedAt: now };
  return { s: put(s, inc), inc, event: 'incident_closed' };
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

/** A new user prompt: NEEDS_USER incidents have had their answer; close them. */
export function onUserPrompt(s: GuardState, now: number): GuardState {
  if (!s.incidents.some((i) => i.state === 'NEEDS_USER')) return s;
  return { ...s, incidents: s.incidents.map((i) => (i.state === 'NEEDS_USER' ? { ...i, state: 'CLOSED' as const, updatedAt: now } : i)) };
}

// ---------------------------------------------------------------- before a verification

export type Gate =
  | { kind: 'none' }
  | { kind: 'escalate'; inc: Incident }
  | { kind: 'needs_user'; inc: Incident };

/** Rule A gate for an eligible verification about to run. */
export function gateBefore(s: GuardState, key: string): Gate {
  const inc = findIncident(s, key);
  if (!inc) return { kind: 'none' };
  if (inc.state === 'NEEDS_USER') return { kind: 'needs_user', inc };
  if (inc.state === 'ESCALATION_REQUESTED') return { kind: 'escalate', inc };
  return { kind: 'none' };
}

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
