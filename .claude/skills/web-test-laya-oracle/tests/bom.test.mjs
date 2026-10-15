// results.json written by PowerShell (Set-Content / Out-File -Encoding utf8) starts with a UTF-8 BOM, which
// JSON.parse rejects. Every script of this skill that reads results.json must accept it. Engines are kept off
// (no Laya, no Jev) and HOME is isolated, so this never touches a model, a browser or ~/.ess-web-test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const BOM = '﻿';

function bomRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bom-run-'));
  const results = { ticket: 1, cases: [{ id: 'TC01', status: 'not-run', steps: [
    { n: 1, action: 'Look at the leave balance card', expected: "Card shows 'Annual leave'", status: 'not-run', writes: false },
  ] }] };
  fs.writeFileSync(path.join(dir, 'results.json'), BOM + JSON.stringify(results, null, 2), 'utf8');
  return dir;
}

function node(script, args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bom-home-'));
  const env = { ...process.env, USERPROFILE: home, HOME: home, JEV_ENABLED: '0', LAYA_URL: 'http://127.0.0.1:9', DECISION_PROVIDER: '' };
  delete env.OPENROUTER_API_KEY;
  return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { env, encoding: 'utf8', timeout: 30000 });
}

const step1 = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8').replace(/^﻿/, '')).cases[0].steps[0];
const noParseError = (r) => assert.doesNotMatch(`${r.stderr}${r.stdout}`, /SyntaxError|Unexpected token|is not valid JSON/);

// [script, args after <runDir>, check(dir, result)] — only the scripts this skill copy ships are run.
const CASES = [
  ['record.mjs', ['TC01', '1', 'pass', '--actual', 'Annual leave 12 days'], (dir, r) => { assert.equal(r.status, 0, r.stderr); assert.equal(step1(dir).status, 'pass'); }],
  ['verdict.mjs', ['TC01', '1', '--status', 'pass'], (dir, r) => { assert.equal(r.status, 0, r.stderr); assert.equal(step1(dir).status, 'pass'); }],
  ['oracle.mjs', ['TC01', '1', '--status', 'pass'], (dir, r) => { assert.equal(r.status, 0, r.stderr); assert.equal(step1(dir).status, 'pass'); }],
  ['gate.mjs', [], (dir, r) => { assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(step1(dir).gate.writes, 'read'); }],
  ['build_report.mjs', [], (dir, r) => { assert.equal(r.status, 0, r.stderr); assert.ok(fs.existsSync(path.join(dir, 'report.html'))); }],
];

describe('results.json with a UTF-8 BOM', () => {
  for (const [script, args, check] of CASES) {
    if (!fs.existsSync(path.join(SCRIPTS, script))) continue;
    it(`${script} reads it`, () => {
      const dir = bomRun();
      const r = node(script, [dir, ...args]);
      noParseError(r);
      check(dir, r);
    });
  }
});
