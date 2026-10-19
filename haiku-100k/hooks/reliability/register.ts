// Shipped copy of agent-reliability/hooks/register.ts (scripts/ship-haiku-100k.mjs). Edit the source, not this file.
// agent-reliability: runtime guard against unproductive retry loops.
// Rule B (from retry-loop-breaker): a test/build command that already failed the same
//   way with nothing changed is refused (`{ deny }`) before it runs.
// Rule A: after `maxRecoveryStrategies` failed recovery attempts on one incident, the next
//   verification is refused with an instruction to call the Opus recovery agent
//   (cooperative: the mod cannot pause the main loop); unresolved → NEEDS_USER.
// Default mode `observe` logs what it would do. Every guard error lets the call run.
import type { EngineInterface, Register } from 'claude-code';
import type { GuardState, Mode } from './types.d.ts';
import {
  type Options, bashMayMutate, classify, decideBefore, denialText, emptyState, fingerprint,
  jevBlocks, jevRequest, normalizeCommand, parseJev, prune, readOptions, recordAfter, resolveMode,
  RETRY_REQUEST, upgradeState, type JevVerdict, type Outcome,
} from './core.ts';
import {
  type Classification, type Transition, classifyRun, escalationText, findIncident, gateBefore,
  markEscalationDenied, needsUserText, onEscalationIgnored, onFail, onMutation, onPass,
  onRecoveryDone, onRecoveryStarted, onUserPrompt, pruneIncidents, RECOVERY_AGENT, RECOVERY_PROMPT,
} from './incident.ts';
import { appendJsonl, gitToken, logDir, logPath } from './io.ts';

const PLUGIN = 'haiku-100k';
const GUARD = { plugin: 'haiku-100k', key: 'guard' } as const;
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';

async function load($: EngineInterface): Promise<{ s: GuardState; v: number }> {
  const { value, version } = await $.state.get(GUARD);
  return { s: upgradeState(value), v: version };
}

/** Read-modify-write with a retry on a version race. */
async function mutate($: EngineInterface, fn: (s: GuardState) => GuardState): Promise<GuardState> {
  for (let i = 0; i < 3; i++) {
    const { s, v } = await load($);
    const next = fn(s);
    const { isSet } = await $.state.set(GUARD, next, { ifVersion: v });
    if (isSet) return next;
  }
  return (await load($)).s;
}

const audit = (s: GuardState, action: string, decision: string, reason: string, jev?: string): GuardState =>
  ({ ...s, audit: [...s.audit, { t: Date.now(), action: action.slice(0, 120), decision, reason, ...(jev ? { jev } : {}) }].slice(-50) });

async function effectiveMode($: EngineInterface, o: Options, s?: GuardState): Promise<{ mode: Mode; source: string }> {
  const env = await $.env.get('AGENT_RELIABILITY').catch(() => undefined);
  const st = s ?? (await load($)).s;
  return resolveMode(env ?? undefined, st.modeOverride, o.mode);
}

/** One telemetry line; never throws, never logs tool output beyond a 200-char summary. */
async function emit($: EngineInterface, o: Options, ev: Record<string, unknown>): Promise<void> {
  if (!o.telemetry) return;
  try {
    const path = await logPath($, 'events', o.telemetryDir);
    if (path) await appendJsonl($, path, { ts: new Date().toISOString(), v: 2, ...ev });
  } catch { /* telemetry is best effort */ }
}

async function askJev($: EngineInterface, body: unknown, o: Options): Promise<JevVerdict> {
  const key = await $.env.get('OPENROUTER_API_KEY');
  if (!key) return { error: 'no_key' };
  const call = $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: JEV_MODEL, ...(body as object) }),
  }).then((r): JevVerdict => {
    if (!r.ok) return { error: `http_${r.status}` };
    try { return parseJev(JSON.parse(r.text)); } catch { return { error: 'invalid_json' }; }
  }, (): JevVerdict => ({ error: 'network' }));
  const timeout = $.clock.sleep(o.jevTimeoutMs).then((): JevVerdict => ({ error: 'timeout' }));
  return Promise.race([call, timeout]);
}

