// effort-pace: per-step effort for Haiku and Sonnet model requests, plus a guard for Bash calls that
// would hold a turn for minutes (every model). Rules decide the routine steps for free; TypeSafe Jev
// is asked only on pivot steps (turn start, after a failure, after a big edit). Every error falls back
// to the session's own effort (or `high` on a pivot) and never blocks a request. Opus is not paced.
// Mode: userConfig paceMode (apply by default), /effort-pace for this session, env EFFORT_PACE wins.
// EFFORT_PACE=off is the kill switch for everything; /effort-pace off keeps the long-command guard on.
import type { EngineInterface, Register } from 'claude-code';
import {
  type Effort, type PaceMode, type PaceOptions, type StepCall, actionOf, chooseEffort, classifyStep,
  editedLinesOf, failureOf, guardCommand, guardStateOf, isEffort, isReadOnlyCall, paceRequest, parsePace,
  readPaceOptions, resolvePaceMode,
} from './core.ts';
import type { ChoiceAnswer } from '../reliability/core.ts';

const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const MAX_LOG = 1_000_000;

/** Models whose requests get a per-step effort. Opus never reaches the turn.step hook. */
const PACED = /haiku|sonnet/i;
const TRACKED = ['Bash', 'PowerShell', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'ToolSearch', 'Skill', 'Agent'];

type Row = Record<string, unknown>;
type Loop = { calls: StepCall[] };
type ClassStats = { steps: number; ms: number[]; out: number[] };
type Stats = { steps: number; changed: number; jevCalls: number; jevErrors: number; jevMs: number[]; guarded: number; switches: Record<string, number>; byClass: Record<string, ClassStats> };
type State = { mode: PaceMode; source: string; guard: 'deny' | 'log' | 'killed' };

// Engine-handle helpers sit in this file: the runtime follows $ only into functions declared here.
async function sessionId($: EngineInterface): Promise<string> {
  try { return (await $.session.id()) || 'unknown'; } catch { return 'unknown'; }
}

async function pathOf($: EngineInterface, o: PaceOptions): Promise<string | null> {
  const sid = await sessionId($);
  if (sid === 'unknown') return null;
  return `${(o.telemetryDir || `${$.plugin.root}/telemetry`).replace(/\\/g, '/').replace(/\/+$/, '')}/pace-${sid}.jsonl`;
}

async function emit($: EngineInterface, o: PaceOptions, ev: Row): Promise<void> {
  if (!o.telemetry) return;
  try {
    const path = await pathOf($, o);
    if (!path) return;
    let prev = await $.fs.read(path).catch(() => '');
    if (prev.length > MAX_LOG) prev = prev.slice(prev.indexOf('\n', prev.length / 2) + 1);
    await $.fs.write(path, prev + JSON.stringify({ ts: new Date(await $.clock.now()).toISOString(), ...ev }) + '\n');
  } catch { /* telemetry is best effort */ }
}

/** This session's telemetry rows, or null when telemetry is off or the session id is unknown. */
async function rowsOf($: EngineInterface, o: PaceOptions): Promise<Row[] | null> {
  if (!o.telemetry) return null;
  try {
    const path = await pathOf($, o);
    if (!path) return null;
    const text = await $.fs.read(path).catch(() => '');
    return text.split('\n').flatMap((line) => { try { return line ? [JSON.parse(line) as Row] : []; } catch { return []; } });
  } catch { return null; }
}

