// Builds a fake two-arm experiment on disk and checks the per-tool and main reports recompute from raw cases:
// A (plain Claude) vs B (Claude + engine): blocked never counts as pass/fail, a case worse than A is flagged, the main report links (not copies) the per-tool one.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const node = (script, arg) => spawnSync(process.execPath, [path.join(SCRIPTS, script), arg], { encoding: 'utf8' });
const write = (f, o, bom = '') => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, bom + JSON.stringify(o), 'utf8');
};
const kase = (caseId, status, inputTokens) => ({
  caseId, status, goldOutcome: `gold ${caseId}`, usage: { inputTokens, outputTokens: 10, toolCalls: 2, elapsedMs: 1000, source: 'transcript' },
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-'));
  const exp = path.join(root, 'demo-tool', 'exp1');
  write(path.join(exp, 'manifest.json'), {
    schemaVersion: 1, experimentId: 'exp1', status: 'WAITING_FOR_USER_FINAL_REVIEW', recommendation: 'PILOT',
    tool: { name: 'demo-tool', kind: 'skill', provider: 'Laya' },
    arms: [{ id: 'A', name: 'Plain Claude', candidateEnabled: false, engineEnabled: false }, { id: 'B', name: 'Claude + Laya', candidateEnabled: true, engineEnabled: true }],
    artifacts: { ideaBrief: null, perToolReport: 'report.html', mainReport: '../../index.html' },
  });
  const run = (arm, cases) =>
    write(path.join(exp, 'runs', arm, 'r1', 'results.json'), { startedAt: '2026-10-16T01:00:00Z', finishedAt: '2026-10-16T02:00:00Z', cases }, '﻿');
  run('A-claude', [kase('T1', 'pass', 100), kase('T2', 'fail', 100), kase('T3', 'blocked', 100)]);
  run('B-claude-laya', [kase('T1', 'fail', 50), kase('T2', 'pass', 50), kase('T3', 'pass', 50)]);
  write(path.join(exp, 'unit-tests.json'), { suites: [{ level: 'unit', command: 'node --test', passed: 5, failed: 0, skipped: 1, notRun: 0 }] });
  write(path.join(exp, 'agent-review.json'), { findings: [{ severity: 'Major', finding: 'no timeout', resolution: 'open' }, { severity: 'Critical', finding: 'x', resolution: 'fixed in abc' }] });
  return { root, exp };
}

describe('build reports', () => {
  it('per-tool summary is recomputed from raw cases', () => {
    const { exp } = fixture();
    const r = node('build_tool_report.mjs', exp);
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(fs.readFileSync(path.join(exp, 'summary.json'), 'utf8'));
    assert.equal(s.arms.A.passRate, 0.5); // blocked excluded from denominator
    assert.equal(s.arms.A.blocked, 1);
    assert.equal(s.arms.B.passRate, 2 / 3);
    assert.equal(s.arms.A.tokens, 330); // input 100 + output 10, per case
    assert.equal(s.arms.B.tokens, 180);
    assert.equal(s.engine, 'Laya');
    assert.deepEqual(s.regressions, ['T1']);
    assert.deepEqual(s.improvements, ['T2', 'T3']);
    assert.equal(s.openBlockingFindings, 1);
    const html = fs.readFileSync(path.join(exp, 'report.html'), 'utf8');
    assert.match(html, /plain Claude vs Claude \+ Laya/);
    assert.match(html, /<tr class="worse">/);
    assert.match(html, /-45%/); // 330 -> 180 tokens
  });

  it('main report links each per-tool report', () => {
    const { root, exp } = fixture();
    node('build_tool_report.mjs', exp);
    const r = node('build_main_report.mjs', root);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /href="demo-tool\/exp1\/report\.html"/);
    assert.match(html, /worse on T1/);
  });
});