const toOutcome = (cls: Classification, text: string): Outcome =>
  cls === 'FAIL' ? { kind: 'failed', text } : cls === 'PASS' ? { kind: 'passed' } : { kind: 'ignored', reason: cls };

const SECRETISH = /([A-Za-z0-9_-]{24,}|(?:key|token|secret|password)\s*[=:]\s*\S+)/gi;

async function command($: EngineInterface, o: Options, args: string, alias: boolean): Promise<{ text: string }> {
  const a = args.trim().toLowerCase();
  if (a === 'reset') {
    await mutate($, (s) => ({ ...emptyState(), modeOverride: s.modeOverride, stats: s.stats, audit: audit(s, '-', 'reset', 'user').audit }));
    return { text: 'agent-reliability: records and incidents cleared for this session.' };
  }
  if (!alias && (a === 'observe' || a === 'enforce' || a === 'off' || a === 'auto')) {
    const s = await mutate($, (st) => {
      const { modeOverride: _drop, ...rest } = st;
      return a === 'auto' ? { ...rest } : { ...st, modeOverride: a };
    });
    const m = await effectiveMode($, o, s);
    return { text: `agent-reliability: mode ${m.mode} (${m.source}).` };
  }
  const { s } = await load($);
  const m = await effectiveMode($, o, s);
  const inc = s.incidents.filter((i) => i.state !== 'CLOSED').map((i) =>
    `- ${i.id} ${i.state} \`${i.action}\` fails ${i.fails}, strategies ${i.strategies.length}/${o.maxRecoveryStrategies}, last ${i.errorKey}${i.pending.length ? `, changes since: ${i.pending.length}` : ''}`);
  const recs = s.records.map((r) => `- ${r.normalized_action} ×${r.repeat_count} ${r.error_fingerprint}${r.transient ? ' (transient)' : ''} epoch ${r.state_epoch}`);
  const log = s.audit.slice(-8).map((x) => `- ${x.decision} ${x.reason}${x.jev ? ` [jev ${x.jev}]` : ''}: ${x.action}`);
  return { text: [
    `agent-reliability: mode ${m.mode} (${m.source}); rule B ${o.ruleB ? 'on' : 'log only'}, rule A ${o.ruleA ? 'on' : 'log only'}; epoch ${s.epoch}`,
    `stats ${JSON.stringify(s.stats)}`,
    `telemetry ${o.telemetry ? logDir($, o.telemetryDir) : 'off'}`,
    'incidents:', ...(inc.length ? inc : ['- none']),
    'records:', ...(recs.length ? recs : ['- none']),
    'recent:', ...(log.length ? log : ['- none']),
  ].join('\n') };
}

async function recoveryDone($: EngineInterface, o: Options, agentId: string): Promise<void> {
  const { s } = await load($);
  if ((await effectiveMode($, o, s)).mode === 'off') return;
  if (!s.incidents.some((i) => i.recoveryAgentId === agentId && i.state === 'ESCALATED' && !i.recoveryDone)) return;
  const now = await $.clock.now();
  let t: Transition | null = null;
  await mutate($, (st) => { t = onRecoveryDone(st, agentId, now); return t ? t.s : st; });
  const tr = t as Transition | null;
  if (tr) await emit($, o, { event: tr.event, recoveryAgentId: agentId, incidentId: tr.inc.id, incidentState: tr.inc.state });
}


