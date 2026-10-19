// End-to-end check of the Haiku verdict: runs the real build_report.mjs CLI on a temp run folder
// and reads the manifest and report back. Covers the wiring that the unit tests of usage_by_phase do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'scripts', 'build_report.mjs');

const line = (timestamp, id, usage) => JSON.stringify({ type: 'assistant', timestamp, message: { id, model: 'claude-haiku-5-5', usage } });
const u = (input, cacheRead = 0) => ({ input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: 10 });

function runDir(phases, transcriptLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-verdict-'));
  const transcript = path.join(dir, 'session.jsonl');
  fs.writeFileSync(transcript, transcriptLines.join('\n') + '\n');
  const manifest = {
    schemaVersion: 1, runId: 'verdict-test', tool: 'haiku-build', status: 'REPORTED', task: 'fixture',
    opusCalls: [], phases, transcript,
    haiku: { haiku_request_count: null, haiku_requests_over_100k: null, max_haiku_input_tokens: null, input_limit_verification: 'not_measured' },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function build(dir) {
  // An empty projects folder: the transcript fallback must not find a real session that mentions the run id.
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-noproj-'));
  const r = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8', env: { ...process.env, HAIKU_BUILD_PROJECTS_DIR: projects } });
  assert.equal(r.status, 0, r.stderr);
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')),
    html: fs.readFileSync(path.join(dir, 'report.html'), 'utf8'),
  };
}

test('the CLI does not report pass when a phase window is still open', () => {
  const dir = runDir(
    [{ phase: '01-intake', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:10:00Z' }, { phase: '02-plan', from: '2026-10-19T10:10:00Z' }],
    [line('2026-10-19T10:05:00Z', 'm1', u(1000))],
  );
  const { manifest, html } = build(dir);
  assert.equal(manifest.haiku.input_limit_verification, 'not_measured');
  assert.equal(manifest.haiku.reason, 'open_window');
  assert.equal(manifest.haiku.haiku_request_count, 1);
  assert.match(html, /not_measured \(open_window\)/);
});

test('the CLI reports pass only with closed windows, measured requests and none over 100k', () => {
  const dir = runDir(
    [{ phase: '01-intake', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:10:00Z' }],
    [line('2026-10-19T10:05:00Z', 'm1', u(1000))],
  );
  const { manifest } = build(dir);
  assert.equal(manifest.haiku.input_limit_verification, 'pass');
  assert.equal(manifest.haiku.haiku_requests_over_100k, 0);
  assert.equal(manifest.haiku.reason ?? null, null);
});

test('the CLI reports fail for a request over 100k, even with an open window', () => {
  const dir = runDir(
    [{ phase: '01-intake', from: '2026-10-19T10:00:00Z' }],
    [line('2026-10-19T10:05:00Z', 'm1', u(99000, 2000))],
  );
  const { manifest } = build(dir);
  assert.equal(manifest.haiku.input_limit_verification, 'fail');
  assert.equal(manifest.haiku.haiku_requests_over_100k, 1);
});

test('the CLI reports not_measured with no_transcript when the transcript file is missing', () => {
  const dir = runDir(
    [{ phase: '01-intake', from: '2026-10-19T10:00:00Z', to: '2026-10-19T10:10:00Z' }],
    [line('2026-10-19T10:05:00Z', 'm1', u(1000))],
  );
  fs.rmSync(path.join(dir, 'session.jsonl'));
  const { manifest } = build(dir);
  assert.equal(manifest.haiku.input_limit_verification, 'not_measured');
  assert.equal(manifest.haiku.reason, 'no_transcript');
  assert.equal(manifest.haiku.haiku_request_count, null);
});
