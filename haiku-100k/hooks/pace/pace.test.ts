import { expect, test } from 'claude-code/testing'
import {
  chooseEffort, classifyStep, failureOf, guardCommand, isReadOnlyCall, paceRequest, parsePace,
  readPaceOptions, resolvePaceMode, type StepCall,
} from './core'

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

test('guard: GNU timeout in ms, a foreground claude run and python - heredoc are stopped', () => {
  expect(guardCommand('timeout 300000 claude plugin test . 2>&1 | tail -30', true)).toContain('300000 seconds')
  expect(guardCommand('timeout 300 npm test', false)).toBe(null)
  expect(guardCommand('timeout -k 5 480 npm test', false)).toBe(null)
  expect(guardCommand('claude plugin test ./haiku-100k > out.log', false)).toContain('run_in_background')
  expect(guardCommand('claude plugin test ./haiku-100k > out.log', true)).toBe(null)
  expect(guardCommand("cd x && python - <<'EOF' 2>/dev/null || node -e 1", false)).toContain('python -')
  expect(guardCommand('python script.py', false)).toBe(null)
  expect(guardCommand('npm test', false)).toBe(null)
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

test('a Bash call outside a Haiku session passes through the guard', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } } as never))
  const r = await $.tool.call({ tool: 'Bash', command: 'timeout 300000 sleep 1' } as never)
  expect(r.deny).toBe(undefined)
})
