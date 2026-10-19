// Pure-logic tests for the classifier, incidents, Rule A and mode resolution.
// Run: npm test (node --test, type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, resolveMode, upgradeState } from '../hooks/core.ts';
import {
  classifyRun, escalationText, gateBefore, markEscalationDenied, onEscalationIgnored, onFail, onMutation, onPass,
  onRecoveryDone, onRecoveryStarted, onUserPrompt,
} from '../hooks/incident.ts';

const O = { maxRecoveryStrategies: 2, ttlMinutes: 30 };
const K = '/repo::npm test';
const fail = (s: ReturnType<typeof emptyState>, errorKey = 'err-a', token: string | null = 't1', now = 1) =>
  onFail(s, { key: K, agent: 'main', action: 'npm test', errorKey, summary: 'x failed', epoch: s.epoch, token, now }, O);

// ---- classifier, from the shapes recorded in docs/api-findings.md

test('classifier: npm test exit 1 with error lines is FAIL', () => {
  assert.equal(classifyRun({ isError: true, result: 'Exit code 1\nFAIL a.test', text: 'Exit code 1\nFAIL a.test' }).cls, 'FAIL');
});
test('classifier: grep with no match (runtime interpretation, no isError) is EXPECTED_NONZERO', () => {
  assert.equal(classifyRun({ result: { stdout: '', interrupted: false, returnCodeInterpretation: 'No matches found' }, text: '(Bash completed with no output)' }).cls, 'EXPECTED_NONZERO');
});
test('classifier: test -f false is EXPECTED_NONZERO', () => {
  assert.equal(classifyRun({ result: { returnCodeInterpretation: 'Condition is false' } }).cls, 'EXPECTED_NONZERO');
});
test('classifier: timeout (exit 143 + "timed out") is AMBIGUOUS, not FAIL', () => {
  assert.equal(classifyRun({ isError: true, result: 'Exit code 143\nCommand timed out after 1s', text: 'Exit code 143\nCommand timed out after 1s' }).cls, 'AMBIGUOUS');
});
test('classifier: permission refusal is USER_DENIED', () => {
  assert.equal(classifyRun({ isError: true, text: 'Permission to use Bash has been denied.' }).cls, 'USER_DENIED');
  assert.equal(classifyRun({ isError: true, text: 'Claude requested permissions to edit x which is a sensitive file.' }).cls, 'USER_DENIED');
});
test('classifier: an error without an exit code line is AMBIGUOUS', () => {
  assert.equal(classifyRun({ isError: true, text: 'something odd' }).cls, 'AMBIGUOUS');
});
test('classifier: a successful run is PASS', () => {
  assert.equal(classifyRun({ result: { stdout: 'ok', interrupted: false } }).cls, 'PASS');
});

// ---- incidents

test('1-2: first failure opens an incident; an identical repeat is not a strategy', () => {
  let t = fail(emptyState());
  assert.equal(t.event, 'incident_opened');
  t = fail(t.s);
  assert.equal(t.event, 'repeat_failed');
  assert.equal(t.inc.fails, 2);
  assert.equal(t.inc.strategies.length, 0);
});

test('5: a pass closes the incident; a new failure opens a new one with fresh counters', () => {
  let t = fail(emptyState());
  t = fail(onMutation(t.s, 'main', 'Edit a.ts'));
  const closed = onPass(t.s, K, 5)!;
  assert.equal(closed.inc.state, 'CLOSED');
  const again = fail(closed.s, 'err-b', 't9', 6);
  assert.equal(again.event, 'incident_opened');
  assert.notEqual(again.inc.id, t.inc.id);
  assert.equal(again.inc.strategies.length, 0);
});

test('9-10: two failed strategies request one escalation; identical retries do not count', () => {
  let t = fail(emptyState());
  t = fail(t.s); // identical retry: no strategy
  t = fail(onMutation(t.s, 'main', 'Edit a.ts'));
  assert.equal(t.inc.strategies.length, 1);
  assert.equal(t.inc.state, 'OPEN');
  t = fail(t.s); // identical again
  assert.equal(t.inc.strategies.length, 1);
  t = fail(onMutation(t.s, 'main', 'Edit b.ts'));
  assert.equal(t.inc.strategies.length, 2);
  assert.equal(t.inc.state, 'ESCALATION_REQUESTED');
  assert.equal(t.event, 'escalation_due');
  assert.equal(gateBefore(t.s, K).kind, 'escalate');
  assert.match(escalationText(t.inc, 'agent-reliability'), /agent-reliability:opus-recovery/);
});

