// phase_usage.mjs finds transcripts from a phase's cwd (all files summed) and measures the control
// session's slice of the round (pick "busiest" + from/to window).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'phase_usage.mjs');
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, 'utf8'); };
const turn = (id, ts, read) => JSON.stringify({
  type: 'assistant', timestamp: ts,
  message: { id, model: 'claude-haiku-5-5', usage: { input_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 1 }, content: [] },
});

function setup(phases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-cwd-'));
  const projects = path.join(root, 'projects');
  const phaseCwd = 'D:\\Repo\\.claude\\worktrees\\p2-abc';
  const ctlCwd = 'D:\\Repo';
  const pd = (cwd) => path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  // phase worktree: the phase session + one headless run, both summed
  write(path.join(pd(phaseCwd), 's1.jsonl'), [turn('a', '2026-10-18T10:00:00Z', 100), turn('b', '2026-10-18T10:05:00Z', 300)].join('\n'));
  write(path.join(pd(phaseCwd), 's2.jsonl'), turn('c', '2026-10-18T10:06:00Z', 50));
  // control folder: a busy control session (3 turns in the window, 1 before it) and another session (1 turn in the window)
  write(path.join(pd(ctlCwd), 'ctl.jsonl'), [turn('x0', '2026-10-18T08:00:00Z', 9999), turn('x1', '2026-10-18T10:00:00Z', 1000), turn('x2', '2026-10-18T10:30:00Z', 2000), turn('x3', '2026-10-18T11:00:00Z', 3000)].join('\n'));
  write(path.join(pd(ctlCwd), 'other.jsonl'), turn('y1', '2026-10-18T10:10:00Z', 7777));
  // pinned to the real Claude Code folder name: every non-alphanumeric character becomes '-'
  assert.equal(path.basename(pd(phaseCwd)), 'D--Repo--claude-worktrees-p2-abc');
  const exp = path.join(root, 'exp');
  write(path.join(exp, 'manifest.json'), JSON.stringify({ experimentId: 'e', phases: phases({ phaseCwd, ctlCwd }) }));
  const r = spawnSync(process.execPath, [SCRIPT, exp], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECTS_DIR: projects } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(fs.readFileSync(path.join(exp, 'evidence', 'phase-usage.json'), 'utf8'));
}

describe('phase_usage cwd and control rows', () => {
  it('sums every transcript in a phase cwd, and measures only the busiest control session inside the window', () => {
    const o = setup(({ phaseCwd, ctlCwd }) => [
      { phase: 'P2', cwd: phaseCwd, model: 'haiku' },
      { phase: 'Control', cwd: ctlCwd, pick: 'busiest', from: '2026-10-18T09:00:00Z', to: '2026-10-18T12:00:00Z', model: 'opus' },
    ]);
    const [p2, ctl] = o.phases;
    assert.deepEqual([p2.measured, p2.files, p2.modelTurns, p2.cacheRead, p2.peakContext], [true, 2, 3, 450, 301]);
    assert.deepEqual([ctl.measured, ctl.files, ctl.modelTurns, ctl.cacheRead, ctl.peakContext], [true, 1, 3, 6000, 3001]);
    assert.equal(o.totals.cacheRead, 6450);
  });

  it('an unknown cwd or an empty window gives nulls, never an estimate', () => {
    const o = setup(({ ctlCwd }) => [
      { phase: 'P3', cwd: 'D:\\Nowhere', model: 'haiku' },
      { phase: 'Control', cwd: ctlCwd, pick: 'busiest', from: '2027-01-01T00:00:00Z', model: 'opus' },
    ]);
    assert.deepEqual(o.phases.map((p) => [p.measured, p.cacheRead]), [[false, null], [false, null]]);
    assert.deepEqual(o.missingPhases, ['P3', 'Control']);
  });
});
