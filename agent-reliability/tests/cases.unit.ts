// §12 case list as small fixtures over the pure rules (node --test tests/*.unit.ts).
// JEV_LIVE=1 adds a handful of real TypeSafe JEV calls on near-duplicates (≤ 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, type Category, type GuardState, type Options, type Outcome, classify, decideBefore, emptyState,
  fingerprint, jevBlocks, jevRequest, parseJev, prune, recordAfter,
} from '../hooks/core.ts';

const WS = 'D:/proj';
const T0 = 1_000_000;
const ENF: Options = { ...DEFAULTS, mode: 'enforce' };

const ASSERT = 'Exit code 1\nFAIL tests/a.test.ts\n  ✗ adds numbers (12 ms)\n  AssertionError: expected 3, received 4\n    at /tmp/jest-abc123/a.test.ts:10:5\n';
const ASSERT_NOISE = 'Exit code 1\nFAIL tests/a.test.ts\n  ✗ adds numbers (40 ms)\n  AssertionError: expected 3, received 4\n    at /tmp/jest-zzz999/a.test.ts:10:5\n';
const ASSERT_OTHER = 'Exit code 1\nFAIL tests/a.test.ts\n  ✗ adds numbers\n  AssertionError: expected 3, received 5\n';
const CS = 'Exit code 1\nsrc/A.cs(10,5): error CS0103: The name \'foo\' does not exist in the current context\nBuild FAILED.\nTime Elapsed 00:00:03.21';
const NET = 'Exit code 1\nnpm ERR! code ECONNRESET\nnpm ERR! network request to https://registry.npmjs.org failed';

type Step = { cmd: string; out: 'pass' | string } | { edit: true } | { newSession: true };

/** Plays steps; returns, for each command, whether the guard would block it before running. */
function play(steps: Step[], o: Options = ENF, ws = WS) {
  let s: GuardState = emptyState();
  let now = T0;
  const verdicts: string[] = [];
  for (const st of steps) {
    now += 1000;
    if ('edit' in st) { s = { ...s, epoch: s.epoch + 1 }; continue; }
    if ('newSession' in st) { s = emptyState(); continue; }
    const cat = classify(st.cmd) as Category | null;
    if (!cat) { verdicts.push('ineligible'); continue; }
    const d = decideBefore(prune(s, now, o), ws, st.cmd, now, o);
    verdicts.push(d.kind === 'pass' ? `pass:${d.reason}` : `${d.kind}:${d.reason}`);
    if (d.kind === 'block') continue; // denied: never ran
    const out: Outcome = st.out === 'pass' ? { kind: 'passed' } : { kind: 'failed', text: st.out };
    s = recordAfter(s, ws, st.cmd, cat, out, now, o);
  }
  return { verdicts, s };
}
const blocks = (v: string[]) => v.filter((x) => x.startsWith('block')).length;

test('1. exact same failing test repeated without change → blocked at threshold (2), noise-masked', () => {
  const { verdicts } = play([{ cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT_NOISE }, { cmd: 'npm  test', out: ASSERT }]);
  assert.deepEqual(verdicts.slice(0, 2), ['pass:no_matching_failure', 'pass:below_threshold']);
  assert.equal(verdicts[2], 'block:same_action_same_failure_no_state_change');
});

test('1b. threshold 1 blocks the first repeat', () => {
  const { verdicts } = play([{ cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT }], { ...ENF, maxIdenticalFailuresBeforeBlock: 1 });
  assert.equal(blocks(verdicts), 1);
});

test('2. same build with identical compiler errors (elapsed time differs) → blocked', () => {
  const { verdicts } = play([{ cmd: 'dotnet build', out: CS }, { cmd: 'dotnet build', out: CS.replace('00:00:03.21', '00:00:07.90') }, { cmd: 'dotnet build', out: CS }]);
  assert.equal(verdicts[2]!.startsWith('block'), true);
});

test('3. rerun after a successful edit → allowed, every time', () => {
  const { verdicts } = play([
    { cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT }, { edit: true },
    { cmd: 'npm test', out: ASSERT }, { edit: true }, { cmd: 'npm test', out: 'pass' },
  ]);
  assert.equal(blocks(verdicts), 0);
  assert.equal(verdicts[2], 'pass:state_changed_since_failure');
});