/** Phase 0 diagnostics (dumpRaw, off by default): filtered fields only. */
async function dump($: EngineInterface, o: Options, ran: { isError?: true; text?: string; result?: unknown }, cls: Classification): Promise<void> {
  try {
    const path = await logPath($, 'diag', o.telemetryDir);
    if (!path) return;
    const r = ran.result as Record<string, unknown> | string | undefined;
    const text = String(ran.text ?? (typeof r === 'string' ? r : '')).replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g, '~').replace(SECRETISH, '<redacted>').slice(0, 200);
    await appendJsonl($, path, {
      ts: new Date().toISOString(), cls, isError: ran.isError === true,
      resultKeys: r && typeof r === 'object' ? Object.keys(r) : typeof r,
      returnCodeInterpretation: r && typeof r === 'object' ? r.returnCodeInterpretation : undefined,
      interrupted: r && typeof r === 'object' ? r.interrupted : undefined,
      timedOutAfterMs: r && typeof r === 'object' ? r.timedOutAfterMs : undefined,
      text,
    });
  } catch { /* diagnostics are best effort */ }
}

/** session.start work: the commands and the recovery agent. A host plugin with its own session.start calls this from it. */
export async function startSession($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'reliability', description: 'agent-reliability: status | observe | enforce | off | auto | reset' });
  await $.command.register({ name: 'retry-guard', description: 'Alias of /reliability (status | reset), kept from retry-loop-breaker' });
  await $.agent.register({
    name: RECOVERY_AGENT, model: 'opus', prompt: RECOVERY_PROMPT,
    description: 'Recovery engineer (Opus) for a verification that keeps failing after two recovery attempts. Only when agent-reliability asks for it.',
  }).catch(() => undefined);
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await startSession($);
    return next(e);
  }).catch(($, e, next) => next(e));
  registerHooks(on, options);
};

