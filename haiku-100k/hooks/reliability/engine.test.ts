// Shipped copy of agent-reliability/tests/engine.test.ts (scripts/ship-haiku-100k.mjs). Edit the source, not this file.
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

test('a permission denial is not a failure, and Rule C refuses to resend it', ENFORCE, async ($, on) => {
  const runs = fakeTools(on, () => 'perm');
  await bash($, 'npm test');
  const second = await bash($, 'npm test');
  expect(runs.length).toBe(1);
  expect(second.deny ?? '').toContain('the user denied');
  const r = await $.command.run({ command: 'reliability', args: '' } as never) as { text?: string };
  expect(r.text ?? '').not.toContain('×'); // no Rule B failure record
});

test('Rule C: a user denial is not lifted by a new prompt, only by /reliability allow', ENFORCE, async ($, on) => {
  const runs = fakeTools(on, () => 'perm');
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never);
  await bash($, 'git push origin main');
  await $.prompt.submit({ text: 'now fix the readme' } as never);
  const again = await bash($, 'cd D:/repo && git push origin main 2>&1 | tail -5');
  expect(again.deny ?? '').toContain('/reliability allow 1');
  expect(runs.length).toBe(1);
  await $.command.run({ command: 'reliability', args: 'allow 1' } as never);
  await bash($, 'git push origin main');
  expect(runs.length).toBe(2);
});

test('Rule C: a user-denied Edit also blocks Write on the same file', ENFORCE, async ($, on) => {
  mock.clock(on);
  let writes = 0;
  on('tool.call', { tool: 'Edit' }, () => ({ isError: true as const, result: 'x', text: "The user doesn't want to proceed with this tool use. The tool use was rejected." }));
  on('tool.call', { tool: 'Write' }, () => { writes++; return { result: { type: 'update', filePath: 'a', content: '', structuredPatch: [] } as never }; });
  await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_d1', file_path: 'D:\\repo\\src\\a.ts', old_string: 'x', new_string: 'y' } as never);
  const w = await $.tool.call({ tool: 'Write', tool_use_id: 'toolu_d2', file_path: '/d/repo/src/a.ts', content: 'y' } as never) as { deny?: string };
  expect(writes).toBe(0);
  expect(w.deny ?? '').toContain('the user denied');
});

test('cd-prefixed, piped verification is recognised; a piped run without a summary is not a pass', ENFORCE, async ($, on) => {
  const runs = fakeTools(on);
  for (let i = 0; i < 3; i++) await bash($, 'cd D:/proj && npm test 2>&1 | tail -20');
  expect(runs.length).toBe(2); // the piped fails carry isError here; the third identical repeat is blocked
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
  expect(r.deny ?? r.text ?? '').toContain('haiku-100k:opus-recovery');
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
  await $.agent.spawn({ subagentType: 'haiku-100k:opus-recovery', prompt: 'p', description: 'd', background: true } as never);
  tree.v = 'recovery edited';
  await bash($, 'npm test');                       // recovery still running: allowed, stays ESCALATED
  tree.v = 'recovery edited more';
  const mid = await bash($, 'npm test');           // still allowed, not NEEDS_USER
  expect(mid.deny).toBe(undefined);
  expect(runs.length).toBe(5);
  await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_ag', subagent_type: 'haiku-100k:opus-recovery', prompt: 'p', description: 'd' } as never);
  tree.v = 'after recovery';
  await bash($, 'npm test');                       // recovery done + still failing → NEEDS_USER
  const last = await bash($, 'npm test');
  expect(last.deny ?? last.text ?? '').toContain('needs the user');
  expect(runs.length).toBe(6);
});

/** Captures telemetry writes (path only) under a fixed session id; reads answer nothing. */
/** A fake Jev decisions endpoint answering `next_step` with `action` at p 0.9; counts the calls. */
function fakeJev(on: On, action: string) {
  const calls: unknown[] = [];
  const probs = Object.fromEntries(['RETRY_NEW_STRATEGY', 'ESCALATE_MODEL', 'ASK_USER', 'MARK_BLOCKED', 'STOP_AND_REPORT'].map((a) => [a, a === action ? 0.9 : 0.025]));
  on('http.fetch', (_$, e) => {
    calls.push(JSON.parse(String((e as { init?: { body?: string } }).init?.body ?? '{}')));
    const answers = {
      failure_kind: { choice: 'environment_or_external', probabilities: { environment_or_external: 0.8, real_failure: 0.2 } },
      same_approach: { noul: 0.7 },
      next_step: { choice: action, probabilities: probs },
    };
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never;
  });
  return calls;
}

const AZ = 'Exit code 1\nERROR: Before you can run Azure DevOps commands, you need to run the login command(az login if using AAD/MSA identity else az devops login if using PAT token) to setup credentials.';

test('advisor shadow: asked from the 2nd failure, logs only, never changes the call', { options: { mode: 'enforce', jevAdvisor: 'shadow' } }, async ($, on) => {
  mock.env(on, { OPENROUTER_API_KEY: 'k' });
  const calls = fakeJev(on, 'ASK_USER');
  const runs: string[] = [];
  mock.clock(on); fakeGit(on);
  on('tool.call', { tool: 'Bash' }, (_$, e) => { runs.push(e.command); return { isError: true as const, result: AZ, text: AZ }; });
  await bash($, 'az boards work-item show --id 27621');
  expect(calls.length).toBe(0);
  const second = await bash($, 'az boards work-item show --id 27621 --org https://dev.azure.com/x') as { context?: string[] };
  expect(calls.length).toBe(1);
  expect(second.context ?? []).toEqual([]);
  await bash($, 'az boards work-item show --id 27621');
  expect(runs.length).toBe(3);
});

test('advisor apply: ASK_USER becomes NEEDS_USER with a note; the key is held until the next prompt', { options: { mode: 'enforce', jevAdvisor: 'apply' } }, async ($, on) => {
  mock.env(on, { OPENROUTER_API_KEY: 'k' });
  const calls = fakeJev(on, 'ASK_USER');
  const runs: string[] = [];
  mock.clock(on); fakeGit(on);
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never);
  on('tool.call', { tool: 'Bash' }, (_$, e) => { runs.push(e.command); return { isError: true as const, result: AZ, text: AZ }; });
  await bash($, 'az boards work-item show --id 27621');
  const second = await bash($, 'az boards work-item show --id 27621 --org https://dev.azure.com/x') as { context?: string[] };
  expect((second.context ?? []).join(' ')).toContain('Jev: ASK_USER');
  const third = await bash($, 'az boards work-item list');
  expect(third.deny ?? '').toContain('needs the user');
  expect(runs.length).toBe(2);
  // A new prompt ends the wait, not the question: one attempt, then NEEDS_USER again, no new Jev call.
  await $.prompt.submit({ text: 'I ran az login' } as never);
  await bash($, 'az boards work-item show --id 27621');
  const fifth = await bash($, 'az boards work-item show --id 27621');
  expect(runs.length).toBe(3);
  expect(fifth.deny ?? '').toContain('needs the user');
  expect(calls.length).toBe(1);
});

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
