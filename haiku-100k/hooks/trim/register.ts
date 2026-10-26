// smart-context-trimming: compacts long Bash test/build output before Claude reads it.
// Source of truth since haiku-100k 0.14.0; bench, fixtures and the node spec stay in
// smart-context-trimming/ and import ./core.ts from here.
//
// Phase 0 (Claude Code 2.1.295 types, proven live with a --plugin-dir headless run):
//   - a successful Bash call answers { ref, result: { stdout, stderr, interrupted, ... }, text };
//     a hook's own { result: { ...result, stdout } } is validated against Bash's output
//     schema and is what the model reads.
//   - a non-zero exit answers { isError: true, result: "Error: Exit code N\n…", text }; a
//     hook's own { isError, result: string } is refused (schema error) and a spread of the
//     core answer with a new `text` is ignored (core reuses `ref`). { deny: text } keeps
//     the error flag and the model reads the text, so an errored result is compacted as
//     a deny whose text starts with the original "Exit code N" line.
//   - permission denials ({ deny }), interrupted, image, background and core-persisted
//     results pass through untouched; unmatched commands are never inspected.
//
// Modes: enforce (default in haiku-100k), observe (measure + save raw, change nothing), off.
// userConfig trimMode / trimMinLines / trimMinBytes / trimJev / trimJevTimeoutMs /
// trimJevMinConfidence / trimRawTtlHours. Session switch: /smart-trim off|observe|enforce|status
// (registered in ../register.ts). Env SMART_TRIM_MODE overrides the setting.
import type { EngineInterface, Register } from 'claude-code'
import { DEFAULTS, classify, decideAndBuild } from './core.ts'
import type { Mode, Options } from './core.ts'

type Metric = Record<string, unknown>

const MODES: readonly Mode[] = ['off', 'observe', 'enforce']
const isMode = (v: unknown): v is Mode => typeof v === 'string' && (MODES as readonly string[]).includes(v)
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** haiku-100k's trim* userConfig → the core's Options (enforce unless the user picked otherwise). */
export function readTrimOptions(raw: Record<string, unknown> = {}): Options {
  return {
    ...DEFAULTS,
    mode: isMode(raw.trimMode) ? raw.trimMode : 'enforce',
    minLines: num(raw.trimMinLines, DEFAULTS.minLines),
    minBytes: num(raw.trimMinBytes, DEFAULTS.minBytes),
    useJev: typeof raw.trimJev === 'boolean' ? raw.trimJev : DEFAULTS.useJev,
    maxJevLatencyMs: num(raw.trimJevTimeoutMs, DEFAULTS.maxJevLatencyMs),
    minJevConfidence: num(raw.trimJevMinConfidence, DEFAULTS.minJevConfidence),
    rawOutputTtlHours: num(raw.trimRawTtlHours, DEFAULTS.rawOutputTtlHours),
  }
}

// Engine-handle helpers sit in this file: the runtime follows $ only into functions declared here.
let dir: string | null = null

async function baseDir($: EngineInterface): Promise<string | null> {
  if (dir) return dir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  dir = home ? `${home.replace(/\\/g, '/')}/.claude/smart-context-trimming` : null
  return dir
}

/** Expired raw logs are emptied (the fs API has no delete). Best effort, once per session. */
async function sweepRaw($: EngineInterface, ttlHours: number): Promise<void> {
  try {
    const d = await baseDir($)
    if (!d || !(await $.fs.exists(`${d}/raw`))) return
    const cutoff = Date.now() - ttlHours * 3_600_000
    for (const f of await $.fs.list(`${d}/raw`)) if (f.kind === 'file' && f.size > 0 && f.mtimeMs < cutoff) await $.fs.write(`${d}/raw/${f.name}`, '')
  } catch { /* best effort */ }
}

type Session = { mode: Mode | null; started: boolean }

/** Session work, on the first Bash call or /smart-trim: the env switch, then the raw-log sweep. */
async function startTrim($: EngineInterface, s: Session, ttlHours: number): Promise<void> {
  if (s.started) return
  s.started = true
  const env = (await $.env.get('SMART_TRIM_MODE').catch(() => undefined))?.trim().toLowerCase()
  if (s.mode === null && isMode(env)) s.mode = env
  await sweepRaw($, ttlHours)
}

