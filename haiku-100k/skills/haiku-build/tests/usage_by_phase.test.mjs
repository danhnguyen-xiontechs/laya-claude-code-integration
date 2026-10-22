import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usageByPhase, overlaps, contextOf, classOf } from '../scripts/usage_by_phase.mjs';

const line = (timestamp, id, model, usage) => JSON.stringify({ type: 'assistant', timestamp, message: { id, model, usage } });
const u = (input, cacheRead = 0, cacheWrite = 0, output = 10) => ({
  input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, output_tokens: output,
});

function fixture(mainLines, subLines = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-test-'));
  const main = path.join(dir, 'session.jsonl');
  fs.writeFileSync(main, mainLines.join('\n') + '\n');
  const subDir = path.join(dir, 'session', 'subagents');
  if (Object.keys(subLines).length) {
    fs.mkdirSync(subDir, { recursive: true });
    for (const [name, lines] of Object.entries(subLines)) fs.writeFileSync(path.join(subDir, name), lines.join('\n') + '\n');
  }
  return main;
}

const phases = [
  { phase: '01-intake', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:10:00Z' },
  { phase: '02-plan', from: '2026-10-19T10:10:00Z', to: '2026-10-19T10:20:00Z' },
  { phase: '03-implement', from: '2026-10-19T10:20:00Z', to: '2026-10-19T10:40:00Z' },
];

test('contextOf sums the three input fields, as the hook does', () => {
  assert.equal(contextOf(u(5, 90, 3)), 98);
  assert.equal(classOf('claude-haiku-5-5'), 'haiku');
  assert.equal(classOf('claude-opus-5-5'), 'opus');
});

test('overlapping phase windows are reported', () => {
  const bad = overlaps([
    { phase: 'a', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:30:00Z' },
    { phase: 'b', from: '2026-10-19T10:20:00Z', to: '2026-10-19T10:40:00Z' },
  ]);
  assert.deepEqual(bad, [['a', 'b']]);
});

test('turns are split by phase, duplicates count once, outside turns are unassigned', () => {
  const main = fixture([
    line('2026-10-19T10:05:00Z', 'm1', 'claude-haiku-5-5', u(1000)),
    line('2026-10-19T10:05:01Z', 'm1', 'claude-haiku-5-5', u(1000)), // same message id, second line
    line('2026-10-19T10:30:00Z', 'm2', 'claude-haiku-5-5', u(2000)),
    line('2026-10-19T11:00:00Z', 'm3', 'claude-haiku-5-5', u(3000)), // after every window
  ]);
  const r = usageByPhase({ mainFile: main, phases });
  assert.equal(r.phases[0].turns, 1);
  assert.equal(r.phases[0].byClass.haiku.input, 1000);
  assert.equal(r.phases[1].turns, null);
  assert.equal(r.phases[2].turns, 1);
  assert.equal(r.unassigned.turns, 1);
  assert.equal(r.haiku.request_count, 3);
  assert.equal(r.haiku.input_limit_verification, 'pass');
});

test('an Opus subagent is counted as an Opus call in the phase it started in', () => {
  const main = fixture(
    [line('2026-10-19T10:12:00Z', 'm1', 'claude-haiku-5-5', u(500))],
    { 'agent-plan.jsonl': [line('2026-10-19T10:12:30Z', 's1', 'claude-opus-5-5', u(4000))] },
  );
  const r = usageByPhase({ mainFile: main, phases });
  assert.equal(r.phases[1].opusCalls, 1);
  assert.equal(r.phases[1].byClass.opus.input, 4000);
  assert.equal(r.phases[1].byClass.haiku.turns, 1);
});

test('a Haiku request over 100k input tokens fails the limit check', () => {
  const main = fixture([
    line('2026-10-19T10:05:00Z', 'm1', 'claude-haiku-5-5', u(60000, 40000, 5000)),
    line('2026-10-19T10:06:00Z', 'm2', 'claude-haiku-5-5', u(1000, 2000, 0)),
  ]);
  const r = usageByPhase({ mainFile: main, phases });
  assert.equal(r.haiku.requests_over_100k, 1);
  assert.equal(r.haiku.max_haiku_input_tokens, 105000);
  assert.equal(r.haiku.input_limit_verification, 'fail');
});

test('a Haiku subagent request is checked too', () => {
  const main = fixture(
    [line('2026-10-19T10:05:00Z', 'm1', 'claude-haiku-5-5', u(1000))],
    { 'agent-case.jsonl': [line('2026-10-19T10:06:00Z', 's1', 'claude-haiku-5-5', u(99000, 2000))] },
  );
  const r = usageByPhase({ mainFile: main, phases });
  assert.equal(r.haiku.request_count, 2);
  assert.equal(r.haiku.max_haiku_input_tokens, 101000);
  assert.equal(r.haiku.requests_over_100k, 1);
});

test('a missing transcript is not measured, never zero', () => {
  const r = usageByPhase({ mainFile: path.join(os.tmpdir(), 'no-such-session.jsonl'), phases });
  assert.equal(r.haiku.input_limit_verification, 'not_measured');
  assert.equal(r.haiku.reason, 'no_transcript');
  assert.equal(r.haiku.request_count, null);
  assert.equal(r.phases[0].turns, null);
  assert.equal(r.unassigned, null);
});

// --- Windows and verdict (P0 from review): pass needs closed, non-overlapping windows, measured Haiku requests and zero over 100k.

const okMain = () => fixture([line('2026-10-19T10:05:00Z', 'm1', 'claude-haiku-5-5', u(1000))]);

test('an open window (no to) makes the verdict not_measured, even with every request under 100k', () => {
  const main = okMain();
  const open = [{ phase: '01-intake', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:10:00Z' }, { phase: '02-plan', from: '2026-10-19T10:10:00Z' }];
  const r = usageByPhase({ mainFile: main, phases: open });
  assert.equal(r.haiku.input_limit_verification, 'not_measured');
  assert.equal(r.haiku.reason, 'open_window');
  assert.deepEqual(r.open_windows, ['02-plan']);
  assert.equal(r.haiku.request_count, 1); // still measured, just not a pass
});

test('a window with from >= to, or an unparseable time, counts as open', () => {
  const main = okMain();
  const backwards = [{ phase: 'a', from: '2026-10-19T10:10:00Z', to: '2026-10-19T10:00:00Z' }];
  const garbage = [{ phase: 'b', from: 'not-a-date', to: '2026-10-19T10:00:00Z' }];
  assert.equal(usageByPhase({ mainFile: main, phases: backwards }).haiku.input_limit_verification, 'not_measured');
  assert.equal(usageByPhase({ mainFile: main, phases: garbage }).haiku.reason, 'open_window');
});

test('overlapping windows make the verdict not_measured with reason overlap', () => {
  const main = okMain();
  const r = usageByPhase({
    mainFile: main,
    phases: [
      { phase: 'a', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:30:00Z' },
      { phase: 'b', from: '2026-10-19T10:20:00Z', to: '2026-10-19T10:40:00Z' },
    ],
  });
  assert.deepEqual(r.overlaps, [['a', 'b']]);
  assert.equal(r.haiku.input_limit_verification, 'not_measured');
  assert.equal(r.haiku.reason, 'overlap');
});

test('overlap is found between non-adjacent windows (a long window covering a later one)', () => {
  const bad = overlaps([
    { phase: 'a', from: '2026-10-19T10:00:00Z', to: '2026-10-19T11:00:00Z' },
    { phase: 'b', from: '2026-10-19T10:10:00Z', to: '2026-10-19T10:20:00Z' },
    { phase: 'c', from: '2026-10-19T10:30:00Z', to: '2026-10-19T10:40:00Z' },
  ]);
  assert.deepEqual(bad, [['a', 'b'], ['a', 'c']]);
});

test('no phases at all is not_measured, not pass', () => {
  const r = usageByPhase({ mainFile: okMain(), phases: [] });
  assert.equal(r.haiku.input_limit_verification, 'not_measured');
  assert.equal(r.haiku.reason, 'no_windows');
  assert.equal(r.unassigned.turns, 1);
});

test('closed, non-overlapping windows, measured requests, none over 100k: pass', () => {
  const r = usageByPhase({ mainFile: okMain(), phases });
  assert.equal(r.haiku.input_limit_verification, 'pass');
  assert.equal(r.haiku.reason, null);
  assert.equal(r.haiku.requests_over_100k, 0);
});

test('no Haiku usage in a closed run is not_measured, not pass', () => {
  const main = fixture([line('2026-10-19T10:05:00Z', 'o1', 'claude-opus-5-5', u(1000))]);
  const r = usageByPhase({ mainFile: main, phases });
  assert.equal(r.haiku.input_limit_verification, 'not_measured');
  assert.equal(r.haiku.reason, 'no_haiku_usage');
  assert.equal(r.haiku.request_count, 0); // measured zero: the transcript was read
});

test('a request over 100k is fail even when a window is still open', () => {
  const main = fixture([line('2026-10-19T10:05:00Z', 'm1', 'claude-haiku-5-5', u(99000, 2000))]);
  const r = usageByPhase({ mainFile: main, phases: [{ phase: '01-intake', from: '2026-10-19T10:00:00Z' }] });
  assert.equal(r.haiku.requests_over_100k, 1);
  assert.equal(r.haiku.input_limit_verification, 'fail');
});

test('turns outside every window stay in unassigned and do not change the phase rows', () => {
  const main = fixture([
    line('2026-10-19T09:00:00Z', 'early', 'claude-haiku-5-5', u(1000)),
    line('2026-10-19T10:05:00Z', 'm1', 'claude-haiku-5-5', u(1000)),
    line('2026-10-19T12:00:00Z', 'late', 'claude-haiku-5-5', u(1000)),
  ]);
  const r = usageByPhase({ mainFile: main, phases });
  assert.equal(r.phases[0].turns, 1);
  assert.equal(r.unassigned.turns, 2);
  assert.equal(r.haiku.request_count, 3);
});