test('4. same command, changed failure signature → count restarts, allowed', () => {
  const { verdicts } = play([{ cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT_OTHER }, { cmd: 'npm test', out: ASSERT }]);
  assert.equal(blocks(verdicts), 0);
  assert.notEqual(fingerprint(ASSERT).fp, fingerprint(ASSERT_OTHER).fp);
  assert.equal(fingerprint(ASSERT).fp, fingerprint(ASSERT_NOISE).fp);
});

test('5. transient network failure → never blocked', () => {
  const { verdicts } = play([{ cmd: 'npm test', out: NET }, { cmd: 'npm test', out: NET }, { cmd: 'npm test', out: NET }, { cmd: 'npm test', out: NET }]);
  assert.equal(blocks(verdicts), 0);
  assert.equal(verdicts[2], 'pass:transient_failure');
});

test('6. flaky test (fail → pass → fail → fail) → never blocked', () => {
  const { verdicts } = play([
    { cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: 'pass' },
    { cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT },
  ]);
  assert.equal(blocks(verdicts), 0);
  assert.equal(verdicts[4], 'pass:flaky_action');
});

test('7. near-duplicate targeting another test → ambiguous (JEV), never a deterministic block', () => {
  const a = 'dotnet test tests/Employee.Api.Tests.csproj --filter EducationSync';
  const b = 'dotnet test tests/Employee.Api.Tests.csproj --filter PayrollSync';
  const { verdicts } = play([{ cmd: a, out: CS }, { cmd: a, out: CS }, { cmd: b, out: CS }]);
  assert.match(verdicts[2]!, /^ambiguous:near_duplicate/);
  const other = play([{ cmd: 'go test ./pkg/auth/...', out: ASSERT }, { cmd: 'go test ./pkg/auth/...', out: ASSERT }, { cmd: 'cargo test', out: ASSERT }]);
  assert.equal(other.verdicts[2], 'pass:no_matching_failure');
});

test('8. permission denial is not evidence (recorded as ignored)', () => {
  let s = emptyState();
  for (let i = 0; i < 4; i++) s = recordAfter(s, WS, 'npm test', 'test_run', { kind: 'ignored', reason: 'permission' }, T0 + i, ENF);
  assert.equal(s.records.length, 0);
  assert.equal(decideBefore(s, WS, 'npm test', T0 + 10, ENF).kind, 'pass');
});

test('9. side-effect / compound / unknown commands are ineligible', () => {
  for (const c of ['git push', 'npm publish', 'rm -rf dist', 'npm test && git push', 'npm test | tee log', 'CI=1 npm test', 'dotnet ef database update', 'npm run deploy', 'make'])
    assert.equal(classify(c), null, c);
  for (const c of ['npm test', 'npm run build', 'dotnet test x.csproj', 'pytest -x', 'go test ./...', 'npx tsc --noEmit'])
    assert.notEqual(classify(c), null, c);
});

test('10. JEV timeout / invalid JSON / out-of-enum / low confidence → allow', () => {
  const o = ENF;
  assert.equal(jevBlocks({ error: 'timeout' }, o), false);
  assert.equal(jevBlocks(parseJev(null), o), false);
  assert.equal(jevBlocks(parseJev({ answers: { decision: { choice: 'rm -rf /' } } }), o), false);
  assert.equal(jevBlocks(parseJev({ answers: { decision: { choice: 'block_redundant_retry', probabilities: { block_redundant_retry: 1.7 } } } }), o), false);
  assert.equal(jevBlocks(parseJev({ answers: { decision: { probabilities: { block_redundant_retry: 0.55, allow_retry: 0.45 } } } }), o), false);
  assert.equal(jevBlocks(parseJev({ answers: { decision: { probabilities: { block_redundant_retry: 0.93, allow_retry: 0.07 } } } }), o), true);
});

test('11. user asks for a retry → epoch bump → allowed (same path as an edit)', async () => {
  const { RETRY_REQUEST } = await import('../hooks/core.ts');
  for (const t of ['please rerun the tests', 'try again', 'chạy lại test đi', 'run the tests again']) assert.ok(RETRY_REQUEST.test(t), t);
  assert.ok(!RETRY_REQUEST.test('why does the test fail?'));
});

