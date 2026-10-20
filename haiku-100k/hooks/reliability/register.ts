// Shipped copy of agent-reliability/hooks/register.ts (scripts/ship-haiku-100k.mjs). Edit the source, not this file.
// agent-reliability: runtime guard against unproductive retry loops.
// Rule B (from retry-loop-breaker): a test/build command that already failed the same
//   way with nothing changed is refused (`{ deny }`) before it runs.
// Rule A: after `maxRecoveryStrategies` failed recovery attempts on one incident, the next
//   verification is refused with an instruction to call the Opus recovery agent
//   (cooperative: the mod cannot pause the main loop); unresolved → NEEDS_USER.
// Rule C (0.3): a refused call is not resent; a user denial is never worked around by
//   another tool, shell or path, and only /reliability allow lifts it.
// Jev Recovery Advisor (0.3): from the 2nd consecutive failure of any Bash/PS/Edit/Write key,
//   Jev picks one of 5 recovery actions; the core logs it (shadow) or carries it out inside
//   its own limits (apply, enforce mode only). Sanitized attempt records go to a local dataset.
// Default mode `observe` logs what it would do. Every guard error lets the call run.
import type { EngineInterface, Register } from 'claude-code';
import type { GuardState, Incident, Mode } from './types.d.ts';
import {
  type Options, bashMayMutate, classify, decideBefore, denialText, emptyState, fingerprint,
  jevBlocks, jevRequest, normalizeCommand, parseJev, prune, readOptions, recordAfter, resolveMode,
  RETRY_REQUEST, unwrapCommand, upgradeState, type JevVerdict, type Outcome,
} from './core.ts';
import {
  type Classification, type Transition, classifyRun, escalationText, findIncident, gateBefore, isLive,
  liftBlocked, markEscalationDenied, needsUserText, onEscalationIgnored, onFail, onMutation, onPass,
  onRecoveryDone, onRecoveryStarted, onUserPrompt, pruneIncidents, putIncident, RECOVERY_AGENT, RECOVERY_PROMPT,
} from './incident.ts';
import {
  type CallKeys, type DatasetEvent, advisorEligible, advisorRequest, applyDecision, callKeys,
  datasetRecord, holdText, liftDenials, matchRefusal, onNotRefused, parseAdvice, recordRefusal, redact,
  refusalOf, refusalText, repeatsFailedAttempt, retryRepeatText, streakKey,
} from './advisor.ts';
import { sha256 } from './io.ts';

const PLUGIN = 'haiku-100k';
const GUARD = { plugin: 'haiku-100k', key: 'guard' } as const;
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';

// Engine-handle helpers. They sit in this file because the runtime's hook check follows $
// only into functions declared here, never across an import (io.ts holds the pure parts).
async function sessionId($: EngineInterface): Promise<string> {
  try { return (await $.session.id()) || 'unknown'; } catch { return 'unknown'; }
}

const MAX_LOG = 1_000_000;

/** Appends one line; past `max` (~1 MB) the oldest half is dropped. */
async function appendJsonl($: EngineInterface, path: string, line: object, max = MAX_LOG): Promise<void> {
  let prev = await $.fs.read(path).catch(() => '');
  if (prev.length > max) prev = prev.slice(prev.indexOf('\n', prev.length / 2) + 1);
  await $.fs.write(path, prev + JSON.stringify(line) + '\n');
}

/** The telemetry folder: `dir` when set, else `telemetry/` in the plugin's own folder. */
function logDir($: EngineInterface, dir: string): string {
  return (dir || `${$.plugin.root}/telemetry`).replace(/\\/g, '/').replace(/\/+$/, '');
}

async function logPath($: EngineInterface, kind: 'events' | 'diag', dir = ''): Promise<string | null> {
  const sid = await sessionId($);
  if (sid === 'unknown') return null;
  return `${logDir($, dir)}/${kind === 'diag' ? 'diag-' : ''}${sid}.jsonl`;
}

/**
 * SHA-256 over the working tree as git sees it: status (with untracked files),
 * the full diff against HEAD, and the blob ids of untracked files (≤ 50).
 * null = unknown: not a repo, no HEAD, a nonzero exit, truncated output, too many
 * untracked files, or the total budget spent. Buffered, not streamed: a mod cannot
 * import node:crypto/child_process (docs/api-findings.md).
 */
