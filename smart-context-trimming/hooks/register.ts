// smart-context-trimming: compacts long Bash test/build output before Claude reads it.
//
// Phase 0 (Claude Code 2.1.295 types, proven live with `claude -p --plugin-dir`):
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
// Modes: observe (default: measure + save raw, change nothing), enforce, off.
// Session switch: /smart-trim off|observe|enforce|status. Env SMART_TRIM_MODE overrides
// the setting at session start.
import type { EngineInterface, Register } from 'claude-code'
import { DEFAULTS, classify, decideAndBuild } from './trim-core.ts'
import type { Mode, Options } from './trim-core.ts'

type Metric = Record<string, unknown>

let dir: string | null = null

async function baseDir($: EngineInterface): Promise<string | null> {
  if (dir) return dir
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  dir = home ? `${home.replace(/\\/g, '/')}/.claude/smart-context-trimming` : null
  return dir
}

export const register: Register = (on, options) => {
  const opt: Options = { ...DEFAULTS, ...(options as Partial<Options>) }
  let sessionMode: Mode | null = null
  const metrics: Metric[] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'smart-trim', description: 'Smart context trimming: off | observe | enforce | status' })
    const env = (await $.env.get('SMART_TRIM_MODE'))?.trim().toLowerCase()
    if (env === 'off' || env === 'observe' || env === 'enforce') sessionMode = env
    // TTL: expired raw logs are emptied (the fs API has no delete).
    try {
      const d = await baseDir($)
      if (d && (await $.fs.exists(`${d}/raw`))) {
        const cutoff = Date.now() - opt.rawOutputTtlHours * 3_600_000
        for (const f of await $.fs.list(`${d}/raw`)) if (f.kind === 'file' && f.size > 0 && f.mtimeMs < cutoff) await $.fs.write(`${d}/raw/${f.name}`, '')
      }
    } catch { /* best effort */ }
    return next(e)
  })

  on('command.run', { command: 'smart-trim' }, async ($, e) => {
    const a = e.args.trim().toLowerCase()
    if (a === 'off' || a === 'observe' || a === 'enforce') sessionMode = a
    else if (a === 'on') sessionMode = 'enforce'
    const mode = sessionMode ?? opt.mode
    const trimmed = metrics.filter((m) => m.action === 'trim')
    const saved = trimmed.reduce((s, m) => s + (Number(m.bytesIn) - Number(m.bytesOut)), 0)
    return { text: `smart-trim: mode ${mode}; ${metrics.length} eligible call(s), ${trimmed.length} trimmable, ${saved} bytes ${mode === 'enforce' ? 'saved' : 'would be saved'}. Raw logs: ${(await baseDir($)) ?? '(none)'}/raw` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const mode = sessionMode ?? opt.mode
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
