// Story 2268 AC4: preflight on Node <22 or without the haiku-100k setup stops with a message and starts no
// subagent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflight, startIfReady } from '../scripts/preflight.mjs';

function settings(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2268-pf-'));
  const file = path.join(dir, 'settings.json');
  if (json !== undefined) fs.writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json));
  return file;
}
const READY = { modelSettings: { 'claude-haiku-5-5': { autoCompactWindow: 125000 } } };

test('2268 AC4 node too old: Node 21 stops with a message and starts no subagent', () => {
  const r = preflight({ nodeVersion: '21.7.3', settingsFile: settings(READY) });
  assert.equal(r.ok, false);
  assert.match(r.message, /Node 21\.7\.3 is too old.*22/);
  let started = 0;
  const s = startIfReady(r, () => { started++; });
  assert.equal(s.started, false);
  assert.equal(started, 0);
  assert.equal(s.message, r.message);
});

test('2268 AC4 node too old: Node 22 with setup passes and starts', () => {
  const r = preflight({ nodeVersion: 'v22.0.0', settingsFile: settings(READY) });
  assert.equal(r.ok, true);
  let started = 0;
  assert.equal(startIfReady(r, () => { started++; return 'go'; }).value, 'go');
  assert.equal(started, 1);
});

test('2268 AC4 missing setup: no settings file, no marker or bad JSON stops with a message', () => {
  for (const file of [settings(undefined), settings({ modelSettings: {} }), settings('{not json')]) {
    const r = preflight({ nodeVersion: '24.0.0', settingsFile: file });
    assert.equal(r.ok, false);
    assert.match(r.message, /haiku-100k setup missing/);
    assert.match(r.message, /\/haiku-100k:setup/);
    let started = 0;
    assert.equal(startIfReady(r, () => { started++; }).started, false);
    assert.equal(started, 0);
  }
});
