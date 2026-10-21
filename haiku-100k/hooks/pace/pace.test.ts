import { expect, mock, test } from 'claude-code/testing'
import {
  chooseEffort, classifyStep, failureOf, guardCommand, guardStateOf, isReadOnlyCall, paceRequest, parsePace,
  readPaceOptions, resolvePaceMode, type StepCall,
} from './core'
import { registerPace } from './register'

const call = (x: Partial<StepCall>): StepCall => ({ tool: 'Read', action: 'Read a.ts', readOnly: true, failed: false, error: '', editedLines: 0, ...x })

test('turn start, a failure and a big edit are pivots; a read-only step is easy', () => {
  expect(classifyStep(0, [], 30).cls).toBe('pivot')
  expect(classifyStep(3, [call({}), call({ tool: 'Bash', readOnly: false, failed: true, error: 'Exit code 1' })], 30).reason).toBe('failure')
  expect(classifyStep(3, [call({ tool: 'Write', readOnly: false, editedLines: 120 })], 30).reason).toBe('big_edit')
  expect(classifyStep(3, [call({}), call({ tool: 'Grep' })], 30).cls).toBe('easy')
  expect(classifyStep(3, [call({}), call({ tool: 'Edit', readOnly: false, editedLines: 4 })], 30).cls).toBe('normal')
})

test('effort: easy goes low, pivots take Jev when sure, else at least high; xhigh/max are left alone', () => {
  expect(chooseEffort('easy', 'high', null, 0.6)).toEqual({ effort: 'low', source: 'rule' })
  expect(chooseEffort('pivot', 'medium', { choice: 'low', p: 0.8, probabilities: {} }, 0.6).effort).toBe('low')
  expect(chooseEffort('pivot', 'medium', { choice: 'low', p: 0.4, probabilities: {} }, 0.6)).toEqual({ effort: 'high', source: 'jev_low_confidence' })
  expect(chooseEffort('pivot', 'medium', null, 0.6)).toEqual({ effort: 'high', source: 'fallback' })
  expect(chooseEffort('normal', 'medium', null, 0.6).effort).toBe('medium')
  expect(chooseEffort('easy', 'max', null, 0.6).effort).toBe('max')
})

test('read-only detection: inspection pipelines yes, writes and installs no', () => {
  expect(isReadOnlyCall('Bash', 'cd D:/x && grep -n foo a.ts | head -20', false)).toBe(true)
  expect(isReadOnlyCall('Bash', 'git -C D:/x diff --stat && sed -n 1,40p a.ts', false)).toBe(true)
  expect(isReadOnlyCall('Bash', 'cat a.ts > b.ts', false)).toBe(false)
  expect(isReadOnlyCall('Bash', 'npm test 2>&1 | tail', false)).toBe(false)
  expect(isReadOnlyCall('Bash', 'sed -i s/a/b/ a.ts', false)).toBe(false)
  expect(isReadOnlyCall('Edit', undefined, false)).toBe(false)
  expect(isReadOnlyCall('Bash', 'anything', true)).toBe(true)
})

test('failures: nonzero exit, error result, failing test summary; the 100k size cut is not one', () => {
  expect(failureOf({ text: 'Exit code 2\nls: cannot access' }).failed).toBe(true)
  expect(failureOf({ isError: true, text: 'boom' }).failed).toBe(true)
  expect(failureOf({ text: 'ok' }).failed).toBe(false)
  expect(failureOf({ deny: 'head [haiku-100k: 5000 chars cut so the next request stays under 100k tokens] tail' }).failed).toBe(false)
  expect(failureOf({ deny: 'Permission denied' }).failed).toBe(true)
})

test('guard: GNU timeout in ms is stopped; GNU timeout in seconds, Windows timeout and plain text are not', () => {
  expect(guardCommand('timeout 300000 claude plugin test . 2>&1 | tail -30', true)).toContain('300000 seconds')
  expect(guardCommand('cd x && timeout 300000 npm test', false)).toContain('300000 seconds')
  expect(guardCommand('timeout --foreground 3600 npm test', false)).toContain('3600 seconds')
  expect(guardCommand('timeout 300 npm test', false)).toBe(null)
  expect(guardCommand('timeout -k 5 480 npm test', false)).toBe(null)
  expect(guardCommand('timeout /t 300', false)).toBe(null)
  expect(guardCommand('timeout /nobreak /t 3600', false)).toBe(null)
  expect(guardCommand('echo timeout 300000', false)).toBe(null)
  expect(guardCommand('npm run timeout 3600', false)).toBe(null)
  expect(guardCommand('claude plugin test ./haiku-100k > out.log', false)).toContain('run_in_background')
  expect(guardCommand('claude plugin test ./haiku-100k > out.log', true)).toBe(null)
  expect(guardCommand("cd x && python - <<'EOF' 2>/dev/null || node -e 1", false)).toContain('python -')
  expect(guardCommand('python script.py', false)).toBe(null)
  expect(guardCommand('npm test', false)).toBe(null)
})

test('guard state: EFFORT_PACE=off kills everything; /effort-pace off keeps the guard; shadow only logs', () => {
  expect(guardStateOf(undefined, 'apply')).toBe('deny')
  expect(guardStateOf(undefined, 'off')).toBe('deny')
  expect(guardStateOf(undefined, 'shadow')).toBe('log')
  expect(guardStateOf('shadow', 'shadow')).toBe('log')
  expect(guardStateOf('off', 'apply')).toBe('killed')
  expect(guardStateOf(' OFF ', 'shadow')).toBe('killed')
})