async function gitToken($: EngineInterface, cwd: string, budgetMs: number): Promise<string | null> {
  const t0 = Date.now();
  const run = async (argv: string[]): Promise<string | null> => {
    const left = budgetMs - (Date.now() - t0);
    if (left < 50) return null;
    try {
      const r = await $.process.run(argv, { cwd, timeoutMs: Math.round(left) });
      if (r.exitCode !== 0 || r.isStdoutTruncated) return null;
      return r.stdout;
    } catch { return null; }
  };
  const status = await run(['git', 'status', '--porcelain=v1', '-uall', '-z']);
  if (status === null) return null;
  const untracked = status.split('\0').filter((e) => e.startsWith('?? ')).map((e) => e.slice(3));
  if (untracked.length > 50) return null;
  const diff = await run(['git', '-c', 'core.quotepath=off', 'diff', 'HEAD', '--no-ext-diff', '--binary']);
  if (diff === null) return null;
  let blobs = '';
  if (untracked.length) {
    const b = await run(['git', 'hash-object', '--', ...untracked]);
    if (b === null) return null;
    blobs = b;
  }
  if (Date.now() - t0 > budgetMs) return null;
  try { return await sha256(`${status}\n--\n${diff}\n--\n${blobs}`); } catch { return null; }
}

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

/** One decisions call (OpenRouter → TypeSafe Jev), raced against `jevTimeoutMs`. The key is never logged. */
async function postJev($: EngineInterface, body: unknown, o: Options): Promise<{ json: unknown } | { error: string }> {
  const key = await $.env.get('OPENROUTER_API_KEY');
  if (!key) return { error: 'no_key' };
  type R = { json: unknown } | { error: string };
  const call = $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: JEV_MODEL, ...(body as object) }),
  }).then((r): R => {
    if (!r.ok) return { error: `http_${r.status}` };
    try { return { json: JSON.parse(r.text) }; } catch { return { error: 'invalid_json' }; }
  }, (): R => ({ error: 'network' }));
  const timeout = $.clock.sleep(o.jevTimeoutMs).then((): R => ({ error: 'timeout' }));
  return Promise.race([call, timeout]);
}

async function askJev($: EngineInterface, body: unknown, o: Options): Promise<JevVerdict> {
  const r = await postJev($, body, o);
  return 'error' in r ? r : parseJev(r.json);
}

/** The advisor mode in effect: apply acts only in enforce mode, otherwise it is shadow. */
const advisorMode = (o: Options, mode: Mode): 'off' | 'shadow' | 'apply' =>
  o.jevAdvisor === 'off' || mode === 'off' ? 'off' : o.jevAdvisor === 'apply' && mode === 'enforce' ? 'apply' : 'shadow';

/** Whether an incident's hold denies calls now (Rule A states by ruleA, Jev states by apply). */
const binding = (o: Options, mode: Mode) => (inc: Incident): boolean =>
  mode === 'enforce' && (inc.decidedBy === 'jev' ? advisorMode(o, mode) === 'apply'
    : inc.afterNeedsUser ? (o.ruleA || advisorMode(o, mode) === 'apply') : o.ruleA);

/** The local dataset folder, outside the plugin and the repo: datasetDir, else ~/.claude/agent-reliability/dataset. */
async function datasetFolder($: EngineInterface, o: Options): Promise<string | null> {
  if (o.datasetDir) return o.datasetDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const home = (await $.env.get('USERPROFILE').catch(() => undefined)) || (await $.env.get('HOME').catch(() => undefined));
  return home ? `${home.replace(/\\/g, '/')}/.claude/agent-reliability/dataset` : null;
}

/** One sanitized attempt record; best effort, never throws, never changes the call. */
async function capture($: EngineInterface, o: Options, e: Omit<DatasetEvent, 'session'>): Promise<void> {
  if (!o.datasetCapture) return;
  try {
    const dir = await datasetFolder($, o);
    if (!dir) return;
    const now = await $.clock.now();
    await appendJsonl($, `${dir}/attempts-${new Date(now).toISOString().slice(0, 7)}.jsonl`,
      datasetRecord({ ...e, session: await sessionId($) }, now), 5_000_000);
  } catch { /* the dataset is best effort */ }
}

type Base = Record<string, unknown> & { commandKey: string };

