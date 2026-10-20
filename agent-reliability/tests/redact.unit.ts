// The shared Jev redaction policy, and every outbound request builder that uses it.
// node --test tests/*.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../hooks/redact.ts';
import { jevRequest } from '../hooks/core.ts';
import { advisorRequest } from '../hooks/advisor.ts';
import type { FailureRecord, Incident } from '../types/index.d.ts';

test('redact: Azure DevOps organizations are masked in every URL form', () => {
  assert.equal(redact('git clone https://dev.azure.com/contoso/Laya/_git/app', 300), 'git clone https://dev.azure.com/<org>/Laya/_git/app');
  assert.equal(redact('https://vssps.dev.azure.com/contoso/_apis/profile', 300), 'https://vssps.dev.azure.com/<org>/_apis/profile');
  assert.equal(redact('az devops --org https://contoso.visualstudio.com/Laya', 300), 'az devops --org https://<org>.visualstudio.com/Laya');
  assert.equal(redact('see dev.contoso.visualstudio.com', 300), 'see dev.<org>.visualstudio.com');
});

test('redact: credentials and token prefixes', () => {
  assert.equal(redact('curl -H "Authorization: Bearer abcdefgh12345678"', 300), 'curl -H "Authorization: <redacted> <token>"');
  assert.equal(redact('token ghp_0123456789abcdef', 300), 'token <token>');
  assert.equal(redact('OPENROUTER_API_KEY=sk-or-v1-0123456789', 300), 'OPENROUTER_API_KEY=<redacted>');
  assert.equal(redact('password: hunter22', 300), 'password: <redacted>');
});

test('redact: home paths, drive paths and emails; long ids; idempotent', () => {
  const raw = 'C:\\Users\\someone\\x.ts | D:/Laya/a.ts | /home/alice/p | dev.user@example.com | 0123456789abcdef0123456789abcdef01';
  const once = redact(raw, 500);
  assert.equal(once, '~\\x.ts | <abs>/a.ts | ~/p | <email> | <id>');
  assert.equal(redact(once, 500), once);
  const org = 'dev.azure.com/contoso and contoso.visualstudio.com token: abcd1234';
  assert.equal(redact(redact(org, 500), 500), redact(org, 500));
});

test('redact: the cut is applied last and whitespace is folded', () => {
  assert.equal(redact('a\n\n  b\tc', 300), 'a b c');
  assert.equal(redact('abcdef', 3), 'abc');
  assert.equal(redact(undefined as unknown as string, 10), '');
});

const record = (over: Partial<FailureRecord> = {}): FailureRecord => ({
  schema_version: '1.0', key: 'k', workspace: 'w', tool_category: 'test_run',
  normalized_action: 'npm test -- D:\\Laya\\agent-reliability\\tests\\x.unit.ts', error_fingerprint: 'fp-1',
  error_summary: 'FAIL dev.user@example.com at https://dev.azure.com/contoso/_git/app', repeat_count: 2, transient: false,
  state_epoch: 1, exit_code: 1, ...over,
} as FailureRecord);

test('jevRequest: proposed_action and error_summary never carry raw paths, emails or org names', () => {
  const body = jevRequest(record(), 'node --test D:\\Laya\\agent-reliability\\tests\\x.unit.ts  2>&1 | tail -5', false);
  const wire = JSON.stringify(body);
  for (const leak of ['D:\\\\Laya', 'D:\\Laya', 'dev.user@example.com', 'contoso']) assert.ok(!wire.includes(leak), `leaked ${leak}`);
  assert.ok(wire.includes('<abs>/x.unit.ts'));
  assert.ok(wire.includes('<email>'));
  assert.ok(wire.includes('dev.azure.com/<org>'));
});

const inc = (over: Partial<Incident> = {}): Incident => ({
  id: 'inc-1', key: 'k', agent: 'main', action: 'az boards C:\\Users\\someone\\x', state: 'OPEN', fails: 2, strategies: [], pending: [],
  errorKey: 'err-1', summary: 's', baseEpoch: 0, baseToken: null, openedAt: 0, updatedAt: 0, kind: 'streak',
  attempts: [{ tool: 'Bash', action: 'curl https://dev.azure.com/contoso/x -H "token: abcd1234"', error: 'denied for ops@corp.example.com in D:\\Laya\\y.ts', changes: ['edit D:\\Laya\\z.ts'] }],
  ...over,
});
const ctx = { subagent: false, strategiesUsed: 0, maxStrategies: 2, stateChangedSinceLast: false };

test('advisorRequest: prompt disabled sends no user_request; attempts and changes are redacted', () => {
  const wire = JSON.stringify(advisorRequest(inc(), ctx));
  assert.ok(!wire.includes('user_request'));
  for (const leak of ['contoso', 'abcd1234', 'ops@corp', 'D:\\\\Laya', 'D:\\Laya', 'someone']) assert.ok(!wire.includes(leak), `leaked ${leak}`);
});

test('advisorRequest: prompt enabled sends the prompt redacted, with the same policy', () => {
  const body = advisorRequest(inc(), { ...ctx, prompt: 'fix D:\\Laya\\a.ts for dev.user@example.com using dev.azure.com/contoso' });
  const prompt = (body.state as { user_request: string }).user_request;
  assert.equal(prompt, 'fix <abs>/a.ts for <email> using dev.azure.com/<org>');
});