test('Jev request is redacted and its answer parsed strictly', () => {
  const body = paceRequest({ subagent: false, index: 4, reason: 'failure', calls: [call({ tool: 'Bash', action: 'Bash cat C:/Users/LENOVO2/secret.txt', failed: true, error: 'Exit code 1 token=abcdef123456' })] })
  const s = JSON.stringify(body)
  expect(s.includes('LENOVO2')).toBe(false)
  expect(s.includes('abcdef123456')).toBe(false)
  const ok = parsePace({ answers: { effort: { choice: 'medium', probabilities: { low: 0.1, medium: 0.7, high: 0.2 } } } })
  expect('error' in ok ? null : ok.choice).toBe('medium')
  expect('error' in parsePace({ answers: { effort: { choice: 'max' } } })).toBe(true)
})

test('options and mode: apply by default, env wins over the session, the session over config', () => {
  expect(readPaceOptions({}).mode).toBe('apply')
  expect(readPaceOptions({ paceMode: 'shadow', paceJev: false }).jev).toBe(false)
  expect(resolvePaceMode('off', 'apply', 'apply')).toBe('off')
  expect(resolvePaceMode(undefined, 'shadow', 'apply')).toBe('shadow')
  expect(resolvePaceMode(undefined, undefined, 'apply')).toBe('apply')
})

test('the long-command guard applies to Opus too: a Bash call with a ms timeout is denied', async ($, on) => {
  on('tool.call', () => ({ text: 'ran' } as never))
  registerPace(on as never, { paceJev: false } as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'timeout 300000 sleep 1', model: 'claude-opus-5-5' } as never)
  expect(String(r.deny)).toContain('300000 seconds')
})

// $.turn.step returns a lazy HookStream: the chain runs only as its chunks are read. A step is run by
// reading it to the end and then taking its result. The base hook (registered last, so beneath pace)
// records the effort it was handed and answers a plain response.
async function runStep($: { turn: { step: (input: unknown) => AsyncIterable<unknown> & { result: Promise<unknown> } } }, input: Record<string, unknown>) {
  const stream = $.turn.step(input)
  for await (const _chunk of stream) { /* the base hook yields no chunks */ }
  return stream.result
}

const answer = { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }

// The plugin under test registers its own pace hook from these options (the manifest defaults when not given).
test('turn.step, Opus: pace does not run; the effort handed on is the session effort, unchanged (hook level)', { options: { paceMode: 'apply', paceJev: false } }, async ($, on) => {
  const sent: string[] = []
  mock.clock(on as never) // pace times its Jev and telemetry steps with $.clock.now
  on('turn.step', async function* (_$, e) {
    sent.push(String(e.effort))
    return { ...answer, turnId: e.turnId, index: e.index } // the engine rejects a result for another step
  } as never)
  // A turn-start pivot would be raised to high for Haiku or Sonnet; Opus keeps medium.
  await runStep($ as never, { model: 'claude-opus-5-5', effort: 'medium', index: 0, turnId: 'opus-1', messageCount: 1 })
  expect(sent).toEqual(['medium'])
})

test('turn.step, Sonnet, apply: a turn-start pivot is raised from medium to high (hook level)', { options: { paceMode: 'apply', paceJev: false } }, async ($, on) => {
  const sent: string[] = []
  mock.clock(on as never)
  mock.env(on as never, {}) // EFFORT_PACE unset, so paceMode decides
  on('turn.step', async function* (_$, e) {
    sent.push(String(e.effort))
    return { ...answer, turnId: e.turnId, index: e.index } // the engine rejects a result for another step
  } as never)
  await runStep($ as never, { model: 'claude-sonnet-5-5', effort: 'medium', index: 0, turnId: 'sonnet-1', messageCount: 1 })
  expect(sent).toEqual(['high'])
})

test('turn.step, Sonnet, shadow: the same pivot is logged but the effort is left at medium (hook level)', { options: { paceMode: 'shadow', paceJev: false } }, async ($, on) => {
  const sent: string[] = []
  mock.clock(on as never)
  mock.env(on as never, {}) // EFFORT_PACE unset, so paceMode decides
  on('turn.step', async function* (_$, e) {
    sent.push(String(e.effort))
    return { ...answer, turnId: e.turnId, index: e.index } // the engine rejects a result for another step
  } as never)
  await runStep($ as never, { model: 'claude-sonnet-5-5', effort: 'medium', index: 0, turnId: 'sonnet-2', messageCount: 1 })
  expect(sent).toEqual(['medium'])
})

test('turn.step, Sonnet, off: no effort change (hook level)', { options: { paceMode: 'off', paceJev: false } }, async ($, on) => {
  const sent: string[] = []
  mock.clock(on as never)
  mock.env(on as never, {}) // EFFORT_PACE unset, so paceMode decides
  on('turn.step', async function* (_$, e) {
    sent.push(String(e.effort))
    return { ...answer, turnId: e.turnId, index: e.index } // the engine rejects a result for another step
  } as never)
  await runStep($ as never, { model: 'claude-sonnet-5-5', effort: 'medium', index: 0, turnId: 'sonnet-3', messageCount: 1 })
  expect(sent).toEqual(['medium'])
})
