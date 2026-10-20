// haiku-pace: per-step effort for Haiku model requests, plus a guard for Bash calls that would
// hold a turn for minutes. Rules decide the routine steps for free; TypeSafe Jev is asked only on
// pivot steps (turn start, after a failure, after a big edit). Every error falls back to the
// session's own effort (or `high` on a pivot) and never blocks a request.
// Mode: userConfig paceMode (apply by default), /haiku-pace for this session, env HAIKU_PACE wins.
import type { EngineInterface, Register } from 'claude-code';
import {
  type Effort, type PaceMode, type PaceOptions, type StepCall, actionOf, chooseEffort, classifyStep,
  editedLinesOf, failureOf, guardCommand, isEffort, isReadOnlyCall, paceRequest, parsePace,
  readPaceOptions, resolvePaceMode,
} from './core.ts';
import type { ChoiceAnswer } from '../reliability/core.ts';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const MAX_LOG = 1_000_000;

const isHaiku = (model: string | undefined) => /haiku/i.test(model ?? '');
const TRACKED = ['Bash', 'PowerShell', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'ToolSearch', 'Skill', 'Agent'];

type Loop = { model?: string; calls: StepCall[] };
type ClassStats = { steps: number; ms: number[]; out: number[] };
type Stats = { steps: number; changed: number; jevCalls: number; jevErrors: number; jevMs: number[]; guarded: number; byClass: Record<string, ClassStats> };

// Engine-handle helpers sit in this file: the runtime follows $ only into functions declared here.
async function sessionId($: EngineInterface): Promise<string> {
  try { return (await $.session.id()) || 'unknown'; } catch { return 'unknown'; }
}

async function emit($: EngineInterface, o: PaceOptions, ev: Record<string, unknown>): Promise<void> {
  if (!o.telemetry) return;
  try {
    const sid = await sessionId($);
    if (sid === 'unknown') return;
    const path = `${(o.telemetryDir || `${$.plugin.root}/telemetry`).replace(/\\/g, '/').replace(/\/+$/, '')}/pace-${sid}.jsonl`;
    let prev = await $.fs.read(path).catch(() => '');
    if (prev.length > MAX_LOG) prev = prev.slice(prev.indexOf('\n', prev.length / 2) + 1);
    await $.fs.write(path, prev + JSON.stringify({ ts: new Date(await $.clock.now()).toISOString(), ...ev }) + '\n');
  } catch { /* telemetry is best effort */ }
}

/** One decisions call (OpenRouter → TypeSafe Jev), raced against the timeout. The key is never logged. */
async function askJev($: EngineInterface, body: unknown, o: PaceOptions): Promise<ChoiceAnswer | { error: string }> {
  const key = await $.env.get('OPENROUTER_API_KEY').catch(() => undefined);
  if (!key) return { error: 'no_key' };
  type R = ChoiceAnswer | { error: string };
  const call = $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: JEV_MODEL, ...(body as object) }),
  }).then((r): R => {
    if (!r.ok) return { error: `http_${r.status}` };
    try { return parsePace(JSON.parse(r.text)); } catch { return { error: 'invalid_json' }; }
  }, (): R => ({ error: 'network' }));
  const timeout = $.clock.sleep(o.jevTimeoutMs).then((): R => ({ error: 'timeout' }));
  return Promise.race([call, timeout]);
}

/** env HAIKU_PACE, then /haiku-pace for this session, then userConfig paceMode. */
async function modeOf($: EngineInterface, o: PaceOptions, override: PaceMode | undefined): Promise<{ mode: PaceMode; source: string }> {
  const env = await $.env.get('HAIKU_PACE').catch(() => undefined);
  const mode = resolvePaceMode(env ?? undefined, override, o.mode);
  const source = env && /^(off|shadow|apply)$/i.test(env.trim()) ? `env HAIKU_PACE=${env.trim()}` : override ? '/haiku-pace (this session)' : 'userConfig paceMode';
  return { mode, source };
}