/** Rule C before a call: the refusal it would repeat. A deny text only in enforce mode. */
async function ruleCBefore($: EngineInterface, o: Options, mode: Mode, s: GuardState, k: CallKeys, agent: string, tool: string, base: Base, now: number): Promise<string | null> {
  if (!o.ruleC) return null;
  const r = matchRefusal(s, k, now, o.failureRecordTtlMinutes * 60_000);
  if (!r) return null;
  const deny = mode === 'enforce';
  await mutate($, (st) => audit({ ...st, stats: { ...st.stats, wouldBlock: st.stats.wouldBlock + 1, blocked: st.stats.blocked + (deny ? 1 : 0) } },
    k.label, deny ? 'blocked' : 'would_block', `rule_c:${r.kind}#${r.n}`));
  await emit($, o, { ...base, event: 'refusal_repeat', action: deny ? 'deny_refusal' : 'would_block', reason: r.kind, form: r.form, refusal: r.n });
  await capture($, o, { event: 'refusal_repeat', agent, tool, coreClass: r.kind, commandKey: k.core ?? k.file, applied: deny ? 'deny' : 'would_block' });
  return deny ? refusalText(r, s.refusalStreak[agent] ?? 0) : null;
}

/** The incident gate before a call on `key`: Rule A, applied Jev holds, and the armed-retry check. */
async function gateCall($: EngineInterface, o: Options, mode: Mode, s: GuardState, key: string, raw: string | undefined, base: Base, t0: number, now: number): Promise<string | null> {
  const bind = binding(o, mode);
  const g = gateBefore(s, key);
  if (g.kind === 'none') {
    const inc = findIncident(s, key);
    if (!inc || !raw || !repeatsFailedAttempt(inc, redact(raw, 220), s.epoch)) return null;
    const deny = bind({ ...inc, decidedBy: 'jev' });
    await mutate($, (st) => audit(st, base.commandKey, deny ? 'deny_retry_repeat' : 'would_block', inc.id));
    await emit($, o, { ...base, event: 'retry_repeat', action: deny ? 'deny_repeat' : 'would_block', incidentId: inc.id, hookMs: Date.now() - t0 });
    return deny ? retryRepeatText(inc) : null;
  }
  let inc = g.inc;
  let needsUser = g.kind === 'needs_user';
  if (g.kind === 'escalate' && inc.escalationDenied) {
    let t: Transition | null = null;
    await mutate($, (st) => { t = onEscalationIgnored(st, key, now); return t ? t.s : st; });
    const tr = t as Transition | null;
    if (tr) { inc = tr.inc; needsUser = true; }
  }
  const deny = bind(inc);
  const decision = needsUser ? (deny ? 'deny_needs_user' : 'would_deny_needs_user')
    : g.kind === 'hold' ? (deny ? 'deny_hold' : 'would_hold') : (deny ? 'deny_escalate' : 'would_escalate');
  await mutate($, (st) => {
    let x = audit(st, base.commandKey, decision, inc.state);
    if (g.kind === 'escalate' && !needsUser && deny) x = markEscalationDenied({ ...x, stats: { ...x.stats, escalations: x.stats.escalations + 1 } }, key, now);
    return x;
  });
  await emit($, o, { ...base, event: needsUser ? 'needs_user' : g.kind === 'hold' ? 'hold' : 'escalation_requested', action: decision,
    reason: needsUser ? 'needs_user' : g.kind === 'hold' ? inc.state : `strategies ${inc.strategies.length} >= ${o.maxRecoveryStrategies}`,
    incidentId: inc.id, incidentState: inc.state, decidedBy: inc.decidedBy, errorKey: inc.errorKey, hookMs: Date.now() - t0 });
  if (!deny) return null;
  return needsUser ? needsUserText(inc) : g.kind === 'hold' ? holdText(inc) : escalationText(inc, PLUGIN);
}