export function registerTrim(on: Parameters<Register>[0], options: Parameters<Register>[1]): void {
  const opt = readTrimOptions(options as Record<string, unknown>)
  const s: Session = { mode: null, started: false }
  const metrics: Metric[] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  on('command.run', { command: 'smart-trim' }, async ($, e) => {
    await startTrim($, s, opt.rawOutputTtlHours)
    const a = e.args.trim().toLowerCase()
    if (isMode(a)) s.mode = a
    else if (a === 'on') s.mode = 'enforce'
    const mode = s.mode ?? opt.mode
    const trimmed = metrics.filter((m) => m.action === 'trim')
    const saved = trimmed.reduce((s, m) => s + (Number(m.bytesIn) - Number(m.bytesOut)), 0)
    return { text: `smart-trim: mode ${mode}; ${metrics.length} eligible call(s), ${trimmed.length} trimmable, ${saved} bytes ${mode === 'enforce' ? 'saved' : 'would be saved'}. Raw logs: ${(await baseDir($)) ?? '(none)'}/raw` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await startTrim($, s, opt.rawOutputTtlHours)
    const mode = s.mode ?? opt.mode
    if (mode === 'off' || !classify(e.command)) return next(e)
    const ran = await next(e)
    try {
      if (ran.deny !== undefined) return ran
      let text: string
      let statusLine: string
      if (ran.isError) {
        text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
        const first = text.split('\n', 1)[0] ?? ''
        statusLine = `Command FAILED (${/Exit code \d+/.test(first) ? first.trim() : 'tool error'}); the error status is preserved.`
      } else {
        const r = ran.result
        if (r.interrupted || r.isImage || r.backgroundTaskId || r.persistedOutputPath || r.structuredContent) return ran
        text = r.stderr ? `${r.stdout}\n${r.stderr}` : r.stdout
        statusLine = 'Command succeeded (exit code 0).'
      }
      const d = await baseDir($)
      // Persist the raw output first (only when it could be trimmed); a failed save means no pointer.
      let rawPath: string | null = null
      if (d && (text.length >= opt.minBytes || text.split('\n').length >= opt.minLines)) {
        const p = `${d}/raw/${stamp}-${e.tool_use_id ?? Date.now()}.log`
        try { await $.fs.write(p, text); rawPath = p } catch { /* no pointer */ }
      }
      const jevKey = mode === 'enforce' && opt.useJev ? await $.env.get('OPENROUTER_API_KEY') : undefined
      const out = await decideAndBuild({
        command: e.command, text, opt, statusLine, rawPath,
        jev: mode === 'enforce' && opt.useJev
          ? {
              key: jevKey,
              fetcher: async (url, init) => { const r = await $.http.fetch(url, init); return { ok: r.ok, status: r.status, text: r.text } },
              sleep: (ms) => $.clock.sleep(ms),
              now: () => Date.now(),
            }
          : null,
      })
      metrics.push({
        t: new Date().toISOString(), mode, category: out.plan.category, isError: ran.isError === true,
        action: out.plan.action, reason: out.plan.reason, candidates: out.plan.candidates.length,
        bytesIn: out.built?.bytesIn ?? text.length, bytesOut: out.built?.bytesOut ?? text.length,
        linesIn: out.built?.linesIn, linesOut: out.built?.linesOut, jev: out.jev, rawPath: out.built ? rawPath : null,
      })
      try { if (d) await $.fs.write(`${d}/metrics-${stamp}.jsonl`, metrics.map((m) => JSON.stringify(m)).join('\n') + '\n') } catch { /* metrics are best effort */ }
      if (mode !== 'enforce' || !out.built) return ran
      $.ui.status(`smart-trim: ${out.built.bytesIn} → ${out.built.bytesOut} bytes`)
      if (ran.isError) return { deny: out.built.text }
      return { result: { ...ran.result, stdout: out.built.text, stderr: '' } }
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))
}