function escalated() {
  let t = fail(emptyState());
  t = fail(onMutation(t.s, 'main', 'Edit a.ts'));
  t = fail(onMutation(t.s, 'main', 'Edit b.ts'));
  return t.s;
}

test('ESCALATED only on spawn evidence; verify fail while recovery runs keeps ESCALATED', () => {
  let s = escalated();
  const st = onRecoveryStarted(s, 'main', 'agent-9', true, 10)!;
  assert.equal(st.inc.state, 'ESCALATED');
  s = st.s;
  const t = fail(s, 'err-a', 't1', 11);
  assert.equal(t.event, 'recovery_in_progress');
  assert.equal(t.inc.state, 'ESCALATED');
});

test('11: recovery done and verification still fails → NEEDS_USER', () => {
  let s = onRecoveryStarted(escalated(), 'main', 'agent-9', false, 10)!.s;
  s = onRecoveryDone(s, 'agent-9', 12)!.s;
  const t = fail(s, 'err-a', 't1', 13);
  assert.equal(t.inc.state, 'NEEDS_USER');
  assert.equal(gateBefore(t.s, K).kind, 'needs_user');
});

test('recovery done and verification passes → CLOSED', () => {
  let s = onRecoveryStarted(escalated(), 'main', 'agent-9', false, 10)!.s;
  s = onRecoveryDone(s, 'agent-9', 12)!.s;
  assert.equal(onPass(s, K, 13)!.inc.state, 'CLOSED');
});

test('escalation requested but ignored → NEEDS_USER (deny path and observe path)', () => {
  const s = markEscalationDenied(escalated(), K, 10);
  assert.equal(onEscalationIgnored(s, K, 11)!.inc.state, 'NEEDS_USER');
  // observe: no deny happened, the main loop verified again and failed
  assert.equal(fail(escalated(), 'err-a', 't1', 11).inc.state, 'NEEDS_USER');
});

test('a new user prompt closes NEEDS_USER incidents', () => {
  let s = onRecoveryStarted(escalated(), 'main', 'agent-9', false, 10)!.s;
  s = fail(onRecoveryDone(s, 'agent-9', 12)!.s, 'err-a', 't1', 13).s;
  s = onUserPrompt(s, 14);
  assert.equal(gateBefore(s, K).kind, 'none');
});

test('12: mutations of a subagent do not touch the main loop incident', () => {
  const t = fail(emptyState());
  const s = onMutation(t.s, 'agent-1', 'Edit a.ts');
  assert.equal(s.incidents[0]!.pending.length, 0);
});

test('baseline refreshes on every failure', () => {
  let t = fail(emptyState(), 'err-a', 't1');
  t = fail(onMutation(t.s, 'main', 'Edit a.ts'), 'err-a', 't2');
  assert.equal(t.inc.baseToken, 't2');
});

// ---- mode and state

test('4/kill switch: mode precedence', () => {
  assert.equal(resolveMode('off', 'enforce', 'enforce').mode, 'off');
  assert.equal(resolveMode('enforce', 'observe', 'enforce').mode, 'observe');
  assert.equal(resolveMode('enforce', undefined, 'observe').mode, 'enforce');
  assert.equal(resolveMode(undefined, undefined, 'enforce').mode, 'enforce');
  assert.equal(resolveMode('', undefined, 'observe').mode, 'observe');
});

test('13: stale or foreign state is dropped, not imported', () => {
  assert.equal(upgradeState({ epoch: 3, records: [{}], stats: {} }).records.length, 0); // retry-loop-breaker 0.1 shape
  assert.equal(upgradeState(undefined).schema, 2);
  const ok = { ...emptyState(), epoch: 4 };
  assert.equal(upgradeState(ok).epoch, 4);
});
