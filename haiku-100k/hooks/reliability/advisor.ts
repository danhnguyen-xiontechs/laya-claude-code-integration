// Shipped copy of agent-reliability/hooks/advisor.ts (scripts/ship-haiku-100k.mjs). Edit the source, not this file.
// agent-reliability 0.3: Rule C (refusal loops), the Jev Recovery Advisor contract (request,
// parse, applyDecision) and the sanitized dataset record. Pure, like core.ts: the hook passes
// the facts in and stores what comes back. The core owns every limit; Jev picks a direction.
//
// Only erasable TypeScript here (Node type stripping imports this file in tests).

import type { Attempt, GuardState, Incident, IncidentState, NextAction, Refusal, RefusalKind } from './types.d.ts';
import { type ChoiceAnswer, fnv, normalizeCommand, parseAnswers, similarity, unwrapCommand } from './core.ts';
import { redact } from './redact.ts';
export type { NextAction, Refusal, RefusalKind };
export { redact };

// ---------------------------------------------------------------- Rule C: refusals

// Order matters: an approval refusal ("…the following part requires approval") is about the
// action, so a new form will not help; a form refusal is about the spelling of the call.
const USER_DENIED = /doesn't want to proceed|tool use was rejected|has been denied|denied by the Claude Code auto mode classifier|Permission for this action was denied|user (denied|rejected)/i;
const NEEDS_APPROVAL = /requires? approval|needs approval|requested permissions to (write|edit|read|use)|was blocked\. For security|may only access files in the allowed working director/i;
const BAD_FORM = /contains multiple operations|Compound command|isolated in the (git )?worktree|has not been read yet|Contains simple_expansion|modifies environment variables|dynamic expression|Blocked: sleep|changes? (the )?working directory/i;

export type RefusalView = { kind: RefusalKind; form: boolean } | null;

/** A refusal read from an errored result with no `Exit code N` line (docs/api-findings.md). */
export function refusalOf(isError: boolean, text: string): RefusalView {
  if (!isError) return null;
  const t = String(text ?? '').slice(0, 3000);
  if (/^\s*exit code:? -?\d+/i.test(t)) return null;
  if (USER_DENIED.test(t)) return { kind: 'user_denied', form: false };
  if (NEEDS_APPROVAL.test(t)) return { kind: 'harness_refusal', form: false };
  if (BAD_FORM.test(t)) return { kind: 'harness_refusal', form: true };
  return null;
}