/** After a call: a refusal is recorded (Rule C); anything else ends the agent's refusal streak. */
async function refusalAfter($: EngineInterface, o: Options, mode: Mode, ran: { deny?: string; isError?: boolean; text?: string; result?: unknown }, k: CallKeys, agent: string, tool: string, base: Base, now: number): Promise<{ refused: boolean; note?: string }> {
  const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '');
  const v = ran.deny === undefined ? refusalOf(ran.isError === true, text) : null;
  if (!v) {
    const ok = ran.deny === undefined && ran.isError !== true;
    const { s } = await load($);
    if (s.refusalStreak[agent] || (ok && s.refusals.some((r) => r.kind === 'harness_refusal')))
      await mutate($, (st) => onNotRefused(st, agent, k, ok));
    return { refused: false };
  }
  let n = 0, streak = 0;
  await mutate($, (st) => { const x = recordRefusal(st, v, agent, tool, k, now); n = x.r.n; streak = x.s.refusalStreak[agent] ?? 0; return x.s; });
  await emit($, o, { ...base, event: 'refusal', reason: v.kind, form: v.form, refusal: n, streak, action: 'allow' });
  await capture($, o, { event: 'refusal', agent, tool, coreClass: v.kind, commandKey: k.core ?? k.file });
  if (o.ruleC && mode === 'enforce' && streak >= 3)
    return { refused: true, note: `[agent-reliability] ${streak} refusals in a row in this agent: stop retrying refused actions. Report what is blocked to the user (or, in a subagent, to the parent agent) and ask how to proceed.` };
  return { refused: true };
}

/**
 * Jev Recovery Advisor after a failure on `key`: asks Jev when the incident is eligible (2nd+
 * failure, no decision pending, no live user denial), logs the decision (shadow), and in apply
 * mode carries it out inside the core's limits. Returns the note Claude reads in apply mode.
 */
async function advise($: EngineInterface, o: Options, mode: Mode, key: string, agent: string, tool: string, base: Base): Promise<string | undefined> {
  const adv = advisorMode(o, mode);
  if (adv === 'off') return undefined;
  const { s } = await load($);
  const inc = findIncident(s, key);
  if (!inc || !advisorEligible(inc, binding(o, mode))) return undefined;
  if (s.refusals.some((r) => r.kind === 'user_denied' && !r.lifted && r.agent === agent)) {
    await emit($, o, { ...base, event: 'jev_skipped', reason: 'user_denied_live', incidentId: inc.id });
    return undefined;
  }
  const last = inc.attempts?.[inc.attempts.length - 1];
  const ctx = {
    subagent: agent !== 'main', strategiesUsed: inc.strategies.length, maxStrategies: o.maxRecoveryStrategies,
    stateChangedSinceLast: (last?.changes.length ?? 0) > 0, ...(o.includePromptInJev && s.lastPrompt ? { prompt: s.lastPrompt } : {}),
  };
  const t0 = Date.now();
  const r = await postJev($, advisorRequest(inc, ctx), o);
  const v = 'error' in r ? r : parseAdvice(r.json);
  const jevMs = Date.now() - t0;
  await mutate($, (st) => ({ ...st, stats: { ...st.stats, jevCalls: st.stats.jevCalls + 1, jevErrors: st.stats.jevErrors + ('error' in v ? 1 : 0) } }));
  if ('error' in v) {
    await emit($, o, { ...base, event: 'jev_advice', status: v.error, advisor: adv, incidentId: inc.id, fallback_action: 'v0.2', jevMs });
    return undefined;
  }
  const d = applyDecision(inc, v, { minConfidence: o.jevAdvisorMinConfidence, subagent: agent !== 'main', maxStrategies: o.maxRecoveryStrategies });
  const apply = adv === 'apply' && d.action !== 'none';
  const now = await $.clock.now();
  let applied: Incident | undefined;
  await mutate($, (st) => {
    let x: GuardState = { ...st, jevLog: [...st.jevLog, { t: now, incident: inc.id, action: inc.action.slice(0, 80), decision: v.nextStep.choice, p: v.nextStep.p, applied: apply ? d.action : `${adv}:${d.action}` }].slice(-20) };
    const cur = findIncident(st, key);
    if (apply && cur) {
      const next: Incident = {
        ...cur, updatedAt: now,
        ...(d.state ? { state: d.state, decidedBy: 'jev' as const } : {}),
        ...(d.action === 'ESCALATE_MODEL' && agent === 'main' ? { jevEscalated: true } : {}),
        ...(d.action === 'RETRY_NEW_STRATEGY' ? { retryArmed: { epoch: st.epoch, actions: (cur.attempts ?? []).map((a) => a.action) } } : {}),
      };
      applied = next;
      x = putIncident(x, next);
    }
    return x;
  });
  await emit($, o, {
    ...base, event: 'jev_advice', status: 'ok', advisor: adv, incidentId: inc.id, incidentKind: inc.kind, fails: inc.fails,
    failure_kind: v.failureKind.choice, same_approach: Number(v.sameApproach.toFixed(3)), decision: v.nextStep.choice, p: Number(v.nextStep.p.toFixed(3)),
    probabilities: v.nextStep.probabilities, would_apply: d.action, reason: d.reason, applied: apply ? d.action : 'none',
    fallback_action: d.action === 'none' ? 'v0.2' : undefined, jevMs,
  });
  await capture($, o, { event: 'jev_decision', agent, tool, incident: applied ?? inc, advice: v, applied: apply ? d.action : `${adv}:${d.action}` });
  if (!apply) return undefined;
  if (d.action === 'ESCALATE_MODEL' && agent === 'main' && applied) return `${d.note}\n${escalationText(applied, PLUGIN)}`;
  return d.note;
}

