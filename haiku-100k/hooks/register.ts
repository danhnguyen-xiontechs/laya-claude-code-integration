import type { Register } from 'claude-code'

// Keeps every Haiku model request under the 100k-token price step (input ≤ 100k is the cheap tier).
// The engine's own auto-compact (window 100000 for Haiku, set in settings and in haiku-case.md) does the
// compacting before a request; this mod covers what it cannot:
//  - a single tool result big enough to push the next request past the limit is cut to head + tail
//    (the model is told how to get the rest), and
//  - every Haiku request above the limit is counted and shown, so a leak is visible, never silent.
// Main session and subagents are tracked per loop (e.agentId, absent on main).

export const LIMIT = 100_000 // the price step
export const HEADROOM = 92_000 // what a request may reach after the next tool result is added
export const CHARS_PER_TOKEN = 3.5 // conservative estimate for code and logs
export const MIN_KEEP_CHARS = 4_000 // a cut result still shows this much

export const isHaiku = (model: string | undefined) => /haiku/i.test(model ?? '')
export const contextOf = (u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null | undefined) =>
  u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : undefined

/** How many characters of a tool result fit before the next request crosses HEADROOM; null = keep it whole. */
export function keepChars(lastContext: number, resultChars: number): number | null {
  const left = Math.max(0, HEADROOM - lastContext) * CHARS_PER_TOKEN
  return resultChars <= left ? null : Math.max(MIN_KEEP_CHARS, Math.floor(left))
}

export function cut(text: string, keep: number): string {
  const head = Math.floor(keep * 0.7)
  const tail = keep - head
  return `${text.slice(0, head)}\n[haiku-100k: ${text.length - keep} chars cut so the next request stays under 100k tokens; re-run narrower (grep -n, head, a line range) for the part you need]\n${text.slice(-tail)}`
}

type Loop = { model?: string; context?: number }

export const register: Register = on => {
  const loops = new Map<string, Loop>()
  let over = 0
  const loopOf = (agentId?: string) => {
    const k = agentId ?? 'main'
    if (!loops.has(k)) loops.set(k, {})
    return loops.get(k)!
  }

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    const loop = loopOf(e.agentId)
    loop.model = res.usage?.model ?? e.model
    loop.context = contextOf(res.usage) ?? loop.context
    if (isHaiku(loop.model) && (loop.context ?? 0) > LIMIT) {
      over++
      $.ui.toast(`haiku-100k: a Haiku request was ${Math.round((loop.context ?? 0) / 1000)}k tokens (> 100k price step), ${over} this session`)
    }
    return res
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const loop = loopOf(e.agentId)
    if (ran.deny !== undefined || !isHaiku(loop.model) || typeof ran.text !== 'string') return ran
    const keep = keepChars(loop.context ?? 0, ran.text.length)
    if (keep === null) return ran
    return { deny: cut(ran.text, keep) }
  }).catch(($, e, next) => next(e)) // fail open: a broken guard never blocks a tool
}
