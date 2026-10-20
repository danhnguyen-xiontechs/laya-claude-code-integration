// 0.3 rules over real commands, refusal texts and outputs copied (paths shortened) from the
// Claude Code transcript history the plan was based on. node --test tests/*.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, emptyState, testSummaryOf, unwrapCommand } from '../hooks/core.ts';
import { classifyRun } from '../hooks/incident.ts';
import {
  type Advice, applyDecision, callKeys, fileKey, liftDenials, matchRefusal, recordRefusal, redact, refusalOf, writeTargetOf,
} from '../hooks/advisor.ts';
import type { Incident } from '../types/index.d.ts';

test('unwrap: cd prefix, 2>&1 and tail are stripped for classification only', () => {
  const u = unwrapCommand('cd "C:/Users/me/AppData/Local/Temp/laya-bench/C-h1/proxy" && python -m pytest proxy/test_adapt.py -q 2>&1 | tail -25');
  assert.equal(u.core, 'python -m pytest proxy/test_adapt.py -q');
  assert.equal(u.cdPath, 'C:/Users/me/AppData/Local/Temp/laya-bench/C-h1/proxy');
  assert.equal(u.piped, true);
  const ps = unwrapCommand('Set-Location "C:\\Users\\me\\AppData\\Local\\Temp\\laya-bench\\C-h1\\proxy"; python -m pytest test_adapt.py -v');
  assert.equal(ps.core, 'python -m pytest test_adapt.py -v');
  assert.equal(ps.piped, false);
  assert.equal(unwrapCommand('python -m pytest proxy/test_adapt.py -q 2>&1 | Select-Object -Last 25').piped, true);
});

test('classify: the runner spellings agents actually use', () => {
  assert.equal(classify('cd agent-reliability && npm test 2>&1 | tail -20'), 'test_run');
  assert.equal(classify('npm --prefix agent-reliability test'), 'test_run');
  assert.equal(classify('npx vitest run'), 'test_run');
  assert.equal(classify('py -m pytest tests/unit -q'), 'test_run');
  assert.equal(classify('.venv/Scripts/python.exe -m pytest -x'), 'test_run');
  assert.equal(classify('Set-Location proxy; python -m pytest test_adapt.py -v'), 'test_run');
  // still not a verification: a real chain
  assert.equal(classify('cd proxy && python _lang_check.py; python -c "import ast"'), null);
  assert.equal(classify('npm test && git push'), null);
});

test('piped runs: only the runner summary decides; no summary is AMBIGUOUS', () => {
  assert.equal(testSummaryOf('ℹ tests 38\nℹ pass 38\nℹ fail 0\nℹ cancelled 0'), 'pass');
  assert.equal(testSummaryOf('ℹ tests 38\nℹ pass 37\nℹ fail 1'), 'fail');
  assert.equal(testSummaryOf('FAILED proxy/test_adapt.py::test_haiku - AssertionError\n===== 2 failed, 10 passed in 0.52s ====='), 'fail');
  assert.equal(testSummaryOf('Running adapt_for_model tests...\n✓ test_haiku_drops_effort_beta'), null);
  const ok = { result: { stdout: '', stderr: '', interrupted: false }, text: '===== 12 passed in 0.31s =====' };
  assert.equal(classifyRun(ok, true).cls, 'PASS');
  assert.equal(classifyRun({ result: { interrupted: false }, text: 'Running adapt_for_model tests...' }, true).cls, 'AMBIGUOUS');
  assert.equal(classifyRun({ result: { interrupted: false }, text: 'Tests:       1 failed, 5 passed, 6 total' }, true).cls, 'FAIL');
});

