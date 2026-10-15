// retry-loop-breaker: stops a repeated validation command (test/build) that already
// failed the same way with nothing changed since. Observe mode (default) only logs
// what it would block; enforce mode refuses the call with `{ deny }` before it runs.
// Deterministic rules decide; TypeSafe JEV is asked only about near-duplicates.
import type { EngineInterface, Register } from 'claude-code';
import type { GuardState } from '../types/index.d.ts';
import {
  type Options, type Outcome, bashMayMutate, classify, decideBefore, denialText, emptyState,
  jevBlocks, jevRequest, parseJev, prune, readOptions, recordAfter, RETRY_REQUEST, type JevVerdict,
} from './core.ts';

const GUARD = { plugin: 'retry-loop-breaker', key: 'guard' } as const;
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const DENIED = /(permission|denied|doesn't want to proceed|rejected|not allowed)/i;

async function load($: EngineInterface): Promise<{ s: GuardState; v: number }> {
  const { value, version } = await $.state.get(GUARD);
  return { s: value ?? emptyState(), v: version };
}

/** Read-modify-write with one retry on a version race. */
async function mutate($: EngineInterface, fn: (s: GuardState) => GuardState): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const { s, v } = await load($);
    const { isSet } = await $.state.set(GUARD, fn(s), { ifVersion: v });
    if (isSet) return;
  }
}

const audit = (s: GuardState, action: string, decision: string, reason: string, jev?: string): GuardState =>
  ({ ...s, audit: [...s.audit, { t: Date.now(), action: action.slice(0, 120), decision, reason, ...(jev ? { jev } : {}) }].slice(-50) });

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

function outcomeOf(ran: { deny?: string; isError?: true; text?: string; result?: unknown }): Outcome {
  if (ran.deny !== undefined) return { kind: 'ignored', reason: 'denied' };
  const r = ran.result as { interrupted?: boolean; backgroundTaskId?: string } | undefined;
  if (r && typeof r === 'object' && (r.interrupted || r.backgroundTaskId)) return { kind: 'ignored', reason: 'interrupted_or_background' };
  if (ran.isError) {
    const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '');
    if (!/exit code/i.test(text) && DENIED.test(text)) return { kind: 'ignored', reason: 'permission' };
    if (/interrupted/i.test(text) && !/exit code/i.test(text)) return { kind: 'ignored', reason: 'interrupted' };
    return { kind: 'failed', text };
  }
  return { kind: 'passed' };
}

export const register: Register = (on, options) => {
  const o = readOptions(options);

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'retry-guard', description: 'retry-loop-breaker: status | reset' });
    return next(e);
  });

  on('command.run', { command: 'retry-guard' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      await mutate($, (s) => ({ ...emptyState(), stats: s.stats, audit: audit(s, '-', 'reset', 'user').audit }));
      return { text: 'retry-loop-breaker: records cleared for this session.' };
    }
    const { s } = await load($);
    const recs = s.records.map((r) => `- ${r.normalized_action} ×${r.repeat_count} ${r.error_fingerprint}${r.transient ? ' (transient)' : ''} epoch ${r.state_epoch}`);
    const log = s.audit.slice(-8).map((a) => `- ${a.decision} ${a.reason}${a.jev ? ` [jev ${a.jev}]` : ''}: ${a.action}`);
    return { text: [`retry-loop-breaker: mode ${o.mode}, threshold ${o.maxIdenticalFailuresBeforeBlock}, epoch ${s.epoch}`,
      `stats ${JSON.stringify(s.stats)}`, 'records:', ...(recs.length ? recs : ['- none']), 'recent:', ...(log.length ? log : ['- none'])].join('\n') };
  });

  // The user asking for a rerun is new information: it starts a new epoch.
  on('prompt.submit', async ($, e, next) => {
    if (RETRY_REQUEST.test(e.text)) await mutate($, (s) => ({ ...s, epoch: s.epoch + 1 }));
    return next(e);
  }).catch(($, e, next) => next(e));

  // Edits from any loop (subagents too) change the state the failures were seen in.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e);
    if (ran.deny === undefined && ran.isError !== true) await mutate($, (s) => ({ ...s, epoch: s.epoch + 1 }));
    return ran;
  }).catch(($, e, next) => next(e));

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const category = classify(e.command, o.extraEligible);
    if (!category) {
      const ran = await next(e);
      if (ran.deny === undefined && bashMayMutate(e.command, ran.isReadOnly === true)) await mutate($, (s) => ({ ...s, epoch: s.epoch + 1 }));
      return ran;
    }
    if (o.mainAgentOnly && e.agentId !== undefined) return next(e);

    const now = await $.clock.now();
    const workspace = await $.session.cwd().catch(() => '?');
    const { s: before } = await load($);
    const d = decideBefore(prune(before, now, o), workspace, e.command, now, o);

    let block = d.kind === 'block';
    let jevNote: string | undefined;
    if (d.kind === 'ambiguous' && o.jevEnabled) {
      const v = await askJev($, jevRequest(d.record, e.command, false), o);
      jevNote = 'error' in v ? `error:${v.error}` : `${v.decision}@${v.confidence.toFixed(2)}`;
      block = jevBlocks(v, o); // onJevError = allow
      await mutate($, (s) => ({ ...s, stats: { ...s.stats, jevCalls: s.stats.jevCalls + 1, jevErrors: s.stats.jevErrors + ('error' in v ? 1 : 0) } }));
    }

    if (block && d.kind !== 'pass') {
      const enforce = o.mode === 'enforce';
      await mutate($, (s) => audit({ ...s, stats: { ...s.stats, eligible: s.stats.eligible + 1, wouldBlock: s.stats.wouldBlock + 1, blocked: s.stats.blocked + (enforce ? 1 : 0) } },
        e.command, enforce ? 'blocked' : 'would_block', d.reason, jevNote));
      if (enforce) return { deny: denialText(d.record, d.kind === 'ambiguous') };
    } else {
      await mutate($, (s) => audit({ ...s, stats: { ...s.stats, eligible: s.stats.eligible + 1 } }, e.command, 'allow', d.reason, jevNote));
    }

    const ran = await next(e);
    try {
      const out = outcomeOf(ran);
      const at = await $.clock.now();
      await mutate($, (s) => recordAfter(prune(s, at, o), workspace, e.command, category, out, at, o));
    } catch { /* never break the call over bookkeeping */ }
    return ran;
  }).catch(($, e, next) => next(e)); // any guard failure: the call runs as if the mod were absent
};