test('12. new session / other workspace / TTL: no leak', () => {
  const rep = [{ cmd: 'npm test', out: ASSERT }, { cmd: 'npm test', out: ASSERT }];
  assert.equal(blocks(play([...rep, { newSession: true }, { cmd: 'npm test', out: ASSERT }]).verdicts), 0);
  const { s } = play(rep);
  assert.equal(decideBefore(s, 'D:/other', 'npm test', T0 + 5000, ENF).kind, 'pass');
  assert.equal(decideBefore(s, WS, 'npm test', T0 + 31 * 60_000, ENF).kind, 'pass');
  assert.equal(decideBefore(s, WS, 'npm test', T0 + 5000, ENF).kind, 'block');
});

// ---------------------------------------------------------------- live JEV (≤ 6 calls)

const LIVE: { name: string; prev: string; next: string; out: string; redundant: boolean }[] = [
  { name: 'different filter', prev: 'dotnet test tests/Employee.Api.Tests.csproj --filter EducationSync', next: 'dotnet test tests/Employee.Api.Tests.csproj --filter PayrollSync', out: CS, redundant: false },
  { name: 'different test file', prev: 'npx jest src/a.test.ts', next: 'npx jest src/b.test.ts', out: ASSERT, redundant: false },
  { name: 'different package', prev: 'go test ./pkg/auth/...', next: 'go test ./pkg/billing/...', out: ASSERT, redundant: false },
  { name: 'adds -v to same test', prev: 'pytest tests/test_api.py -x', next: 'pytest tests/test_api.py -x -q', out: ASSERT, redundant: true },
  { name: 'adds --no-restore', prev: 'dotnet test tests/A.csproj --filter EducationSync', next: 'dotnet test tests/A.csproj --filter EducationSync --no-restore', out: CS, redundant: true },
];

test('live JEV on near-duplicates: zero false blocks', { skip: !process.env.JEV_LIVE || !process.env.OPENROUTER_API_KEY }, async () => {
  const rows: string[] = [];
  let falseBlocks = 0;
  for (const c of LIVE) {
    const { s } = play([{ cmd: c.prev, out: c.out }, { cmd: c.prev, out: c.out }]);
    const d = decideBefore(s, WS, c.next, T0 + 5000, ENF);
    if (d.kind !== 'ambiguous') { rows.push(`${c.name}: deterministic ${d.kind}`); continue; }
    const t = Date.now();
    let v;
    try {
      const r = await fetch('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST', signal: AbortSignal.timeout(DEFAULTS.jevTimeoutMs * 3),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        body: JSON.stringify({ model: 'typesafe/jev-1.13', ...jevRequest(d.record, c.next, false) }),
      });
      v = r.ok ? parseJev(await r.json()) : { error: `http_${r.status}` };
    } catch (e) { v = { error: String((e as Error).name) }; }
    const blocked = jevBlocks(v, ENF);
    if (blocked && !c.redundant) falseBlocks++;
    rows.push(`${c.name}: ${JSON.stringify(v)} → ${blocked ? 'BLOCK' : 'allow'} (expected ${c.redundant ? 'redundant' : 'new info'}) ${Date.now() - t}ms`);
  }
  // timeout path, real call with a 1 ms budget
  const { s } = play([{ cmd: LIVE[0]!.prev, out: CS }, { cmd: LIVE[0]!.prev, out: CS }]);
  const d = decideBefore(s, WS, LIVE[0]!.next, T0 + 5000, ENF);
  const tv = await Promise.race([
    fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, body: JSON.stringify({ model: 'typesafe/jev-1.13', ...jevRequest((d as { record: never }).record, LIVE[0]!.next, false) }) }).then(async (r) => parseJev(await r.json())),
    new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 1)),
  ]) as never;
  rows.push(`timeout 1ms: ${JSON.stringify(tv)} → ${jevBlocks(tv, ENF) ? 'BLOCK' : 'allow'}`);
  console.log(rows.join('\n'));
  assert.equal(falseBlocks, 0);
});
