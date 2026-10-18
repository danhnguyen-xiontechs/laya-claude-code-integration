// phase_usage.mjs sums each phase session's transcript (subagents included) into evidence/phase-usage.json;
// a missing transcript gives nulls; the per-tool report shows the "Workflow cost per phase" card, or "not measured".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const node = (script, arg) => spawnSync(process.execPath, [path.join(SCRIPTS, script), arg], { encoding: 'utf8' });
const write = (f, s) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s, 'utf8');
};
// one assistant turn; `lines` > 1 repeats it as Claude Code does when a message has several content blocks
const turn = (id, model, input, read, write_, output, lines = 1) =>
  Array.from({ length: lines }, () => JSON.stringify({
    type: 'assistant', timestamp: '2026-10-18T01:00:00Z',
    message: { id, model, usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write_, output_tokens: output }, content: [] },
  })).join('\n');

function fixture({ withPhases = true } = {}) {
  const exp = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-ph-'));
  const p1 = path.join(exp, 't', 'p1.jsonl');
  // P1: two turns (peak = 10+1000+200 = 1210), the first split over 2 lines and counted once
  write(p1, [JSON.stringify({ type: 'user', message: { content: 'plan' } }), turn('a1', 'claude-opus-5-5', 10, 1000, 200, 50, 2), turn('a2', 'claude-opus-5-5', 5, 500, 100, 20), 'not json'].join('\n'));
  // P4 with an Opus review subagent: its tokens count, its context does not raise the session's peak
  const p4 = path.join(exp, 't', 'p4.jsonl');
  write(p4, turn('b1', 'claude-haiku-5-5', 1, 100, 10, 5));
  write(path.join(exp, 't', 'p4', 'subagents', 'agent-x.jsonl'), turn('c1', 'claude-opus-5-5', 2, 9000, 900, 30));
  write(path.join(exp, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, experimentId: 'exp-ph', status: 'EVALUATION_COMPLETE',
    tool: { name: 'demo', kind: 'skill', provider: 'none' },
    arms: [{ id: 'A', name: 'A', candidateEnabled: false, engineEnabled: false }, { id: 'B', name: 'B', candidateEnabled: true, engineEnabled: false }],
    artifacts: { ideaBrief: null, perToolReport: 'report.html', mainReport: null },
    ...(withPhases ? { phases: [
      { phase: 'P1', sessionId: 's1', transcript: 't/p1.jsonl', model: 'opus', smartTrimMode: 'off' },
      { phase: 'P2', sessionId: 's2', transcript: 't/missing.jsonl', model: 'haiku' },
      { phase: 'P4', sessionId: 's4', transcript: p4, model: 'haiku' },
    ] } : {}),
  }));
  return exp;
}

describe('phase_usage', () => {
  it('sums each phase, takes the peak single-turn context, and gives nulls for a missing transcript', () => {
    const exp = fixture();
    const r = node('phase_usage.mjs', exp);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1); // one summary line
    const o = JSON.parse(fs.readFileSync(path.join(exp, 'evidence', 'phase-usage.json'), 'utf8'));
    const [p1, p2, p4] = o.phases;
    assert.deepEqual([p1.modelTurns, p1.peakContext, p1.input, p1.cacheRead, p1.cacheWrite, p1.output], [2, 1210, 15, 1500, 300, 70]);
    assert.equal(p1.model, 'opus');
    assert.equal(p1.smartTrimMode, 'off');
    assert.equal(p2.measured, false);
    for (const k of ['modelTurns', 'peakContext', 'cacheRead', 'cacheWrite', 'input', 'output']) assert.equal(p2[k], null);
    assert.deepEqual([p4.modelTurns, p4.peakContext, p4.cacheRead], [2, 111, 9100]);
    assert.deepEqual(p4.modelsSeen.sort(), ['claude-haiku-5-5', 'claude-opus-5-5']);
    assert.deepEqual(o.missingPhases, ['P2']);
    assert.deepEqual(o.totals, { modelTurns: 4, peakContext: 1210, cacheRead: 10600, cacheWrite: 1210, input: 18, output: 105, allTokens: 11933 });
  });

  it('no phases: everything null', () => {
    const exp = fixture({ withPhases: false });
    assert.equal(node('phase_usage.mjs', exp).status, 0);
    const o = JSON.parse(fs.readFileSync(path.join(exp, 'evidence', 'phase-usage.json'), 'utf8'));
    assert.equal(o.measuredPhases, 0);
    assert.equal(o.totals.allTokens, null);
  });
});

describe('Workflow cost per phase card', () => {
  it('says not measured without phase-usage.json', () => {
    const exp = fixture();
    const r = node('build_tool_report.mjs', exp);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    const html = fs.readFileSync(path.join(exp, 'report.html'), 'utf8');
    assert.match(html, /Workflow cost per phase<\/span><b class="warn">not measured<\/b>/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(exp, 'summary.json'), 'utf8')).workflowCost, null);
  });

  it('shows the total and each phase with phase-usage.json', () => {
    const exp = fixture();
    node('phase_usage.mjs', exp);
    assert.equal(node('build_tool_report.mjs', exp).status, 0);
    const html = fs.readFileSync(path.join(exp, 'report.html'), 'utf8');
    assert.match(html, /Workflow cost per phase<\/span><b class="warn">12k<\/b>/); // warn: P2 missing
    assert.match(html, /P1 opus 2k · P2 haiku not measured · P4 haiku 10k · peak context 1k/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(exp, 'summary.json'), 'utf8')).workflowCost.allTokens, 11933);
  });
});