const p50 =(xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

function statusText(mode: PaceMode, source: string, o: PaceOptions, s: Stats): string {
  const rows = Object.entries(s.byClass).map(([k, c]) => `  ${k.padEnd(7)} ${String(c.steps).padStart(4)} steps  p50 ${(p50(c.ms) / 1000).toFixed(1)} s  p50 out ${p50(c.out)} tok`);
  return [
    `haiku-pace: ${mode} (${source})`,
    `steps ${s.steps}, effort changed on ${s.changed}; Jev ${o.jev ? `${s.jevCalls}/${o.jevBudget} calls, ${s.jevErrors} errors, p50 ${p50(s.jevMs)} ms` : 'off'}; long commands stopped ${s.guarded}`,
    ...rows,
    'usage: /haiku-pace status | apply | shadow | off | auto',
  ].join('\n');
}

export function registerPace(on: Parameters<Register>[0], options: Parameters<Register>[1]): void {
  const o = readPaceOptions(options as Readonly<Record<string, unknown>>);
  const loops = new Map<string, Loop>();
  const stats: Stats = { steps: 0, changed: 0, jevCalls: 0, jevErrors: 0, jevMs: [], guarded: 0, byClass: {} };
  let override: PaceMode | undefined;
  const loopOf = (agentId?: string) => {
    const k = agentId ?? 'main';
    if (!loops.has(k)) loops.set(k, { calls: [] });
    return loops.get(k)!;
  };

  on('command.run', { command: 'haiku-pace' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase();
    if (arg === 'apply' || arg === 'shadow' || arg === 'off') override = arg;
    else if (arg === 'auto') override = undefined;
    const { mode, source } = await modeOf($, o, override);
    return { text: statusText(mode, source, o, stats) };
  });

  // Long-command guard, then the call's outcome for the next step's class.
  // A matcher keeps this apart from haiku-100k's own unmatched tool.call (the 100k cut). Calls to
  // other tools (MCP) are not tracked: a step after only those counts as `normal`.
  on('tool.call', { tool: TRACKED }, async ($, e, next) => {
    const loop = loopOf(e.agentId);
    const input = e as unknown as Record<string, unknown>;
    const command = typeof input.command === 'string' ? input.command : undefined;
    const model = loop.model ?? (e.agentId === undefined ? await $.session.model().catch(() => undefined) : undefined);
    if (e.tool === 'Bash' && command && isHaiku(model)) {
      const { mode } = await modeOf($, o, override);
      const deny = mode === 'off' ? null : guardCommand(command, input.run_in_background === true);
      if (deny) {
        stats.guarded++;
        await emit($, o, { event: 'guard', mode, agentId: e.agentId ?? 'main', action: actionOf('Bash', input), applied: mode === 'apply' });
        if (mode === 'apply') {
          loop.calls.push({ tool: 'Bash', action: actionOf('Bash', input), readOnly: false, failed: true, error: deny, editedLines: 0 });
          return { deny };
        }
      }
    }
    const ran = await next(e);
    const r = ran as { deny?: string; isError?: boolean; text?: string; isReadOnly?: boolean };
    const { failed, error } = failureOf(r);
    loop.calls.push({
      tool: e.tool, action: actionOf(e.tool, input), readOnly: isReadOnlyCall(e.tool, command, r.isReadOnly === true),
      failed, error, editedLines: editedLinesOf(e.tool, input),
    });
    if (loop.calls.length > 20) loop.calls.splice(0, loop.calls.length - 20);
    return ran;
  }).catch(($, e, next) => next(e)); // fail open: a broken guard never blocks a tool

  // Haiku requests only (the matcher); other models' steps never reach this hook.
  on('turn.step', { model: /haiku/i }, async function* ($, e, next) {
    const loop = loopOf(e.agentId);
    loop.model = e.model;
    const calls = loop.calls;
    loop.calls = [];
    let mode: PaceMode = 'off';
    try { mode = (await modeOf($, o, override)).mode; } catch { /* off */ }
    if (mode === 'off' || !isEffort(e.effort)) return yield* next(e);

    const { cls, reason } = classifyStep(e.index, calls, o.bigEditLines);
    let jev: ChoiceAnswer | null = null;
    let jevMs: number | undefined;
    let jevError: string | undefined;
    if (cls === 'pivot' && o.jev && stats.jevCalls < o.jevBudget) {
      stats.jevCalls++;
      const t = await $.clock.now();
      try {
        const r = await askJev($, paceRequest({ subagent: e.agentId !== undefined, index: e.index, reason, calls }), o);
        if ('error' in r) { jevError = r.error; stats.jevErrors++; } else jev = r;
      } catch { jevError = 'exception'; stats.jevErrors++; }
      jevMs = (await $.clock.now()) - t;
      stats.jevMs.push(jevMs);
    }
    const { effort, source } = chooseEffort(cls, e.effort as Effort, jev, o.jevMinConfidence);
    const send = mode === 'apply' && effort !== e.effort;
    if (send) stats.changed++;

    const t0 = await $.clock.now();
    const res = yield* next(send ? { ...e, effort } : e);
    const ms = (await $.clock.now()) - t0;
    const u = res.usage as (Record<string, number> & { model?: string }) | null;
    stats.steps++;
    const c = (stats.byClass[cls] ??= { steps: 0, ms: [], out: [] });
    c.steps++; c.ms.push(ms); c.out.push(u?.output_tokens ?? 0);
    await emit($, o, {
      event: 'step', mode, agentId: e.agentId ?? 'main', turnId: e.turnId, index: e.index, cls, reason,
      effortBefore: e.effort, effortChosen: effort, applied: send, source,
      ...(jev ? { jev: jev.choice, jevP: Number(jev.p.toFixed(2)) } : {}), ...(jevError ? { jevError } : {}), ...(jevMs !== undefined ? { jevMs } : {}),
      ms, out: u?.output_tokens ?? null, cacheRead: u?.cache_read_input_tokens ?? null, cacheWrite: u?.cache_creation_input_tokens ?? null,
      stop: res.stopReason, tools: res.toolUses.length,
    });
    return res;
  });
}