test('refusals from real tool results: approval, form, user denial, and a real failure is none', () => {
  assert.deepEqual(refusalOf(true, 'This PowerShell command contains multiple operations. The following part requires approval: python -m pytest proxy/test_adapt.py -q'), { kind: 'harness_refusal', form: false });
  assert.deepEqual(refusalOf(true, "touch in 'C:\\Users\\me\\live\\app\\marker.txt' needs approval. The path is inside the working directories for this session, and Claude Code asks before a shell command creates, changes or removes files there."), { kind: 'harness_refusal', form: false });
  assert.deepEqual(refusalOf(true, "new-item targeting 'C:\\Users\\me\\live\\app\\marker.txt' was blocked. For security, Claude Code may only access files in the allowed working directories for this session"), { kind: 'harness_refusal', form: false });
  assert.deepEqual(refusalOf(true, 'Compound command changes working directory (Set-Location/Push-Location/Pop-Location/New-PSDrive) — relative paths cannot be validated'), { kind: 'harness_refusal', form: true });
  assert.deepEqual(refusalOf(true, 'This agent is isolated in the worktree D:\\Source\\X\\.claude\\worktrees\\wf_1, but this command changes directory'), { kind: 'harness_refusal', form: true });
  assert.deepEqual(refusalOf(true, '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>'), { kind: 'harness_refusal', form: true });
  assert.deepEqual(refusalOf(true, 'Permission to use Edit has been denied. IMPORTANT: You *may* attempt to accomplish this action using other tools'), { kind: 'user_denied', form: false });
  assert.deepEqual(refusalOf(true, "The user doesn't want to proceed with this tool use. The tool use was rejected"), { kind: 'user_denied', form: false });
  assert.deepEqual(refusalOf(true, 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Out-of-Place Publication]'), { kind: 'user_denied', form: false });
  assert.equal(refusalOf(true, 'Exit code 128\nfatal: renaming \'retry-loop-breaker\' failed: Permission denied'), null);
  assert.equal(refusalOf(false, 'requires approval'), null);
});

test('Rule C keys: a user denial follows the action across Bash/PS, cd prefixes and file tools', () => {
  let s = emptyState();
  const denied = callKeys({ tool: 'Bash', command: 'python -m pytest proxy/test_adapt.py -q', scope: 'D:/w' });
  s = recordRefusal(s, { kind: 'user_denied', form: false }, 'agent-7', 'Bash', denied, 1).s;
  const ps = callKeys({ tool: 'PowerShell', command: 'Set-Location proxy; python -m pytest proxy/test_adapt.py -q', scope: 'D:/w' });
  assert.equal(matchRefusal(s, ps, 2, 1e9)?.kind, 'user_denied');
  const other = callKeys({ tool: 'Bash', command: 'python -m pytest proxy/test_other.py -q', scope: 'D:/w' });
  assert.equal(matchRefusal(s, other, 2, 1e9), null);
  // file: Edit denied → Write on the same file (other spelling) and a simple redirect to it
  const edit = callKeys({ tool: 'Edit', path: 'C:\\Users\\me\\AppData\\Local\\Temp\\laya-wf\\proxy\\router_proxy.py', scope: '' });
  s = recordRefusal(s, { kind: 'user_denied', form: false }, 'main', 'Edit', edit, 3).s;
  assert.equal(fileKey('/c/Users/me/AppData/Local/Temp/laya-wf/proxy/router_proxy.py'), edit.file);
  assert.equal(matchRefusal(s, callKeys({ tool: 'Write', path: '/c/Users/me/AppData/Local/Temp/laya-wf/proxy/router_proxy.py', scope: '' }), 4, 1e9)?.kind, 'user_denied');
  assert.equal(writeTargetOf('echo hi > C:/Users/me/AppData/Local/Temp/laya-wf/proxy/router_proxy.py'), 'C:/Users/me/AppData/Local/Temp/laya-wf/proxy/router_proxy.py');
  assert.equal(writeTargetOf('sed -i s/a/b/ x.py && cat x.py > y.py'), null); // complex shell: not guessed
  // never lifted by time; only by the user's explicit allow
  assert.ok(matchRefusal(s, ps, 1e12, 1));
  s = liftDenials(s, '1').s;
  assert.equal(matchRefusal(s, ps, 5, 1e9), null);
});

test('Rule C: a harness form refusal lets a different form through; an approval refusal does not', () => {
  let s = emptyState();
  const form = callKeys({ tool: 'PowerShell', command: 'Set-Location proxy; python _lang_check.py', scope: 'D:/w' });
  s = recordRefusal(s, { kind: 'harness_refusal', form: true }, 'main', 'PowerShell', form, 1).s;
  assert.ok(matchRefusal(s, form, 2, 1e9));
  assert.equal(matchRefusal(s, callKeys({ tool: 'PowerShell', command: 'python proxy/_lang_check.py', scope: 'D:/w' }), 2, 1e9), null);
  let t = emptyState();
  const appr = callKeys({ tool: 'Bash', command: 'pip install pytest', scope: 'D:/w' });
  t = recordRefusal(t, { kind: 'harness_refusal', form: false }, 'main', 'Bash', appr, 1).s;
  assert.ok(matchRefusal(t, callKeys({ tool: 'PowerShell', command: 'pip install pytest 2>&1 | Select-Object -Last 20', scope: 'D:/w' }), 2, 1e9));
  assert.equal(matchRefusal(t, appr, 1 + 31 * 60_000, 30 * 60_000), null); // harness refusals expire
});

const inc = (over: Partial<Incident> = {}): Incident => ({
  id: 'inc-1', key: 'k', agent: 'main', action: 'az boards', state: 'OPEN', fails: 2, strategies: [], pending: [],
  errorKey: 'err-1', summary: 'ERROR: Before you can run Azure DevOps commands', baseEpoch: 0, baseToken: null, openedAt: 0, updatedAt: 0,
  kind: 'streak', attempts: [{ tool: 'Bash', action: 'az boards work-item show --id 27621', error: 'ERROR: … run the login command', changes: [] }], ...over,
});
const advice = (choice: string, p = 0.9): Advice => ({
  failureKind: { choice: 'environment_or_external', p: 0.8, probabilities: {} }, sameApproach: 0.7, nextStep: { choice, p, probabilities: { [choice]: p } },
});
const P = { minConfidence: 0.6, subagent: false, maxStrategies: 2 };

test('applyDecision: each action maps to a core state; limits win over Jev', () => {
  assert.equal(applyDecision(inc(), advice('ASK_USER'), P).state, 'NEEDS_USER');
  assert.equal(applyDecision(inc(), advice('MARK_BLOCKED'), P).state, 'BLOCKED');
  assert.equal(applyDecision(inc(), advice('STOP_AND_REPORT'), P).state, 'STOPPED');
  assert.equal(applyDecision(inc(), advice('ESCALATE_MODEL'), P).state, 'ESCALATION_REQUESTED');
  assert.equal(applyDecision(inc(), advice('ESCALATE_MODEL'), { ...P, subagent: true }).state, 'STOPPED'); // a subagent reports to its parent
  assert.equal(applyDecision(inc(), advice('RETRY_NEW_STRATEGY'), P).action, 'RETRY_NEW_STRATEGY');
  // limits
  assert.equal(applyDecision(inc(), advice('ASK_USER', 0.4), P).action, 'none');
  assert.equal(applyDecision(inc({ jevEscalated: true }), advice('ESCALATE_MODEL'), P).action, 'none');
  const spent = inc({ strategies: [{ changes: ['a'], errorKey: 'e', summary: 's' }, { changes: ['b'], errorKey: 'e', summary: 's' }] });
  assert.equal(applyDecision(spent, advice('RETRY_NEW_STRATEGY'), P).action, 'none');
  for (const a of ['ASK_USER', 'MARK_BLOCKED', 'STOP_AND_REPORT', 'ESCALATE_MODEL', 'RETRY_NEW_STRATEGY'])
    assert.notEqual(applyDecision(inc(), advice(a), P).state, 'CLOSED');
});

test('redact: home paths and secrets never reach Jev or the dataset', () => {
  const r = redact('cd C:\\Users\\someone\\AppData && curl -H "Authorization: Bearer sk-or-v1-abcdefabcdefabcdefabcdefabcdef0123456789"', 300);
  assert.ok(!r.includes('someone'));
  assert.ok(!r.includes('sk-or-v1-abcdef'));
});
