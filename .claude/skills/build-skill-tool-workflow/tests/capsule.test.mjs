import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'make_capsule.mjs');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

function makeExp({ brief = 'Problem: long logs.\n', findings = null, summary = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, experimentId: 'exp1', status: 'EVALUATION_COMPLETE',
    tool: { name: 'demo-tool', kind: 'skill', provider: 'JEV', branch: 'claude/demo', commit: 'abc1234' },
    approvals: { ideaApprovedAt: '2026-10-18T00:00:00Z' },
    evaluation: { caseCount: 4, repetitions: 2, criteriaFrozenAt: '2026-10-18T01:00:00Z' },
  }));
  fs.writeFileSync(path.join(dir, 'idea-brief.md'), brief);
  fs.writeFileSync(path.join(dir, 'unit-tests.json'), JSON.stringify({ suites: [{ level: 'unit', command: 'node --test "t/*.mjs"', passed: 5, failed: 0 }] }));
  if (summary) fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    recommendation: 'PILOT', confidence: 'LOW', pairedCases: 4, regressions: [],
    arms: { A: { cases: 8, pass: 8, pairedTokens: 1000 }, B: { cases: 8, pass: 8, pairedTokens: 800 } },
  }));
  if (findings) fs.writeFileSync(path.join(dir, 'agent-review.json'), JSON.stringify({ findings }));
  return dir;
}

describe('make_capsule', () => {
  it('writes a P2 capsule with the required fields and one output line', () => {
    const dir = makeExp();
    const r = run(dir, '--phase', 'P2');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const t = fs.readFileSync(path.join(dir, 'capsule-P2.md'), 'utf8');
    for (const s of ['phase-2-build.md', 'claude/demo', 'abc1234', 'node --test "t/*.mjs"', 'Problem: long logs.', '## Done when', 'enforce'])
      assert.ok(t.includes(s), `missing ${s}`);
  });

  it('P3 turns smart-context-trimming off and shows the frozen design', () => {
    const dir = makeExp();
    assert.equal(run(dir, '--phase', 'P3').status, 0);
    const t = fs.readFileSync(path.join(dir, 'capsule-P3.md'), 'utf8');
    assert.ok(t.includes('off (SMART_TRIM_MODE=observe)'));
    assert.ok(t.includes('2026-10-18T01:00:00Z'));
  });

  it('P4 lists only the findings the user accepted', () => {
    const dir = makeExp({ findings: [
      { severity: 'Major', finding: 'timeout not handled', resolution: 'accepted by the user (2026-10-18)', proposedFix: 'add fallback' },
      { severity: 'Minor', finding: 'rejected thing', resolution: 'rejected by the user (2026-10-18)' },
      { severity: 'Minor', finding: 'undecided thing' },
    ] });
    assert.equal(run(dir, '--phase', 'P4').status, 0);
    const t = fs.readFileSync(path.join(dir, 'capsule-P4.md'), 'utf8');
    assert.ok(t.includes('FIX [Major] timeout not handled'));
    assert.ok(t.includes('add fallback'));
    assert.ok(!t.includes('rejected thing'));
    assert.ok(t.includes('1 accepted by the user to fix, 1 undecided'));
    assert.ok(t.includes('A 1000 → B 800'));
  });

  it('stays under the size cap with a huge brief', () => {
    const dir = makeExp({ brief: 'x'.repeat(50000) });
    assert.equal(run(dir, '--phase', 'P2', '--max-chars', '4000').status, 0);
    assert.ok(fs.readFileSync(path.join(dir, 'capsule-P2.md'), 'utf8').length <= 4000);
  });

  it('fails cleanly on a bad phase or a missing manifest', () => {
    assert.equal(run(makeExp(), '--phase', 'P9').status, 2);
    assert.equal(run(fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-empty-')), '--phase', 'P2').status, 1);
  });
});
