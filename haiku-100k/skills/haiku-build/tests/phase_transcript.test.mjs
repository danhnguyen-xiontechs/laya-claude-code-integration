import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPhase, endPhase } from '../scripts/phase.mjs';
import { normalizeTranscriptPath, resolveTranscript } from '../scripts/build_report.mjs';

const t = (s) => new Date(`2026-10-19T08:00:${s}Z`);

test('startPhase closes the open window and opens the next at the same instant', () => {
  let m = startPhase({ phases: [] }, '01-intake', t('00'));
  m = startPhase(m, '02-plan', t('05'));
  assert.deepEqual(m.phases, [
    { phase: '01-intake', from: '2026-10-19T08:00:00.000Z', to: '2026-10-19T08:00:05.000Z' },
    { phase: '02-plan', from: '2026-10-19T08:00:05.000Z' },
  ]);
});

test('endPhase closes only the open window', () => {
  const m = endPhase({ phases: [{ phase: 'a', from: 'x', to: 'y' }, { phase: 'b', from: 'y' }] }, t('09'));
  assert.equal(m.phases[0].to, 'y');
  assert.equal(m.phases[1].to, '2026-10-19T08:00:09.000Z');
});

test('transcript paths: backslashes become forward slashes; a mangled path is rejected', () => {
  assert.equal(normalizeTranscriptPath('C:\\Users\\u\\.claude\\projects\\p\\s.jsonl'), 'C:/Users/u/.claude/projects/p/s.jsonl');
  assert.equal(normalizeTranscriptPath('C:\\Users\bad'), null); // "\b" became a backspace through a shell
  assert.equal(normalizeTranscriptPath(null), null);
});

test('resolveTranscript uses the manifest path when it exists, else the lookup by run id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-t-'));
  const real = path.join(dir, 's.jsonl');
  fs.writeFileSync(real, '');
  assert.deepEqual(resolveTranscript(real, 'r', () => null), { path: real.replace(/\\/g, '/'), source: 'manifest' });
  assert.deepEqual(resolveTranscript('C:\\Users\bad', 'r', () => real), { path: real.replace(/\\/g, '/'), source: 'lookup' });
  assert.deepEqual(resolveTranscript(null, 'r', () => null), { path: null, source: 'none' });
  assert.deepEqual(resolveTranscript('/no/such.jsonl', 'r', () => null), { path: null, source: 'manifest path not found' });
});