/** Every hook except session.start (see startSession), so a host plugin can add them to its own. */
export function registerHooks(on: Parameters<Register>[0], options: Parameters<Register>[1]): void {
  const o = readOptions(options);

  on('command.run', { command: 'reliability' }, async ($, e) => command($, o, e.args, false));
  on('command.run', { command: 'retry-guard' }, async ($, e) => command($, o, e.args, true));

  // A user message is new information: a "rerun" request starts a new epoch, and a
  // NEEDS_USER incident has had its answer.
  on('prompt.submit', async ($, e, next) => {
    if ((await effectiveMode($, o)).mode !== 'off') {
      const now = await $.clock.now();
      await mutate($, (s) => onUserPrompt(RETRY_REQUEST.test(e.text) ? { ...s, epoch: s.epoch + 1 } : s, now));
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // Edits from any loop change the state the failures were seen in; each is logged
  // on that loop's open incidents as part of the next recovery strategy.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e);
    if (ran.deny === undefined && ran.isError !== true && (await effectiveMode($, o)).mode !== 'off') {
      const file = String((e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path ?? '?');
      await mutate($, (s) => onMutation({ ...s, epoch: s.epoch + 1 }, e.agentId ?? 'main', `${e.tool} ${file.replace(/\\/g, '/').split('/').slice(-3).join('/')}`));
    }
    return ran;
  }).catch(($, e, next) => next(e));

  // Runtime evidence that recovery started (ESCALATED), and that it finished.
  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e);
    try {
      if (e.subagentType === `${PLUGIN}:${RECOVERY_AGENT}` && ran.agentId && (await effectiveMode($, o)).mode !== 'off') {
        const now = await $.clock.now();
        let t: Transition | null = null;
        await mutate($, (s) => { t = onRecoveryStarted(s, e.agentId ?? 'main', ran.agentId as string, e.background === true, now); return t ? t.s : s; });
        const tr = t as Transition | null;
        await emit($, o, { event: tr ? tr.event : 'recovery_spawn_without_request', agentId: e.agentId ?? 'main', recoveryAgentId: ran.agentId,
          background: e.background === true, incidentId: tr?.inc.id, incidentState: tr?.inc.state });
      }
    } catch { /* bookkeeping only */ }
    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e);
    try {
      const r = (ran as { result?: { status?: string; agentId?: string } }).result;
      if (r && r.status === 'completed' && r.agentId) await recoveryDone($, o, r.agentId);
    } catch { /* bookkeeping only */ }
    return ran;
  }).catch(($, e, next) => next(e));

  // Background recovery: its loop's turn.complete (types: matched by agentId; not exercised in Phase 0).
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e);
    try {
      const id = (e as { agentId?: string }).agentId;
      if (id) await recoveryDone($, o, id);
    } catch { /* bookkeeping only */ }
    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const t0 = Date.now();
    const { s: s0 } = await load($);
    const { mode, source } = await effectiveMode($, o, s0);
    if (mode === 'off') return next(e);
    const agent = e.agentId ?? 'main';
    const category = classify(e.command, o.extraEligible);
    if (!category) {
      const ran = await next(e);
      if (ran.deny === undefined && bashMayMutate(e.command, ran.isReadOnly === true))
        await mutate($, (s) => onMutation({ ...s, epoch: s.epoch + 1 }, agent, `Bash ${normalizeCommand(e.command).slice(0, 80)}`));
      return ran;
    }
    if (o.mainAgentOnly && e.agentId !== undefined) return next(e);

    const enforce = mode === 'enforce';
    const now = await $.clock.now();
    const cwd = await $.session.cwd().catch(() => '?');
    const scope = agent === 'main' ? cwd : `${cwd}#${agent}`;
    const action = normalizeCommand(e.command);
    const key = `${scope}::${action}`;
    const base = { agentId: agent, toolUseId: e.tool_use_id, tool: 'Bash', commandKey: action, mode, modeSource: source };
    const before = pruneIncidents(prune(s0, now, o), now, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes });

    // ---- Rule A gate: escalation requested / needs the user.
    const gate = gateBefore(before, key);
    if (gate.kind !== 'none') {
      let inc = gate.inc;
      let needsUser = gate.kind === 'needs_user';
      if (gate.kind === 'escalate' && inc.escalationDenied) {
        let t: Transition | null = null;
        await mutate($, (s) => { t = onEscalationIgnored(s, key, now); return t ? t.s : s; });
        const tr = t as Transition | null;
        if (tr) { inc = tr.inc; needsUser = true; }
      }
      const deny = enforce && o.ruleA;
      const decision = needsUser ? (deny ? 'deny_needs_user' : 'would_deny_needs_user') : (deny ? 'deny_escalate' : 'would_escalate');
      await mutate($, (s) => {
        let st = audit(s, action, decision, inc.state);
        if (!needsUser && deny) st = markEscalationDenied({ ...st, stats: { ...st.stats, escalations: st.stats.escalations + 1 } }, key, now);
        return st;
      });
      await emit($, o, { ...base, event: needsUser ? 'needs_user' : 'escalation_requested', action: decision, reason: needsUser ? 'needs_user' : `strategies ${inc.strategies.length} >= ${o.maxRecoveryStrategies}`,
        incidentId: inc.id, incidentState: inc.state, errorKey: inc.errorKey, hookMs: Date.now() - t0 });
      if (deny) return { deny: needsUser ? needsUserText(inc) : escalationText(inc, PLUGIN) };
    }

    // ---- Rule B: identical failure, nothing changed.
    const d = decideBefore(before, scope, e.command, now, o);
    let block = d.kind === 'block';
    let jevNote: string | undefined;
    if (d.kind === 'ambiguous' && o.jevEnabled) {
      const v = await askJev($, jevRequest(d.record, e.command, false), o);
      jevNote = 'error' in v ? `error:${v.error}` : `${v.decision}@${v.confidence.toFixed(2)}`;
      block = jevBlocks(v, o);
      await mutate($, (s) => ({ ...s, stats: { ...s.stats, jevCalls: s.stats.jevCalls + 1, jevErrors: s.stats.jevErrors + ('error' in v ? 1 : 0) } }));
    }
    let reason = d.reason;
    let token: string | null = null;
    if (block && d.kind !== 'pass') {
      // Edits outside Claude's tools (a formatter, the user) are invisible to the epoch: ask git.
      const inc = findIncident(before, key);
      if (!inc || !inc.baseToken) { block = false; reason = 'fail_open:no_baseline_token'; }
      else {
        token = await gitToken($, cwd === '?' ? '.' : cwd, o.gitTimeoutMs);
        if (token === null) { block = false; reason = 'fail_open:token_unknown'; }
        else if (token !== inc.baseToken) { block = false; reason = 'state_changed_outside_tools'; await mutate($, (s) => ({ ...s, epoch: s.epoch + 1 })); }
      }
      if (reason.startsWith('fail_open')) await mutate($, (s) => ({ ...s, stats: { ...s.stats, failOpen: s.stats.failOpen + 1 } }));
    }
    if (block && d.kind !== 'pass') {
      const deny = enforce && o.ruleB;
      await mutate($, (s) => audit({ ...s, stats: { ...s.stats, eligible: s.stats.eligible + 1, wouldBlock: s.stats.wouldBlock + 1, blocked: s.stats.blocked + (deny ? 1 : 0) } },
        e.command, deny ? 'blocked' : 'would_block', d.reason, jevNote));
      const inc = findIncident(before, key);
      await emit($, o, { ...base, event: 'repeat_blocked', action: deny ? 'deny_repeat' : 'would_block', reason: d.reason, errorKey: d.record.error_fingerprint,
        incidentId: inc?.id, incidentState: inc?.state, stateToken: token?.slice(0, 12), hookMs: Date.now() - t0 });
      if (deny) return { deny: denialText(d.record, d.kind === 'ambiguous') };
    } else {
      await mutate($, (s) => audit({ ...s, stats: { ...s.stats, eligible: s.stats.eligible + 1 } }, e.command, 'allow', reason, jevNote));
    }

    // ---- Run, classify, record.
    const preMs = Date.now() - t0;
    const ran = await next(e);
    const tRan = Date.now();
    try {
      const { cls, reason: why } = classifyRun(ran);
      const text = ran.text ?? (typeof (ran as { result?: unknown }).result === 'string' ? (ran as { result: string }).result : '');
      if (o.dumpRaw) await dump($, o, ran, cls);
      const at = await $.clock.now();
      let tr: Transition | null = null;
      let after: string | null = null;
      if (cls === 'FAIL') {
        after = await gitToken($, cwd === '?' ? '.' : cwd, o.gitTimeoutMs);
        const { fp, summary } = fingerprint(text);
        await mutate($, (s) => {
          const prior = findIncident(s, key);
          // Baseline refresh: a change git saw since the last failure starts a new epoch (a new Case B chain).
          const st0 = prior?.baseToken && after && after !== prior.baseToken ? { ...s, epoch: s.epoch + 1 } : s;
          const st1 = recordAfter(prune(st0, at, o), scope, e.command, category, toOutcome(cls, text), at, o);
          tr = onFail(st1, { key, agent, action, errorKey: fp, summary, epoch: st1.epoch, token: after, now: at }, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes });
          return tr.s;
        });
      } else if (cls === 'PASS') {
        await mutate($, (s) => {
          const st1 = recordAfter(prune(s, at, o), scope, e.command, category, toOutcome(cls, text), at, o);
          tr = onPass(st1, key, at);
          return tr ? tr.s : st1;
        });
      }
      const t = tr as Transition | null;
      await emit($, o, { ...base, event: t ? t.event : 'run', classification: cls, reason: why, action: 'allow', preReason: reason,
        errorKey: t?.inc.errorKey, incidentId: t?.inc.id, incidentState: t?.inc.state, mutatingSinceLast: t?.inc.strategies.length,
        stateToken: after?.slice(0, 12), hookMs: preMs + (Date.now() - tRan) });
    } catch { /* never break the call over bookkeeping */ }
    return ran;
  }).catch(($, e, next) => next(e)); // any guard failure: the call runs as if the mod were absent

}
