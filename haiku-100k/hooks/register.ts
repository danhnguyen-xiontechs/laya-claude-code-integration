import type { Register } from 'claude-code'
// agent-reliability (retry-loop guard, observe by default): a shipped copy, see ./reliability.
import { registerHooks } from './reliability/register.ts'
import { RECOVERY_AGENT, RECOVERY_PROMPT } from './reliability/incident.ts'
// effort-pace: per-step effort for Haiku, Sonnet and Opus (rules + Jev on pivot steps) and the long-command guard.
import { registerPace } from './pace/register.ts'

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

// Slimmer start for Haiku sessions: tools a Haiku session rarely needs go behind ToolSearch (deferred). Only the
// name stays in the prompt; the model loads the schema by name when it needs one. Decided once per session (the
// tool list is the cached prefix: changing it mid-session would rewrite the whole cache).
// Measured in an app session (2026-10-19): system tools 24.8k, loaded MCP tools 17.7k (browser 7.8k) of a ~73k start.
export const KEEP_TOOLS = new Set(['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write', 'Skill', 'ToolSearch', 'AskUserQuestion'])
export const KEEP_MCP = /^mcp__(ccd_turn|ccd_session)__/ // the app's task list / wrap-up and session tools stay in front
export const shouldDefer = (tool: string, isDeferred?: boolean) =>
  !isDeferred && (tool.startsWith('mcp__') ? !KEEP_MCP.test(tool) : !KEEP_TOOLS.has(tool))

type Loop = { model?: string; context?: number }

export const register: Register = (on, options) => {
  const loops = new Map<string, Loop>()
  let over = 0
  const loopOf = (agentId?: string) => {
    const k = agentId ?? 'main'
    if (!loops.has(k)) loops.set(k, {})
    return loops.get(k)!
  }

  // /haiku-100k:base — what the fixed start of every request is made of (as /context counts it), saved as JSON.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'base', description: 'haiku-100k: save the context breakdown (what every request starts with) to ~/.claude/haiku-100k-base.json' })
    // agent-reliability's session work, written out here: the runtime follows $ only within this file,
    // so startSession($) cannot be imported. Keep in step with startSession in reliability/register.ts.
    await $.command.register({ name: 'reliability', description: 'agent-reliability: status | observe | enforce | off | auto | reset | allow <n|all>' })
    await $.command.register({ name: 'effort-pace', description: 'effort-pace: status | apply | shadow | off | auto (per-step effort for Haiku, Sonnet and Opus)' })
    await $.command.register({ name: 'haiku-pace', description: 'Alias of /effort-pace, kept for one version' })
    await $.command.register({ name: 'retry-guard', description: 'Alias of /reliability (status | reset), kept from retry-loop-breaker' })
    await $.agent.register({
      name: RECOVERY_AGENT, model: 'opus', prompt: RECOVERY_PROMPT,
      description: 'Recovery engineer (Opus) for a verification that keeps failing after two recovery attempts. Only when agent-reliability asks for it.',
    }).catch(() => undefined)
    return next(e)
  })
  on('command.run', { command: 'base' }, async $ => {
    const file = `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))}/.claude/haiku-100k-base.json`
    const u = await $.session.usage({ breakdown: 'full' })
    await $.fs.write(file, JSON.stringify(u.context, null, 1))
    return { text: `haiku-100k: context breakdown saved to ${file}` }
  })

  on('tool.describe', async ($, e, next) => {
    const res = await next(e)
    if ((await $.env.get('HAIKU_100K_SLIM')) === '0') return res
    if (!isHaiku(await $.session.model()) || !shouldDefer(e.tool, e.isDeferred)) return res
    return { ...res, isDeferred: true }
  })

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

  registerPace(on, options) // per-step effort for Haiku (userConfig paceMode / paceJev …)
  registerHooks(on, options) // agent-reliability's other hooks (userConfig mode/ruleA/telemetryDir…)
}