/** The status counts come from the same rows the Jev budget reads, so they cannot disagree. */
function statsOfRows(rows: Row[]): Stats {
  const s: Stats = { steps: 0, changed: 0, jevCalls: 0, jevErrors: 0, jevMs: [], guarded: 0, switches: {}, byClass: {} };
  for (const r of rows) {
    if (r.event === 'guard') { if (r.applied === true) s.guarded++; continue; }
    if (r.event !== 'step') continue;
    s.steps++;
    if (r.applied === true) {
      s.changed++;
      const k = `${r.effortBefore}→${r.effortChosen}`;
      s.switches[k] = (s.switches[k] ?? 0) + 1;
    }
    if (typeof r.jevMs === 'number') { s.jevCalls++; s.jevMs.push(r.jevMs); }
    if (typeof r.jevError === 'string') s.jevErrors++;
    const c = (s.byClass[String(r.cls)] ??= { steps: 0, ms: [], out: [] });
    c.steps++; c.ms.push(Number(r.ms) || 0); c.out.push(Number(r.out) || 0);
  }
  return s;
}

/** Jev calls this session: the file's count (it survives a reload), never below this process's count. */
async function jevUsed($: EngineInterface, o: PaceOptions, inMemory: number): Promise<number> {
  const rows = await rowsOf($, o);
  return Math.max(inMemory, rows ? statsOfRows(rows).jevCalls : 0);
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

/** env EFFORT_PACE, then /effort-pace for this session, then userConfig paceMode. Never throws. */
async function stateOf($: EngineInterface, o: PaceOptions, override: PaceMode | undefined): Promise<State> {
  // HAIKU_PACE is the pre-0.9 name, read as a fallback for one version.
  const env = (await $.env.get('EFFORT_PACE').catch(() => undefined)) ?? (await $.env.get('HAIKU_PACE').catch(() => undefined)) ?? undefined;
  const mode = resolvePaceMode(env, override, o.mode);
  const source = env && /^(off|shadow|apply)$/i.test(env.trim()) ? `env EFFORT_PACE=${env.trim()}` : override ? '/effort-pace (this session)' : 'userConfig paceMode';
  return { mode, source, guard: guardStateOf(env, mode) };
}

const p50 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

function statusText(st: State, o: PaceOptions, s: Stats): string {
  const rows = Object.entries(s.byClass).map(([k, c]) => `  ${k.padEnd(7)} ${String(c.steps).padStart(4)}  p50 ${(p50(c.ms) / 1000).toFixed(1)} s  out ${p50(c.out)}`);
  const guard = st.guard === 'killed' ? 'guard off (EFFORT_PACE=off)' : st.guard === 'log' ? 'guard log only (shadow)' : '';
  const switches = Object.entries(s.switches).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`);
  return [
    `effort-pace: ${st.mode} (${st.source})${guard ? `; ${guard}` : ''}`,
    `effort: ${switches.length ? switches.join(', ') : 'no switches'}`,
    `steps ${s.steps} · changed ${s.changed} · Jev ${o.jev ? `${s.jevCalls}/${o.jevBudget} (${s.jevErrors} err, p50 ${p50(s.jevMs)} ms)` : 'off'} · long commands stopped ${s.guarded}`,
    ...rows,
    'usage: /effort-pace status | apply | shadow | off | auto',
  ].join('\n');
}

export function registerPace(on: Parameters<Register>[0], options: Parameters<Register>[1]): void {
  const o = readPaceOptions(options as Readonly<Record<string, unknown>>);
  const loops = new Map<string, Loop>();
  const stats: Stats = { steps: 0, changed: 0, jevCalls: 0, jevErrors: 0, jevMs: [], guarded: 0, switches: {}, byClass: {} };
  let override: PaceMode | undefined;
  const loopOf = (agentId?: string) => {
    const k = agentId ?? 'main';
    if (!loops.has(k)) loops.set(k, { calls: [] });
    return loops.get(k)!;
  };

  // /haiku-pace is the pre-0.9 name: the same command, kept for one version.
  on('command.run', { command: ['effort-pace', 'haiku-pace'] }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase();
    if (arg === 'apply' || arg === 'shadow' || arg === 'off') override = arg;
    else if (arg === 'auto') override = undefined;
    const st = await stateOf($, o, override);
    const rows = await rowsOf($, o);
    return { text: statusText(st, o, rows?.length ? statsOfRows(rows) : stats) };
  });

  // Long-command guard, then the call's outcome for the next step's class. Every model: a Bash call
  // from Opus is guarded too. A matcher keeps this apart from haiku-100k's own unmatched tool.call.
  // Calls to other tools (MCP) are not tracked: a step after only those counts as `normal`.
  on('tool.call', { tool: TRACKED }, async ($, e, next) => {
    const loop = loopOf(e.agentId);
    const input = e as unknown as Record<string, unknown>;
    const command = typeof input.command === 'string' ? input.command : undefined;
    if (e.tool === 'Bash' && command) {
      const st = await stateOf($, o, override);
      const deny = st.guard === 'killed' ? null : guardCommand(command, input.run_in_background === true);
      if (deny) {
        const applied = st.guard === 'deny';
        if (applied) stats.guarded++;
        await emit($, o, { event: 'guard', mode: st.mode, agentId: e.agentId ?? 'main', action: actionOf('Bash', input), applied });
        if (applied) {
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

  // Haiku and Sonnet requests only (the matcher); Opus steps never reach this hook.
  on('turn.step', { model: PACED }, async function* ($, e, next) {
    const loop = loopOf(e.agentId);
    const calls = loop.calls;
    loop.calls = [];
    const st = await stateOf($, o, override);
    // The matcher already leaves Opus out; this check keeps Opus untouched even if the hook is called directly.
    if (!PACED.test(e.model ?? '') || st.mode === 'off' || !isEffort(e.effort)) return yield* next(e);

    const { cls, reason } = classifyStep(e.index, calls, o.bigEditLines);
    const pivot = cls === 'pivot';
    let jev: ChoiceAnswer | null = null;
    let jevMs: number | undefined;
    let jevError: string | undefined;
    let asked = false;
    if (pivot && o.jev && (await jevUsed($, o, stats.jevCalls)) < o.jevBudget) {
      asked = true;
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
    const applied = st.mode === 'apply' && effort !== e.effort;
    if (applied) {
      stats.changed++;
      const k = `${e.effort}→${effort}`;
      stats.switches[k] = (stats.switches[k] ?? 0) + 1;
    }
    // Why a pivot's Jev answer did or did not decide the effort, for the telemetry and the status.
    const why = !pivot ? undefined
      : !o.jev ? 'jev_off'
      : !asked ? 'budget_exhausted'
      : source === 'explicit_high' ? 'explicit_xhigh'
      : jevError ? `error:${jevError}`
      : !jev ? 'no_answer'
      : jev.p < o.jevMinConfidence ? 'low_confidence'
      : jev.choice === e.effort ? 'jev_same_as_session'
      : 'jev_chosen';

    const t0 = await $.clock.now();
    const res = yield* next(applied ? { ...e, effort } : e);
    const ms = (await $.clock.now()) - t0;
    const u = res.usage as (Record<string, number> & { model?: string }) | null;
    stats.steps++;
    const c = (stats.byClass[cls] ??= { steps: 0, ms: [], out: [] });
    c.steps++; c.ms.push(ms); c.out.push(u?.output_tokens ?? 0);
    await emit($, o, {
      event: 'step', mode: st.mode, agentId: e.agentId ?? 'main', model: e.model, turnId: e.turnId, index: e.index, cls, reason,
      effortBefore: e.effort, effortChosen: effort, applied, source,
      ...(why ? { why } : {}),
      ...(jev ? { jev: jev.choice, jevP: Number(jev.p.toFixed(2)) } : {}), ...(jevError ? { jevError } : {}), ...(jevMs !== undefined ? { jevMs } : {}),
      ms, out: u?.output_tokens ?? null, cacheRead: u?.cache_read_input_tokens ?? null, cacheWrite: u?.cache_creation_input_tokens ?? null,
      stop: res.stopReason, tools: res.toolUses.length,
    });
    return res;
  });
}
