// Engine tests (`claude plugin test .`): the hook against the engine's own tool.call chain.
// The test's tool.call hook stands for core, answering in the shapes Phase 0 recorded live.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = 'C:/Users/ADMIN/AppData/Local/Temp/smart-trim-engine-test'
const passLines = Array.from({ length: 300 }, (_, i) => `  Passed Ns.Suite.Test_${i} [3 ms]`)
const failOut = [
  'Exit code 1',
  ...passLines.slice(0, 150),
  '  Failed Ns.Suite.Broken [12 ms]',
  '  Error Message:',
  '   Assert.Equal() Failure: Expected: 3 Actual: 4',
  '  Stack Trace:',
  '     at Ns.Suite.Broken() in C:\\src\\SuiteTests.cs:line 42',
  ...passLines.slice(150),
  'Failed!  - Failed:     1, Passed:   300, Skipped:     0, Total:   301',
].join('\n')
const passOut = [...passLines, 'Passed!  - Failed:     0, Passed:   300, Skipped:     0, Total:   300'].join('\n')

function core(on: On, answer: 'pass' | 'fail' | 'deny' | 'short') {
  mock.env(on, { USERPROFILE: HOME })
  on('tool.call', () => {
    if (answer === 'deny') return { deny: 'Permission denied by user' }
    if (answer === 'fail') return { isError: true, result: `Error: ${failOut}`, text: failOut, ref: 7 }
    const stdout = answer === 'short' ? 'Passed!  - Failed: 0, Passed: 2' : passOut
    return { ref: 7, text: stdout, result: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } }
  })
}

test('enforce: long passing dotnet test → stdout replaced, smaller, marked, summary kept', { options: { mode: 'enforce', useJev: false } }, async ($, on) => {
  core(on, 'pass')
  const r = await $.tool.call({ tool: 'Bash', command: 'dotnet test' })
  expect(r.isError).toBe(undefined)
  const out = (r.result as { stdout: string }).stdout
  expect(out.length < passOut.length / 2).toBe(true)
  expect(out.includes('[smart-trim] Output trimmed')).toBe(true)
  expect(out.includes('Passed!  - Failed:     0')).toBe(true)
  expect(out.includes('Full raw output:') || out.includes('Raw output could not be saved')).toBe(true)
})

test('enforce: failing run stays an error (deny) and keeps the failure evidence', { options: { mode: 'enforce', useJev: false } }, async ($, on) => {
  core(on, 'fail')
  const r = await $.tool.call({ tool: 'Bash', command: 'dotnet test' })
  // A plugin's own $.tool.call reads a hook's deny as { deny }.
  const text = r.deny ?? r.text ?? ''
  expect(text.startsWith('[smart-trim]')).toBe(true)
  expect(text.includes('Exit code 1')).toBe(true)
  expect(text.includes('Failed Ns.Suite.Broken')).toBe(true)
  expect(text.includes('Expected: 3 Actual: 4')).toBe(true)
  expect(text.includes('SuiteTests.cs:line 42')).toBe(true)
  expect(text.includes('Failed!  - Failed:     1')).toBe(true)
})

test('observe (default): result returned untouched', async ($, on) => {
  core(on, 'pass')
  const r = await $.tool.call({ tool: 'Bash', command: 'dotnet test' })
  expect((r.result as { stdout: string }).stdout).toBe(passOut)
  expect(r.ref).toBe(7)
})

test('unmatched command and short output pass byte-for-byte', { options: { mode: 'enforce', useJev: false } }, async ($, on) => {
  core(on, 'pass')
  const a = await $.tool.call({ tool: 'Bash', command: 'cat build.log' })
  expect((a.result as { stdout: string }).stdout).toBe(passOut)
  expect(a.ref).toBe(7)
})

test('short output passes unchanged', { options: { mode: 'enforce', useJev: false } }, async ($, on) => {
  core(on, 'short')
  const r = await $.tool.call({ tool: 'Bash', command: 'dotnet test' })
  expect((r.result as { stdout: string }).stdout).toBe('Passed!  - Failed: 0, Passed: 2')
  expect(r.ref).toBe(7)
})

test('permission denial passes through', { options: { mode: 'enforce', useJev: false } }, async ($, on) => {
  core(on, 'deny')
  const r = await $.tool.call({ tool: 'Bash', command: 'dotnet test' })
  expect(r.deny).toBe('Permission denied by user')
})

test('/smart-trim off disables trimming for the session', { options: { mode: 'enforce', useJev: false } }, async ($, on) => {
  core(on, 'pass')
  await $.command.run({ command: 'smart-trim', args: 'off' })
  const r = await $.tool.call({ tool: 'Bash', command: 'dotnet test' })
  expect((r.result as { stdout: string }).stdout).toBe(passOut)
})
