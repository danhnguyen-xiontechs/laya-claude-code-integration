// Runs under `claude plugin test .` against the installed engine. Case B (kept from
// retry-loop-breaker 0.1), git-token fail-open, Rule A escalation / NEEDS_USER,
// the kill switch and /reliability. git is faked through the `process.run` op.
import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const FAIL = 'Exit code 1\nFAIL tests/a.test.ts\n  ✗ adds numbers\n  AssertionError: expected 3, received 4\n';

/** Fake git: `tree.v` is the working tree; `tree.broken` makes git fail. */
export const tree = { v: 'clean', broken: false };
function fakeGit(on: On) {
  tree.v = 'clean'; tree.broken = false;
  on('process.run', () => ({ value: tree.broken
    ? { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false }
    : { exitCode: 0, stdout: tree.v, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never);
}

/** A fake Bash beneath the plugin: counts runs, answers the scripted outcome per command. */
function fakeTools(on: On, script: (cmd: string) => 'fail' | 'pass' | 'perm' = () => 'fail') {
  mock.clock(on);
  fakeGit(on);
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

// ---------------------------------------------------------------- agent-reliability 0.2

test('state changed outside the tools (git token differs) lets the rerun through', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await bash($, 'npm test');
  tree.v = 'user edited a.ts by hand';
  await bash($, 'npm test');
  expect(runs.length).toBe(3);
});

test('git unavailable: Rule B fails open (no baseline token)', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  tree.broken = true;
  for (let i = 0; i < 4; i++) await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('baseline refresh: after a change, a new identical chain is blocked at its third attempt', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_e2', file_path: 'a.ts', old_string: 'x', new_string: 'y' } as never);
  tree.v = 'edited';
  await bash($, 'npm test'); // new chain #1
  await bash($, 'npm test'); // new chain #2
  const third = await bash($, 'npm test');
  expect(runs.length).toBe(3);
  expect(third.deny ?? third.text ?? '').toContain('Retry blocked');
});

const RULE_A = { options: { mode: 'enforce', ruleA: true, jevEnabled: false } };
const edit = ($: Parameters<typeof bash>[0], f: string) =>
  $.tool.call({ tool: 'Edit', tool_use_id: `toolu_${++n}`, file_path: f, old_string: 'x', new_string: 'y' } as never);

test('Rule A: two failed strategies → next verification denied with an escalation request', RULE_A, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await edit($, 'a.ts'); tree.v = 'a';
  await bash($, 'npm test');
  await edit($, 'b.ts'); tree.v = 'b';
  await bash($, 'npm test');
  const r = await bash($, 'npm test');
  expect(runs.length).toBe(3);
  expect(r.deny ?? r.text ?? '').toContain('agent-reliability:opus-recovery');
});

test('Rule A: escalation ignored → NEEDS_USER; a new user prompt lifts it', RULE_A, async ($, on) => {
  const runs = fakeTools(on);
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never);
  await bash($, 'npm test');
  await edit($, 'a.ts'); tree.v = 'a';
  await bash($, 'npm test');
  await edit($, 'b.ts'); tree.v = 'b';
  await bash($, 'npm test');
  await bash($, 'npm test'); // escalation requested (denied)
  await edit($, 'c.ts'); tree.v = 'c';
  const r = await bash($, 'npm test'); // tried again without recovery
  expect(r.deny ?? r.text ?? '').toContain('needs the user');
  expect(runs.length).toBe(3);
  await $.prompt.submit({ text: 'ok, try something else' } as never);
  await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('Rule A off by default: enforce mode never escalates', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  await bash($, 'npm test');
  await edit($, 'a.ts'); tree.v = 'a';
  await bash($, 'npm test');
  await edit($, 'b.ts'); tree.v = 'b';
  await bash($, 'npm test');
  await edit($, 'c.ts'); tree.v = 'c';
  await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('kill switch: AGENT_RELIABILITY=off beats enforce', ENFORCE, async ($, on) => {
  mock.env(on, { AGENT_RELIABILITY: 'off' });
  const runs = fakeTools(on);
  for (let i = 0; i < 4; i++) await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('/reliability observe overrides enforce for the session; auto restores it', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  const r = await $.command.run({ command: 'reliability', args: 'observe' } as never) as { text?: string };
  expect(r.text ?? '').toContain('mode observe');
  for (let i = 0; i < 3; i++) await bash($, 'npm test');
  expect(runs.length).toBe(3);
  await $.command.run({ command: 'reliability', args: 'auto' } as never);
  const blocked = await bash($, 'npm test');
  expect(blocked.deny ?? blocked.text ?? '').toContain('Retry blocked');
});

test('a timeout is not a failure', ENFORCE, async ($, on) => {
  mock.clock(on);
  fakeGit(on);
  const runs: string[] = [];
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    runs.push(e.command);
    const t = 'Exit code 143\nCommand timed out after 1s';
    return { isError: true as const, result: t, text: t };
  });
  for (let i = 0; i < 4; i++) await bash($, 'npm test');
  expect(runs.length).toBe(4);
});

test('Rule A lifecycle: ESCALATED only on spawn; no NEEDS_USER while recovery runs; NEEDS_USER after it is done', RULE_A, async ($, on) => {
  const runs = fakeTools(on);
  on('agent.spawn', () => ({ agentId: 'rec-1', model: 'opus' }) as never);
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'completed', agentId: 'rec-1' } }) as never);
  await bash($, 'npm test');
  await edit($, 'a.ts'); tree.v = 'a';
  await bash($, 'npm test');
  await edit($, 'b.ts'); tree.v = 'b';
  await bash($, 'npm test');                       // escalation due
  const req = await bash($, 'npm test');           // denied: escalation requested
  expect(req.deny ?? req.text ?? '').toContain('opus-recovery');
  await $.agent.spawn({ subagentType: 'agent-reliability:opus-recovery', prompt: 'p', description: 'd', background: true } as never);
  tree.v = 'recovery edited';
  await bash($, 'npm test');                       // recovery still running: allowed, stays ESCALATED
  tree.v = 'recovery edited more';
  const mid = await bash($, 'npm test');           // still allowed, not NEEDS_USER
  expect(mid.deny).toBe(undefined);
  expect(runs.length).toBe(5);
  await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_ag', subagent_type: 'agent-reliability:opus-recovery', prompt: 'p', description: 'd' } as never);
  tree.v = 'after recovery';
  await bash($, 'npm test');                       // recovery done + still failing → NEEDS_USER
  const last = await bash($, 'npm test');
  expect(last.deny ?? last.text ?? '').toContain('needs the user');
  expect(runs.length).toBe(6);
});