/** File key: one spelling per file (slashes, Git Bash /c/ drives, case on Windows). */
export function fileKey(p: string): string {
  let s = String(p ?? '').trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/\/+$/, '');
  s = s.replace(/^\/([a-z])\//i, '$1:/');
  if (/^[a-z]:\//i.test(s)) s = s.toLowerCase();
  return `file:${s}`;
}

/** The one file a simple shell write targets (`> f`, `>> f`, Out-File/Set-Content/Add-Content f); else null. */
export function writeTargetOf(command: string): string | null {
  const c = String(command ?? '').trim();
  if (/[|;&`]|\$\(/.test(c.replace(/2>&1/g, ''))) return null;
  const m = /^[^<>]*?(?:[^2>]>>?|\b(?:Out-File|Set-Content|Add-Content)\s+(?:-(?:File)?Path\s+)?)\s*("[^"]+"|'[^']+'|[^\s"'<>]+)\s*$/i.exec(c);
  return m && m[1] ? m[1].replace(/^["']|["']$/g, '') : null;
}

export type CallView = { tool: string; command?: string; path?: string; scope: string };
export type CallKeys = { core?: string; raw?: string; file?: string; target?: string; label: string };

/** The keys Rule C compares: the unwrapped command (Bash and PS share it), the form, the file. */
export function callKeys(c: CallView): CallKeys {
  if (typeof c.command === 'string') {
    const u = unwrapCommand(c.command);
    const where = u.cdPath ? `${c.scope}>${u.cdPath}` : c.scope;
    const t = writeTargetOf(c.command);
    return { core: `cmd:${where}::${u.core}`, raw: normalizeCommand(c.command), ...(t ? { target: fileKey(t) } : {}), label: `\`${u.core.slice(0, 100)}\`` };
  }
  const f = fileKey(c.path ?? '');
  return { file: f, label: `${c.tool} on ${f.slice(5).split('/').slice(-3).join('/')}` };
}

const liveRefusal = (r: Refusal, now: number, ttlMs: number) =>
  r.kind === 'user_denied' ? !r.lifted : now - r.at <= ttlMs;

/**
 * The refusal this call would repeat, user denials first. A user denial matches the same
 * action by any tool: Edit/Write/NotebookEdit on its file (and a simple shell write to it),
 * Bash/PS on its command. A harness refusal matches its action (needs approval) or a
 * near-identical form (form refused).
 */
export function matchRefusal(s: GuardState, k: CallKeys, now: number, ttlMs: number): Refusal | null {
  const live = s.refusals.filter((r) => liveRefusal(r, now, ttlMs));
  // A user denial is about the action itself: the command after any `cd`, wherever it runs.
  const bare = (core: string) => core.slice(core.indexOf('::') + 2);
  const hit = (r: Refusal): boolean => {
    if (r.file) return k.file === r.file || (r.kind === 'user_denied' && k.target === r.file);
    if (!r.core || !k.core) return false;
    if (r.kind === 'user_denied') return bare(k.core) === bare(r.core) || (!!k.raw && !!r.raw && similarity(k.raw, r.raw) >= 0.8);
    if (!r.form) return k.core === r.core || (!!k.raw && !!r.raw && similarity(k.raw, r.raw) >= 0.8);
    return !!k.raw && !!r.raw && (k.raw === r.raw || similarity(k.raw, r.raw) >= 0.8);
  };
  return live.find((r) => r.kind === 'user_denied' && hit(r)) ?? live.find((r) => r.kind === 'harness_refusal' && hit(r)) ?? null;
}

export function recordRefusal(s: GuardState, v: NonNullable<RefusalView>, agent: string, tool: string, k: CallKeys, now: number): { s: GuardState; r: Refusal } {
  const r: Refusal = {
    n: s.nextRefusal, kind: v.kind, form: v.form, agent, tool, label: k.label, at: now,
    ...(k.core ? { core: k.core } : {}), ...(k.raw ? { raw: k.raw } : {}), ...(k.file ? { file: k.file } : {}),
  };
  const streak = (s.refusalStreak[agent] ?? 0) + 1;
  return { s: { ...s, nextRefusal: s.nextRefusal + 1, refusals: [...s.refusals, r].slice(-60), refusalStreak: { ...s.refusalStreak, [agent]: streak } }, r };
}

/** A non-refused result: the agent's refusal streak ends; a success clears harness refusals of that action. */
export function onNotRefused(s: GuardState, agent: string, k: CallKeys, ok: boolean): GuardState {
  const streak = s.refusalStreak[agent] ? { ...s.refusalStreak, [agent]: 0 } : s.refusalStreak;
  const refusals = ok
    ? s.refusals.filter((r) => r.kind !== 'harness_refusal' || !((r.core && r.core === k.core) || (r.file && r.file === k.file)))
    : s.refusals;
  return streak === s.refusalStreak && refusals.length === s.refusals.length ? s : { ...s, refusalStreak: streak, refusals };
}

/** /reliability allow <n|all>: the user's explicit act; nothing else lifts a user denial. */
export function liftDenials(s: GuardState, which: string): { s: GuardState; lifted: number[] } {
  const all = which.trim() === 'all';
  const n = Number(which);
  const lifted: number[] = [];
  const refusals = s.refusals.map((r) => {
    if (r.kind !== 'user_denied' || r.lifted || !(all || r.n === n)) return r;
    lifted.push(r.n);
    return { ...r, lifted: true };
  });
  return { s: { ...s, refusals }, lifted };
}

export function refusalText(r: Refusal, streak: number): string {
  const tail = streak >= 3 ? ' This agent has been refused several times in a row: stop retrying and report what is blocked to the user (or, in a subagent, to the parent agent).' : '';
  if (r.kind === 'user_denied')
    return `Blocked (agent-reliability, Rule C): the user denied ${r.label} earlier in this session (#${r.n}). `
      + 'Do not retry it with another tool, shell, path or wording. Ask the user whether to do it; if they agree, '
      + `they lift this block with /reliability allow ${r.n} (the normal permission prompt still applies).${tail}`;
  if (!r.form)
    return `Blocked (agent-reliability, Rule C): the harness refused ${r.label} because it needs approval; another form of the same action `
      + `is refused the same way. Take a different approach, or ask the user to approve it.${tail}`;
  return `Blocked (agent-reliability, Rule C): the harness refused this form of ${r.label}. Do not resend it; change the approach `
    + `(split the command, run it from the right folder without cd, Read the file first, stay inside your worktree).${tail}`;
}

// ---------------------------------------------------------------- streak keys

/** The incident key of a non-verification failure: the command family (2 tokens) or the file. */
export function streakKey(scope: string, k: CallKeys): string {
  if (k.file) return `${scope}::~${k.file}`;
  const core = (k.core ?? '').replace(/^cmd:/, '');
  const [where = '', cmd = ''] = core.split('::');
  return `${scope}::~${where === scope ? '' : `${where}>`}${cmd.split(' ').slice(0, 2).join(' ')}`;
}

// ---------------------------------------------------------------- Jev Recovery Advisor

export const FAILURE_KINDS = ['real_failure', 'informational_nonzero', 'harness_refusal', 'user_refusal', 'agent_mistake', 'environment_or_external'] as const;
export const NEXT_ACTIONS = ['RETRY_NEW_STRATEGY', 'ESCALATE_MODEL', 'ASK_USER', 'MARK_BLOCKED', 'STOP_AND_REPORT'] as const;

/**
 * 0.4: Jev answers narrow yes/no judgments; `decideNext` (code) turns them into one action.
 * The 0.3 single `next_step` choice said RETRY_NEW_STRATEGY on 20 of 23 real incidents, also when
 * `same_approach` was ≥0.85, and nothing combined the two.
 */
export const SIGNALS = ['same_cause', 'same_approach', 'needs_user', 'outside_agent', 'stuck_on_code', 'optional_step'] as const;
export type Signal = typeof SIGNALS[number];

const SPEC = { failure_kind: FAILURE_KINDS, ...Object.fromEntries(SIGNALS.map((s) => [s, 'noul'])) } as Record<string, readonly string[] | 'noul'>;

/** What the error shows, for Jev: runners print the cause last (assertion, summary), so keep the head and the tail. */
export function errorExcerpt(text: string, head = 160, tail = 440): string {
  const t = redact(text);
  return t.length <= head + tail + 5 ? t : `${t.slice(0, head)} … ${t.slice(-tail)}`;
}

export type AdvisorContext = { subagent: boolean; strategiesUsed: number; maxStrategies: number; stateChangedSinceLast: boolean; prompt?: string };

/**
 * One request over the same redacted incident: the failure kind plus the SIGNALS nouls, asked
 * together. Observed facts (error fingerprint repeated, changes made) go in the state as facts;
 * Jev judges only what code cannot. Every free-text field goes through the shared redact policy.
 */
export function advisorRequest(inc: Incident, ctx: AdvisorContext) {
  const atts = inc.attempts ?? [];
  return {
    state: {
      agent: ctx.subagent ? 'subagent' : 'main agent',
      ...(ctx.prompt ? { user_request: redact(ctx.prompt, 300) } : {}),
      failing_action: redact(inc.action, 160),
      consecutive_failures: inc.fails,
      attempts: atts.map((a: Attempt, i: number) => ({
        tool: a.tool, action: redact(a.action, 220), error: redact(a.error, 620), changes_made_before: (a.changes ?? []).map((c) => redact(c, 160)),
        ...(i > 0 && a.errorKey && atts[i - 1]?.errorKey ? { error_identical_to_previous: a.errorKey === atts[i - 1]?.errorKey } : {}),
      })),
      state_changed_since_last_failure: ctx.stateChangedSinceLast,
      recovery_budget: { strategies_used: ctx.strategiesUsed, max: ctx.maxStrategies },
    },
    questions: {
      failure_kind: {
        type: 'choice',
        instructions: 'Look at the last entry of `attempts` (the most recent failed tool call and its error text). What kind of failure is it?',
        criteria: {
          real_failure: 'The command ran and reported a genuine problem in the code or task: a failing test, a compile/type error, a runtime exception in the project code, a wrong result.',
          informational_nonzero: 'A nonzero exit that is normal and carries the answer: grep/rg found no match, diff found differences, where/which/test returned false, a check printed what it found.',
          harness_refusal: 'The agent harness refused or blocked the call instead of running it: needs approval, compound command not allowed, blocked sleep, a hook denied it, wrong tool parameters, file not read yet.',
          user_refusal: 'The user rejected the tool call or said not to proceed.',
          agent_mistake: 'The agent made a mechanical mistake in the call itself: wrong path, wrong shell syntax or quoting for this shell, command not installed, wrong flag, edit string not found.',
          environment_or_external: 'Something outside the code: network, rate limit, timeout, missing credentials or login, service down, browser/page not ready, an OS permission.',
        },
      },
      same_cause: {
        type: 'noul',
        instructions: 'Compare the error of the last entry of `attempts` with the error of the entry before it. Do both fail for the same underlying cause?',
        criteria: {
          true: 'The same root problem: the same failing test or assertion, the same missing file, symbol, module or command, the same rejected parameter. Different line numbers, timestamps, paths or wording still count as the same cause.',
          false: 'A different problem: the earlier error is gone and a new one appears (for example the build now passes and a test fails, or a different test or file fails), or the attempts are about different things.',
        },
      },
      same_approach: {
        type: 'noul',
        instructions: 'Across `attempts` and the `changes_made_before` of each, is the agent repeating the same approach rather than trying a materially different one?',
        criteria: {
          true: 'The same command or the same idea again, with trivial changes: other quoting, flags that do not touch the cause, a rerun after edits unrelated to the error.',
          false: 'Each attempt tries something materially different aimed at the error: another tool or command, a fix to the code or path the error names, a different hypothesis.',
        },
      },
      needs_user: {
        type: 'noul',
        instructions: 'Does getting past this failure need something only the user can give?',
        criteria: {
          true: 'An approval or permission, credentials or a login, a decision about the product or the task, or a fix on the machine or account only the user can make.',
          false: 'The agent can get past it with its own tools and the information it has, or the blocker is an outside service the user cannot fix either.',
        },
      },
      outside_agent: {
        type: 'noul',
        instructions: 'Is the failure caused by something outside the code and outside the agent\'s control right now, so that retrying soon will not help?',
        criteria: {
          true: 'A service down or unreachable, network or DNS failure, rate limit or quota, a missing remote resource, a broken upstream dependency, a timeout of an outside system.',
          false: 'The cause is in the code, the command, the path, the local setup the agent can change, or it is not clear from the errors.',
        },
      },
      stuck_on_code: {
        type: 'noul',
        instructions: 'Is this a genuine problem in the project code or design (failing tests, compile or type errors, wrong results) that the agent has already attacked with materially different attempts without getting closer?',
        criteria: {
          true: 'A real code failure, at least two different attempts at it, and the errors show no progress toward the cause.',
          false: 'Not a code problem (a mechanical mistake, environment, permission), or the agent has not yet really tried, or the errors show progress.',
        },
      },
      optional_step: {
        type: 'noul',
        instructions: 'Is the failing step optional for the task: informational, a probe, a poll, or a check whose failure the task can live with?',
        criteria: {
          true: 'A lookup that found nothing, a status poll, an optional lint or cleanup, a probe for whether something exists, a nonzero exit that carries the answer.',
          false: 'The task needs this step to succeed: its build, tests, a required command or file change.',
        },
      },
    },
  };
}

export type Advice = { failureKind: ChoiceAnswer; sameApproach: number; signals: Record<Signal, number>; nextStep: ChoiceAnswer };

/** The SIGNALS → one action, in code (the policy is here, not in a Jev prompt). `NO_ACTION`: the agent is making progress, say nothing. */
export function decideNext(sig: Record<Signal, number>, t: number, strategiesUsed: number, h: { headless?: boolean; maxStrategies?: number } = {}): ChoiceAnswer {
  const pick = (choice: string, p: number): ChoiceAnswer => ({ choice, p, probabilities: { ...sig } });
  // Headless (an xt-factory agent, nobody to answer): asking is the last resort. While recovery budget is
  // left and the need for the user is not clear-cut, the agent gets a recovery note and tries again.
  if (sig.needs_user >= t && h.headless && sig.needs_user < USER_ONLY && strategiesUsed < (h.maxStrategies ?? 2)) return pick('RECOVER_BEFORE_ASKING', sig.needs_user);
  if (sig.needs_user >= t) return pick('ASK_USER', sig.needs_user);
  if (sig.outside_agent >= t) return pick('MARK_BLOCKED', sig.outside_agent);
  if (sig.optional_step >= t) return pick('STOP_AND_REPORT', sig.optional_step);
  if (sig.stuck_on_code >= t && sig.same_cause >= t && strategiesUsed >= 1) return pick('ESCALATE_MODEL', Math.min(sig.stuck_on_code, sig.same_cause));
  if (sig.same_cause >= t && sig.same_approach >= t) return pick('RETRY_NEW_STRATEGY', Math.min(sig.same_cause, sig.same_approach));
  return pick('NO_ACTION', 1 - Math.max(sig.same_cause, sig.needs_user, sig.outside_agent, sig.optional_step));
}

/** At or above this `needs_user`, a headless agent stops and reports at once (credentials, approval, a product decision). */
export const USER_ONLY = 0.85;

export function parseAdvice(json: unknown, policy: { threshold: number; strategiesUsed: number; headless?: boolean; maxStrategies?: number } = { threshold: 0.6, strategiesUsed: 0 }): Advice | { error: string } {
  const r = parseAnswers(json, SPEC);
  if ('error' in r) return r;
  const signals = Object.fromEntries(SIGNALS.map((s) => [s, r.answers[s] as number])) as Record<Signal, number>;
  return { failureKind: r.answers.failure_kind as ChoiceAnswer, sameApproach: signals.same_approach, signals, nextStep: decideNext(signals, policy.threshold, policy.strategiesUsed, { headless: policy.headless, maxStrategies: policy.maxStrategies }) };
}

/** Whether the advisor may be asked about this incident now (states with a decision pending: no). */
export function advisorEligible(inc: Incident, binding: (inc: Incident) => boolean): boolean {
  if (inc.fails < 2 || inc.afterNeedsUser) return false;
  const pending: IncidentState[] = ['NEEDS_USER', 'ESCALATED', 'BLOCKED', 'STOPPED', 'CLOSED', 'SUPERSEDED'];
  if (pending.includes(inc.state)) return false;
  // Rule A's ESCALATION_REQUESTED binds only when Rule A enforces; otherwise it is a logged "would".
  return inc.state !== 'ESCALATION_REQUESTED' || !binding(inc);
}

export type Decision = {
  /** What the core does with the advice ('none' = v0.2 behaviour). */
  action: 'none' | NextAction;
  state?: IncidentState;
  note: string;
  reason: string;
};

/**
 * Advice → core action, inside the core's limits: below the confidence floor, past the budget,
 * or a second escalation → 'none'. Never allows anything, never closes an incident.
 */
export function applyDecision(inc: Incident, a: Advice, p: { minConfidence: number; subagent: boolean; maxStrategies: number; headless?: boolean }): Decision {
  const act = a.nextStep.choice as NextAction;
  const pr = a.nextStep.p.toFixed(2);
  const tried = (inc.attempts ?? []).map((x) => x.action.slice(0, 60)).join(' | ');
  const head = `[agent-reliability] Jev: ${act} (p=${pr}, ${a.failureKind.choice})`;
  if ((a.nextStep.choice as string) === 'NO_ACTION') return { action: 'none', note: '', reason: 'no_signal' };
  if (a.nextStep.p < p.minConfidence) return { action: 'none', note: '', reason: `low_confidence ${pr}` };
  // Headless: recover first (a retry note, a near-identical rerun refused), ask only when that is spent.
  if ((a.nextStep.choice as string) === 'RECOVER_BEFORE_ASKING') {
    if (inc.strategies.length >= p.maxStrategies) return { action: 'none', note: '', reason: 'budget_spent' };
    return {
      action: 'RETRY_NEW_STRATEGY', reason: 'recover_before_asking',
      note: `[agent-reliability] Jev: this may need the user (p=${pr}, ${a.failureKind.choice}), but nobody can answer in this unattended run. Recover first: read what the error asks for, look for a local way (a config or env value the repo documents, a test double, a different command), then try a materially different attempt. A near-identical rerun will be refused. Already tried: ${tried}`,
    };
  }
  if (act === 'ASK_USER' && p.headless)
    return { action: act, state: 'STOPPED', note: `${head}: this unattended run cannot get past it without a person. Stop working on this step now and end with a short report that starts with "needs-user:" and says what is needed, what failed and what was tried. Do not claim it works. Already tried: ${tried}`, reason: 'needs_user_headless' };
  switch (act) {
    case 'RETRY_NEW_STRATEGY':
      if (inc.strategies.length >= p.maxStrategies) return { action: 'none', note: '', reason: 'budget_spent' };
      return { action: act, note: `${head}: the last attempts fail for the same cause with the same approach. Change the approach: fix what the error names, or try a materially different command; a near-identical rerun with nothing changed will be refused. Already tried: ${tried}`, reason: 'retry' };
    case 'ESCALATE_MODEL':
      if (inc.jevEscalated) return { action: 'none', note: '', reason: 'already_escalated' };
      if (p.subagent)
        return { action: act, state: 'STOPPED', note: `${head}: stop working on this, report it to the parent agent as unresolved and recommend a stronger model. Already tried: ${tried}`, reason: 'escalate_via_parent' };
      return { action: act, state: 'ESCALATION_REQUESTED', note: `${head}: hand this to the recovery agent (see the next refusal for how).`, reason: 'escalate' };
    case 'ASK_USER':
      return { action: act, state: 'NEEDS_USER', note: `${head}: stop and ask the user how to proceed; say what failed and what was tried. Already tried: ${tried}`, reason: 'ask_user' };
    case 'MARK_BLOCKED':
      return { action: act, state: 'BLOCKED', note: `${head}: an external blocker (${a.failureKind.choice}); stop retrying this, continue with other parts of the task or report it as blocked. It is not done.`, reason: 'blocked' };
    case 'STOP_AND_REPORT':
      return { action: act, state: 'STOPPED', note: `${head}: stop automatic recovery here and report this step as unresolved, with what was tried. Do not claim it works. Already tried: ${tried}`, reason: 'stop' };
    default:
      return { action: 'none', note: '', reason: 'unknown_action' };
  }
}

/** RETRY_NEW_STRATEGY applied: a rerun near-identical to a failed attempt with nothing changed. */
export function repeatsFailedAttempt(inc: Incident, raw: string, epoch: number): boolean {
  if (!inc.retryArmed || inc.retryArmed.epoch !== epoch) return false;
  return inc.retryArmed.actions.some((x) => x === raw || similarity(x, raw) >= 0.85);
}

/** The refusal text of a BLOCKED / STOPPED incident (applied Jev decisions). */
export function holdText(inc: Incident): string {
  if (inc.state === 'BLOCKED')
    return `Blocked (agent-reliability, ${inc.id}): \`${inc.action}\` is held as BLOCKED by an external condition (last failure: "${inc.summary}"). `
      + 'Do not retry it until something changes (an edit, a fixed environment); continue with other parts of the task or report it as blocked. It is not done.';
  return `Stopped (agent-reliability, ${inc.id}): automatic recovery of \`${inc.action}\` was stopped (last failure: "${inc.summary}"). `
    + 'Report this step as unresolved with what was tried; do not claim it works. The next user message ends this hold.';
}

export function retryRepeatText(inc: Incident): string {
  return `Refused (agent-reliability, ${inc.id}): this repeats an attempt that already failed, with nothing changed since. `
    + 'The recovery advice was to change the approach: fix the cause the error shows, or try a materially different command.';
}

// ---------------------------------------------------------------- dataset record

export type DatasetEvent = {
  event: string; session: string; agent: string; tool: string; incident?: Incident;
  coreClass?: string; commandKey?: string; errorFp?: string; errorSummary?: string;
  advice?: Advice; applied?: string; outcome?: string;
};

/** One sanitized line of attempts-YYYY-MM.jsonl. No raw output, no file contents, no prompt. */
export function datasetRecord(e: DatasetEvent, now: number): Record<string, unknown> {
  const inc = e.incident;
  const last = inc?.attempts?.[inc.attempts.length - 1];
  const changes = (last?.changes ?? inc?.pending ?? []).map((c) => c.replace(/\\/g, '/').split('/').pop() ?? '').slice(0, 10);
  // The command without its folder (`cmd:<where>::<command>`), a file as its base name only.
  const key = e.commandKey ?? '';
  const bare = key.startsWith('file:') ? `file:${key.replace(/\\/g, '/').split('/').pop() ?? ''}`
    : key.includes('::') ? key.slice(key.indexOf('::') + 2) : key;
  const cmd = bare ? redact(bare, 120) : undefined;
  return {
    schema_version: '1.0',
    ts: new Date(now).toISOString(),
    session: fnv(e.session),
    incident_id: inc?.id,
    incident_kind: inc?.kind,
    state: inc?.state,
    agent: e.agent === 'main' ? 'main' : `sub-${fnv(e.agent)}`,
    tool: e.tool,
    event: e.event,
    attempt: inc?.fails,
    core_class: e.coreClass,
    command_family: cmd?.split(' ').slice(0, 2).join(' '),
    command_key: cmd,
    error_fp: e.errorFp,
    error_summary: e.errorSummary ? redact(e.errorSummary, 160) : undefined,
    strategy_changed: changes.length > 0,
    changes,
    ...(e.advice ? {
      jev_failure_kind: e.advice.failureKind.choice,
      jev_same_approach: Number(e.advice.sameApproach.toFixed(3)),
      jev_signals: Object.fromEntries(Object.entries(e.advice.signals ?? {}).map(([k, v]) => [k, Number(v.toFixed(3))])),
      jev_decision: e.advice.nextStep.choice,
      p: Number(e.advice.nextStep.p.toFixed(3)),
      jev_probabilities: Object.fromEntries(Object.entries(e.advice.nextStep.probabilities).map(([k, v]) => [k, Number(v.toFixed(3))])),
    } : {}),
    applied_action: e.applied,
    outcome: e.outcome ?? inc?.resolution,
    label_source: e.advice ? 'jev' : 'rule',
  };
}
