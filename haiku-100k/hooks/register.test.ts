import { test, expect } from 'claude-code/testing'
import { keepChars, cut, isHaiku, contextOf, shouldDefer, HEADROOM, CHARS_PER_TOKEN, MIN_KEEP_CHARS } from './register'

test('a result that fits under the headroom is kept whole', () => {
  expect(keepChars(50_000, 10_000)).toBe(null)
})

test('a result that would cross the headroom is cut to what fits', () => {
  const keep = keepChars(80_000, 200_000)
  expect(keep).toBe(Math.floor((HEADROOM - 80_000) * CHARS_PER_TOKEN))
})

test('a context already past the headroom still keeps a minimum', () => {
  expect(keepChars(99_000, 50_000)).toBe(MIN_KEEP_CHARS)
})

test('cut keeps head and tail and says how to get the rest', () => {
  const text = 'H'.repeat(10_000) + 'T'.repeat(10_000)
  const out = cut(text, 4_000)
  expect(out.startsWith('H'.repeat(2_800))).toBe(true)
  expect(out.endsWith('T'.repeat(1_200))).toBe(true)
  expect(out.includes('16000 chars cut')).toBe(true)
})

test('only Haiku models are guarded; context sums input and cache tokens', () => {
  expect(isHaiku('claude-haiku-5-5')).toBe(true)
  expect(isHaiku('claude-opus-5-5')).toBe(false)
  expect(contextOf({ input_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5_000 })).toBe(95_010)
})

test('a tool call with no Haiku step seen passes through unchanged', async ($, on) => {
  on('tool.call', () => ({ result: 'x'.repeat(500_000) } as never))
  const r = await $.tool.call({ tool: 'Bash', command: 'cat big.log' } as never)
  expect(r.deny).toBe(undefined)
})

test('slimming keeps core and app tools in front, defers the rest', () => {
  for (const t of ['Bash', 'Read', 'Edit', 'Agent', 'ToolSearch', 'mcp__ccd_turn__update_plan', 'mcp__ccd_session__start_session']) expect(shouldDefer(t)).toBe(false)
  for (const t of ['Artifact', 'Workflow', 'PowerShell', 'mcp__Claude_Browser__navigate', 'mcp__visualize__show_widget']) expect(shouldDefer(t)).toBe(true)
  expect(shouldDefer('Artifact', true)).toBe(false)
})