/** Captures telemetry writes (path only) under a fixed session id; reads answer nothing. */
function captureWrites(on: On): string[] {
  const paths: string[] = [];
  on('session.id', () => ({ value: 'sess1' }) as never);
  on('fs.read', () => ({ value: '' }) as never);
  on('fs.write', (_$, e) => { paths.push((e as { path: string }).path); return { value: undefined } as never; });
  return paths;
}

test('telemetry goes to telemetry/ inside the plugin folder by default', { options: { jevEnabled: false } }, async ($, on) => {
  fakeTools(on);
  const paths = captureWrites(on);
  await bash($, 'npm test');
  const r = await $.command.run({ command: 'reliability', args: '' } as never) as { text?: string };
  const dir = /^telemetry (.+)$/m.exec(r.text ?? '')?.[1] ?? '';
  expect(/^[A-Za-z]:\/|^\//.test(dir) && dir.endsWith('/telemetry')).toBe(true);
  expect(paths.map((p) => p.replace(/\\/g, '/'))).toEqual([`${dir}/sess1.jsonl`]);
});

test('telemetryDir overrides the folder', { options: { jevEnabled: false, telemetryDir: 'D:\\logs\\ar\\' } }, async ($, on) => {
  fakeTools(on);
  const paths = captureWrites(on);
  await bash($, 'npm test');
  expect(paths.map((p) => p.replace(/\\/g, '/'))).toEqual(['D:/logs/ar/sess1.jsonl']);
});