/** A context note appended to a tool result (apply-mode advice, refusal streaks). */
const withNote = <R extends { deny?: string; context?: readonly string[] }>(ran: R, note: string | undefined): R =>
  !note || ran.deny !== undefined ? ran : { ...ran, context: [...(ran.context ?? []), note] };

const toOutcome = (cls: Classification, text: string): Outcome =>
  cls === 'FAIL' ? { kind: 'failed', text } : cls === 'PASS' ? { kind: 'passed' } : { kind: 'ignored', reason: cls };

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
  const allow = /^allow\s+(\d+|all)$/.exec(a);
  if (!alias && allow) {
    let lifted: number[] = [];
    await mutate($, (st) => { const x = liftDenials(st, allow[1] ?? ''); lifted = x.lifted; return audit(x.s, '-', 'allow', `user lifted #${x.lifted.join(',#') || 'none'}`); });
    return { text: lifted.length
      ? `agent-reliability: lifted user denial ${lifted.map((n) => `#${n}`).join(', ')}. The normal permission prompt still applies to the retried call.`
      : 'agent-reliability: no matching user denial (see /reliability for the numbers).' };
  }
  const { s } = await load($);
  const m = await effectiveMode($, o, s);
  const inc = s.incidents.filter(isLive).map((i) =>
    `- ${i.id} ${i.state}${i.decidedBy ? ' (jev)' : ''} [${i.kind ?? 'verify'}] \`${i.action}\` fails ${i.fails}, strategies ${i.strategies.length}/${o.maxRecoveryStrategies}, last ${i.errorKey}${i.pending.length ? `, changes since: ${i.pending.length}` : ''}`);
  const den = s.refusals.filter((r) => r.kind === 'user_denied' && !r.lifted).map((r) => `- #${r.n} ${r.label} (${r.tool}${r.agent === 'main' ? '' : `, ${r.agent}`}) → /reliability allow ${r.n}`);
  const recs = s.records.map((r) => `- ${r.normalized_action} ×${r.repeat_count} ${r.error_fingerprint}${r.transient ? ' (transient)' : ''} epoch ${r.state_epoch}`);
  const jev = s.jevLog.slice(-5).map((j) => `- ${j.incident} ${j.decision}@${j.p.toFixed(2)} → ${j.applied}: ${j.action}`);
  const log = s.audit.slice(-8).map((x) => `- ${x.decision} ${x.reason}${x.jev ? ` [jev ${x.jev}]` : ''}: ${x.action}`);
  return { text: [
    `agent-reliability: mode ${m.mode} (${m.source}); rule B ${o.ruleB ? 'on' : 'log only'}, rule A ${o.ruleA ? 'on' : 'log only'}, rule C ${o.ruleC ? 'on' : 'off'}; epoch ${s.epoch}`,
    `Jev advisor ${o.jevAdvisor} (in effect: ${advisorMode(o, m.mode)}), min p ${o.jevAdvisorMinConfidence}, prompt to Jev ${o.includePromptInJev ? 'yes' : 'no'}; near-duplicate check ${o.jevEnabled ? 'on' : 'off'}`,
    `stats ${JSON.stringify(s.stats)}`,
    `telemetry ${o.telemetry ? logDir($, o.telemetryDir) : 'off'}`,
    `dataset ${o.datasetCapture ? (await datasetFolder($, o)) ?? '(no home folder)' : 'off'}`,
    'incidents:', ...(inc.length ? inc : ['- none']),
    'user denials (blocked until you allow them):', ...(den.length ? den : ['- none']),
    'records:', ...(recs.length ? recs : ['- none']),
    'Jev decisions:', ...(jev.length ? jev : ['- none']),
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
    const text = redact(String(ran.text ?? (typeof r === 'string' ? r : '')), 200);
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
  await $.command.register({ name: 'reliability', description: 'agent-reliability: status | observe | enforce | off | auto | reset | allow <n|all>' });
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
  // A new prompt ends every incident's wait (SUPERSEDED, resolution prompt_received), never a
  // user denial (Rule C) and never as consent. It does not lift anything by itself.
  on('prompt.submit', async ($, e, next) => {
    if ((await effectiveMode($, o)).mode !== 'off') {
      const now = await $.clock.now();
      let ended: Incident[] = [];
      await mutate($, (s) => {
        const x = onUserPrompt(RETRY_REQUEST.test(e.text) ? { ...s, epoch: s.epoch + 1 } : s, now);
        ended = x.incidents.filter((i) => i.state === 'SUPERSEDED' && s.incidents.some((p) => p.id === i.id && p.state !== 'SUPERSEDED'));
        return o.includePromptInJev ? { ...x, lastPrompt: redact(e.text, 300) } : x;
      });
      for (const inc of ended) await capture($, o, { event: 'superseded', agent: inc.agent, tool: '-', incident: inc, outcome: 'prompt_received' });
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // Edits from any loop change the state the failures were seen in; each is logged
  // on that loop's open incidents as part of the next recovery strategy. 0.3: Rule C on the
  // file (a user-denied Edit also blocks Write/NotebookEdit there), and failing edits form
  // streak incidents for the advisor.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const t0 = Date.now();
    const { s: s0 } = await load($);
    const { mode, source } = await effectiveMode($, o, s0);
    if (mode === 'off') return next(e);
    const agent = e.agentId ?? 'main';
    const tool = e.tool as string;
    const file = String((e as { file_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path ?? '?');
    const short = `${tool} ${file.replace(/\\/g, '/').split('/').slice(-3).join('/')}`;
    const now = await $.clock.now();
    const cwd = await $.session.cwd().catch(() => '?');
    const scope = agent === 'main' ? cwd : `${cwd}#${agent}`;
    const k = callKeys({ tool, path: file, scope: cwd });
    const key = streakKey(scope, k);
    const base: Base = { agentId: agent, toolUseId: e.tool_use_id, tool, commandKey: short, mode, modeSource: source };
    const before = liftBlocked(pruneIncidents(s0, now, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes }), key, s0.epoch, now);

    const c = await ruleCBefore($, o, mode, before, k, agent, tool, base, now);
    if (c) return { deny: c };
    const g = await gateCall($, o, mode, before, key, undefined, base, t0, now);
    if (g) return { deny: g };

    const ran = await next(e);
    try {
      const at = await $.clock.now();
      const ref = await refusalAfter($, o, mode, ran, k, agent, tool, base, at);
      if (ref.refused) return withNote(ran, ref.note);
      if (ran.deny !== undefined) return ran;
      if (ran.isError !== true) {
        await mutate($, (s) => {
          const x = onMutation({ ...s, epoch: s.epoch + 1 }, agent, short);
          const t = onPass(x, key, at);
          return t ? t.s : x;
        });
        return ran;
      }
      // A failed edit (string not found, stale file, …): one attempt of the file's streak.
      const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '');
      const { fp, summary } = fingerprint(text);
      let t: Transition | null = null;
      await mutate($, (s) => {
        t = onFail(s, { key, agent, action: short, errorKey: fp, summary, epoch: s.epoch, token: null, now: at, kind: 'streak',
          attempt: { tool, action: redact(short, 220), error: redact(text, 400) } }, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes });
        return t.s;
      });
      const tr = t as Transition | null;
      await emit($, o, { ...base, event: tr ? tr.event : 'run', classification: 'FAIL', reason: 'tool_error', action: 'allow', incidentId: tr?.inc.id, incidentState: tr?.inc.state });
      await capture($, o, { event: 'attempt_failed', agent, tool, incident: tr?.inc, coreClass: 'FAIL', commandKey: k.file, errorFp: fp, errorSummary: summary });
      return withNote(ran, await advise($, o, mode, key, agent, tool, base));
    } catch { return ran; }
  }).catch(($, e, next) => next(e));

  // A successful Read of a file clears a harness "not read yet" refusal on it (Rule C).
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e);
    try {
      if (ran.deny === undefined && ran.isError !== true) {
        const { s } = await load($);
        if (s.refusals.some((r) => r.kind === 'harness_refusal' && r.file)) {
          const k = callKeys({ tool: 'Read', path: String((e as { file_path?: unknown }).file_path ?? ''), scope: '' });
          await mutate($, (st) => ({ ...st, refusals: st.refusals.filter((r) => r.kind !== 'harness_refusal' || r.file !== k.file) }));
        }
      }
    } catch { /* bookkeeping only */ }
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

  // Bash and PowerShell share one handler (0.3). The command is unwrapped (cd prefix, 2>&1,
  // `| tail`) for classification and keys only; what runs is never changed.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const t0 = Date.now();
    const { s: s0 } = await load($);
    const { mode, source } = await effectiveMode($, o, s0);
    if (mode === 'off') return next(e);
    const enforce = mode === 'enforce';
    const agent = e.agentId ?? 'main';
    const tool = e.tool as string;
    const command = String((e as { command?: unknown }).command ?? '');
    const u = unwrapCommand(command);
    const category = classify(command, o.extraEligible);
    // Rules A/B: main-loop verifications (subagents with mainAgentOnly). Everything else: streaks.
    const verify = category !== null && !(o.mainAgentOnly && e.agentId !== undefined);
    const now = await $.clock.now();
    const cwd = await $.session.cwd().catch(() => '?');
    const where = u.cdPath ? `${cwd}>${u.cdPath}` : cwd;
    const scope = agent === 'main' ? where : `${where}#${agent}`;
    const action = u.core;
    const k = callKeys({ tool, command, scope: cwd });
    const key = verify ? `${scope}::${action}` : streakKey(agent === 'main' ? cwd : `${cwd}#${agent}`, k);
    const base: Base = { agentId: agent, toolUseId: e.tool_use_id, tool, commandKey: action, mode, modeSource: source };
    const pruned = pruneIncidents(prune(s0, now, o), now, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes });
    const before = liftBlocked(pruned, key, s0.epoch, now);

    // ---- Rule C: a refused call is not resent; a user denial is not worked around.
    const c = await ruleCBefore($, o, mode, before, k, agent, tool, base, now);
    if (c) return { deny: c };
    // ---- Rule A gate and applied Jev holds on this key.
    const g = await gateCall($, o, mode, before, key, k.raw, base, t0, now);
    if (g) return { deny: g };

    if (!verify) {
      const ran = await next(e);
      try {
        const at = await $.clock.now();
        const ref = await refusalAfter($, o, mode, ran, k, agent, tool, base, at);
        if (ref.refused) return withNote(ran, ref.note);
        const { cls, reason: why } = classifyRun(ran, u.piped);
        // A failed command is an attempt, not a change made before the next attempt.
        if (ran.deny === undefined && cls !== 'FAIL' && bashMayMutate(command, ran.isReadOnly === true))
          await mutate($, (s) => onMutation({ ...s, epoch: s.epoch + 1 }, agent, `${tool} ${normalizeCommand(command).slice(0, 80)}`));
        if (cls === 'PASS' || cls === 'EXPECTED_NONZERO') {
          // A success of the same family ends its streak; unrelated successes leave other streaks alone.
          if (findIncident(await load($).then((x) => x.s), key)) {
            let t: Transition | null = null;
            await mutate($, (s) => { t = onPass(s, key, at); return t ? t.s : s; });
            const tr = t as Transition | null;
            if (tr?.inc.id) await capture($, o, { event: 'closed', agent, tool, incident: tr.inc, outcome: 'success' });
          }
          return ran;
        }
        if (cls !== 'FAIL') return ran;
        const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '');
        const { fp, summary } = fingerprint(text);
        let t: Transition | null = null;
        await mutate($, (s) => {
          t = onFail(s, { key, agent, action, errorKey: fp, summary, epoch: s.epoch, token: null, now: at, kind: 'streak',
            attempt: { tool, action: redact(k.raw ?? action, 220), error: redact(text, 400) } }, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes });
          return t.s;
        });
        const tr = t as Transition | null;
        await emit($, o, { ...base, event: tr ? tr.event : 'run', classification: cls, reason: why, action: 'allow', errorKey: fp, incidentId: tr?.inc.id, incidentState: tr?.inc.state, hookMs: Date.now() - t0 });
        await capture($, o, { event: 'attempt_failed', agent, tool, incident: tr?.inc, coreClass: cls, commandKey: k.core, errorFp: fp, errorSummary: summary });
        return withNote(ran, await advise($, o, mode, key, agent, tool, base));
      } catch { return ran; }
    }

    // ---- Rule B: identical failure, nothing changed.
    const d = decideBefore(before, scope, action, now, o);
    let block = d.kind === 'block';
    let jevNote: string | undefined;
    if (d.kind === 'ambiguous' && o.jevEnabled) {
      const v = await askJev($, jevRequest(d.record, action, false), o);
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
        command, deny ? 'blocked' : 'would_block', d.reason, jevNote));
      const inc = findIncident(before, key);
      await emit($, o, { ...base, event: 'repeat_blocked', action: deny ? 'deny_repeat' : 'would_block', reason: d.reason, errorKey: d.record.error_fingerprint,
        incidentId: inc?.id, incidentState: inc?.state, stateToken: token?.slice(0, 12), hookMs: Date.now() - t0 });
      if (deny) return { deny: denialText(d.record, d.kind === 'ambiguous') };
    } else {
      await mutate($, (s) => audit({ ...s, stats: { ...s.stats, eligible: s.stats.eligible + 1 } }, command, 'allow', reason, jevNote));
    }

    // ---- Run, classify, record.
    const preMs = Date.now() - t0;
    const ran = await next(e);
    const tRan = Date.now();
    try {
      const at = await $.clock.now();
      const ref = await refusalAfter($, o, mode, ran, k, agent, tool, base, at);
      if (ref.refused) return withNote(ran, ref.note);
      const { cls, reason: why } = classifyRun(ran, u.piped);
      const text = ran.text ?? (typeof (ran as { result?: unknown }).result === 'string' ? (ran as { result: string }).result : '');
      if (o.dumpRaw) await dump($, o, ran, cls);
      let tr: Transition | null = null;
      let after: string | null = null;
      if (cls === 'FAIL') {
        after = await gitToken($, cwd === '?' ? '.' : cwd, o.gitTimeoutMs);
        const { fp, summary } = fingerprint(text);
        await mutate($, (s) => {
          const prior = findIncident(s, key);
          // Baseline refresh: a change git saw since the last failure starts a new epoch (a new Case B chain).
          const st0 = prior?.baseToken && after && after !== prior.baseToken ? { ...s, epoch: s.epoch + 1 } : s;
          const st1 = recordAfter(prune(st0, at, o), scope, action, category!, toOutcome(cls, text), at, o);
          tr = onFail(st1, { key, agent, action, errorKey: fp, summary, epoch: st1.epoch, token: after, now: at, kind: 'verify',
            attempt: { tool, action: redact(k.raw ?? action, 220), error: redact(text, 400) } }, { maxRecoveryStrategies: o.maxRecoveryStrategies, ttlMinutes: o.failureRecordTtlMinutes });
          return tr.s;
        });
      } else if (cls === 'PASS') {
        await mutate($, (s) => {
          const st1 = recordAfter(prune(s, at, o), scope, action, category!, toOutcome(cls, text), at, o);
          tr = onPass(st1, key, at);
          return tr ? tr.s : st1;
        });
      }
      const t = tr as Transition | null;
      await emit($, o, { ...base, event: t ? t.event : 'run', classification: cls, reason: why, action: 'allow', preReason: reason,
        errorKey: t?.inc.errorKey, incidentId: t?.inc.id, incidentState: t?.inc.state, mutatingSinceLast: t?.inc.strategies.length,
        stateToken: after?.slice(0, 12), hookMs: preMs + (Date.now() - tRan) });
      if (cls === 'FAIL') {
        await capture($, o, { event: 'attempt_failed', agent, tool, incident: t?.inc, coreClass: cls, commandKey: k.core, errorFp: t?.inc.errorKey, errorSummary: t?.inc.summary });
        return withNote(ran, await advise($, o, mode, key, agent, tool, base));
      }
      if (t?.event === 'incident_closed') await capture($, o, { event: 'closed', agent, tool, incident: t.inc, outcome: 'pass' });
    } catch { /* never break the call over bookkeeping */ }
    return ran;
  }).catch(($, e, next) => next(e)); // any guard failure: the call runs as if the mod were absent

}
