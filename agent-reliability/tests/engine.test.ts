// Runs under `claude plugin test .` against the installed engine: the Phase 0 exit
// criterion (a stored failure denies the next equivalent call without running it)
// plus the hook-level cases (edit epoch, permission denial, side-effect command,
// observe mode, subagent, reset).
import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const FAIL = 'Exit code 1\nFAIL tests/a.test.ts\n  ✗ adds numbers\n  AssertionError: expected 3, received 4\n';

/** A fake Bash beneath the plugin: counts runs, answers the scripted outcome per command. */
function fakeTools(on: On, script: (cmd: string) => 'fail' | 'pass' | 'perm' = () => 'fail') {
  mock.clock(on);
  const runs: string[] = [];
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    runs.push(e.command);
    const k = script(e.command);
    if (k === 'perm') return { isError: true as const, result: 'Permission to use Bash has been denied.', text: 'Permission to use Bash has been denied.' };
    if (k === 'fail') return { isError: true as const, result: FAIL, text: FAIL };
    return { result: { stdout: 'ok', stderr: '', interrupted: false } };
  });
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'a.ts', oldString: 'x', newString: 'y', originalFile: 'x', structuredPatch: [], userModified: false, replaceAll: false } as never }));
  return runs;
}

let n = 0;
const bash = ($: Parameters<Parameters<typeof test>[1] & ((...a: never[]) => unknown)>[0], command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', tool_use_id: `toolu_${++n}`, command, ...(agentId ? { agentId } : {}) } as never) as Promise<{ isError?: boolean; text?: string; deny?: string }>;

const ENFORCE = { options: { mode: 'enforce', maxIdenticalFailuresBeforeBlock: 2, jevEnabled: false } };

test('phase 0: a stored failure denies the next equivalent call without running it', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await bash($, 'npm test');
  const third = await bash($, 'npm  test');
  expect(runs.length).toBe(2); // the third never reached the tool
  expect(third.deny ?? third.text ?? '').toContain('Retry blocked');
});

test('threshold 1 blocks the first identical repeat', { options: { ...ENFORCE.options, maxIdenticalFailuresBeforeBlock: 1 } }, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'dotnet build');
  const second = await bash($, 'dotnet build');
  expect(runs.length).toBe(1);
  expect(second.deny ?? second.text ?? '').toContain('Retry blocked');
});

test('a successful Edit between attempts lets the rerun through', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await bash($, 'npm test');
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_e1', file_path: 'a.ts', old_string: 'x', new_string: 'y' } as never);
  await bash($, 'npm test');
  expect(runs.length).toBe(3);
});

test('a permission denial is not recorded as a failure', ENFORCE, async ($, on) => {
  const runs = fakeTools(on, () => 'perm');
  for (let i = 0; i < 4; i++) await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('side-effect and compound commands are never guarded', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  for (let i = 0; i < 3; i++) await bash($, 'npm test && git push');
  for (let i = 0; i < 3; i++) await bash($, 'rm -rf dist');
  expect(runs.length).toBe(6);
});

test('observe mode (default) never blocks', { options: { jevEnabled: false } }, async ($, on) => {
  const runs = fakeTools(on);
  for (let i = 0; i < 4; i++) await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('subagent calls are left alone (mainAgentOnly)', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  for (let i = 0; i < 4; i++) await bash($, 'npm test', 'agent-1');
  expect(runs.length).toBe(4);
});

test('/retry-guard reset clears the records', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await bash($, 'npm test');
  const r = await $.command.run({ command: 'retry-guard', args: 'reset' } as never) as { text?: string };
  expect(r.text ?? '').toContain('cleared');
  await bash($, 'npm test');
  expect(runs.length).toBe(3);
});
