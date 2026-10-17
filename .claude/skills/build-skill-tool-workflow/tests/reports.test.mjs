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
    assert.equal(s.arms.A.tokens, 330); // input 100 + output 10, per case (all cases)
    assert.equal(s.arms.A.pairedTokens, 220); // T1, T2 only
    assert.equal(s.arms.B.tokens, 180);
    assert.equal(s.engine, 'Laya');
    assert.deepEqual(s.regressions, ['T1']);
    assert.deepEqual(s.improvements, ['T2']); // T3 blocked in A: not compared
    assert.deepEqual(s.unpairedCases, ['T3']);
    assert.equal(s.openBlockingFindings, 1);
    const html = fs.readFileSync(path.join(exp, 'report.html'), 'utf8');
    assert.match(html, /plain Claude vs Claude \+ Laya/);
    assert.match(html, /<tr class="worse">/);
    assert.match(html, /-45%/); // paired 220 -> 120 tokens
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

describe('fair comparison', () => {
  it('blocked/skipped or missing in one arm is neither better/worse nor in the token totals', () => {
    const { exp } = fixture();
    // T4 only in A, T5 errors in B
    const addCase = (arm, c) => {
      const f = path.join(exp, 'runs', arm, 'r1', 'results.json');
      const r = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
      r.cases.push(c);
      fs.writeFileSync(f, JSON.stringify(r));
    };
    addCase('A-claude', kase('T4', 'pass', 1000));
    addCase('A-claude', kase('T5', 'pass', 1000));
    addCase('B-claude-laya', kase('T5', 'error', 5));
    assert.equal(node('build_tool_report.mjs', exp).status, 0);
    const s = JSON.parse(fs.readFileSync(path.join(exp, 'summary.json'), 'utf8'));
    assert.deepEqual(s.regressions, ['T1']); // T5 pass -> error is not "worse"
    assert.deepEqual(s.improvements, ['T2']);
    assert.equal(s.pairedCases, 2);
    assert.deepEqual(s.unpairedCases.sort(), ['T3', 'T4', 'T5']);
    assert.equal(s.arms.A.pairedTokens, 220);
    assert.equal(s.arms.B.pairedTokens, 120);
    assert.match(fs.readFileSync(path.join(exp, 'report.html'), 'utf8'), /Not compared .*T3/);
  });
});

describe('transcript_usage', () => {
  it('adds subagent transcripts, counts each API message once', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-tr-'));
    const msg = (id, ts, input, tools = 0) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: { input_tokens: input, output_tokens: 1 }, content: Array(tools).fill({ type: 'tool_use' }) } });
    fs.writeFileSync(path.join(d, 's.jsonl'), [msg('m1', '2026-10-16T01:00:00Z', 100, 1), msg('m1', '2026-10-16T01:00:00Z', 100, 1), msg('m2', '2026-10-16T01:00:05Z', 50), 'not json'].join('\n'));
    fs.mkdirSync(path.join(d, 's', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(d, 's', 'subagents', 'agent-x.jsonl'), msg('m3', '2026-10-16T01:00:02Z', 1000));
    const run = (...extra) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'transcript_usage.mjs'), path.join(d, 's.jsonl'), ...extra], { encoding: 'utf8' }).stdout);
    const u = run();
    assert.equal(u.inputTokens, 1150);
    assert.equal(u.modelTurns, 3);
    assert.equal(u.subagentTurns, 1);
    assert.equal(u.toolCalls, 2);
    assert.equal(u.elapsedMs, 5000);
    assert.equal(run('--no-subagents').inputTokens, 150);
    assert.equal(run('--from', '2026-10-16T01:00:01Z').inputTokens, 1050);
  });
});

describe('count_tokens', () => {
  const fake = (body) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-ct-'));
    const js = path.join(d, 'fake.mjs');
    fs.writeFileSync(js, `let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{${body}});`);
    const win = process.platform === 'win32';
    const exe = path.join(d, win ? 'fake.cmd' : 'fake.sh');
    fs.writeFileSync(exe, win ? `@"${process.execPath}" "${js}"\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${js}"\n`, { mode: 0o755 });
    const txt = path.join(d, 'a.txt');
    fs.writeFileSync(txt, 'x'.repeat(40));
    return (files = [txt]) => spawnSync(process.execPath, [path.join(SCRIPTS, 'count_tokens.mjs'), ...files], { encoding: 'utf8', env: { ...process.env, COUNT_TOKENS_CLAUDE: exe } });
  };
  it('subtracts the baseline', () => {
    const r = fake(`console.log(JSON.stringify({usage:{input_tokens:10+s.length,cache_read_input_tokens:5}}))`)();
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(Object.values(JSON.parse(r.stdout).files), [40]);
  });
  it('a failed call gives null and exit 1, never a crash or a guess', () => {
    const r = fake(`if(!s){console.log(JSON.stringify({usage:{input_tokens:10}}))}else{console.error('rate limited');process.exit(3)}`)();
    assert.equal(r.status, 1);
    const o = JSON.parse(r.stdout);
    assert.deepEqual(Object.values(o.files), [null]);
    assert.match(Object.values(o.errors)[0], /exited 3: rate limited/);
  });
  it('baseline failure stops before counting', () => {
    const r = fake(`console.log('oops')`)();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /baseline call failed.*not JSON/);
  });
});

describe('evidence and final decision', () => {
  it('links evidence/texts/<case>.<arm>.txt by convention and flags a case with one arm missing', () => {
    const { root, exp } = fixture();
    fs.mkdirSync(path.join(exp, 'evidence', 'texts'), { recursive: true });
    for (const f of ['T1.A.txt', 'T1.B.txt', 'T2.B.txt']) fs.writeFileSync(path.join(exp, 'evidence', 'texts', f), 'x');
    assert.equal(node('build_tool_report.mjs', exp).status, 0);
    const s = JSON.parse(fs.readFileSync(path.join(exp, 'summary.json'), 'utf8'));
    assert.deepEqual(s.evidenceGaps, ['T2 (only B)']);
    const html = fs.readFileSync(path.join(exp, 'report.html'), 'utf8');
    assert.match(html, /href="evidence\/texts\/T1\.A\.txt">A text</);
    assert.match(html, /href="evidence\/texts\/T1\.B\.txt">B text</);
    assert.match(html, /saved for one arm only: T2 \(only B\)/);
    node('build_main_report.mjs', root);
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /evidence for one arm only on 1 case/);
  });

  it('a recorded final decision is no longer waiting on the user', () => {
    const { root, exp } = fixture();
    const mf = path.join(exp, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    node('build_tool_report.mjs', exp);
    node('build_main_report.mjs', root);
    assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /final decision not recorded/);
    m.approvals = { finalDecision: 'PILOT', finalDecisionAt: '2026-10-17T00:00:00Z' };
    fs.writeFileSync(mf, JSON.stringify(m));
    node('build_tool_report.mjs', exp);
    node('build_main_report.mjs', root);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /final decision not recorded/);
    assert.doesNotMatch(html, /demo-tool<\/a>: PILOT/);
  });
});

describe('subagent_usage', () => {
  it('finds a case transcript by its work dir; r1 never matches r10; no match is null', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-su-'));
    const work = path.join(d, 'case.A.r1');
    const prompt = (dir) => JSON.stringify({ type: 'user', message: { content: `You are working in the project folder ${dir}\n\nTask: fix it` } });
    const reply = (id, n) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-17T01:00:00Z', message: { id, usage: { input_tokens: n, output_tokens: 1 }, content: [] } });
    fs.writeFileSync(path.join(d, 'agent-1.jsonl'), [prompt(work), reply('m1', 100)].join('\n'));
    fs.writeFileSync(path.join(d, 'agent-2.jsonl'), [prompt(work + '0'), reply('m2', 999)].join('\n'));
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'subagent_usage.mjs'), d, work, path.join(d, 'missing')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.equal(o[work].usage.inputTokens, 100);
    assert.match(o[work].transcript, /agent-1\.jsonl$/);
    assert.equal(o[path.join(d, 'missing')].transcript, null);
  });
});

describe('subagent_usage --forbid', () => {
  it('counts the agent\'s own calls to the tool (Skill calls too), not the prompt, and not the hand-back', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bstw-fb-'));
    const work = path.join(d, 'case.A');
    const user = (dir) => JSON.stringify({ type: 'user', message: { content: `Work folder: ${dir}\nUse the planner if you like, it is called story-batch-planner.` } });
    const call = (id, name, input) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-17T01:00:00Z', message: { id, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', name, input }] } });
    // agent 1 reads the batch only; agent 2 calls the skill and runs the script; both then hand back an answer that names the tool
    fs.writeFileSync(path.join(d, 'agent-1.jsonl'), [user(work), call('m1', 'Read', { file_path: 'batch.json' }), call('m2', 'SubagentHandback', { message: 'story-batch-planner was not used' })].join('\n'));
    const work2 = path.join(d, 'case.A2');
    fs.writeFileSync(path.join(d, 'agent-2.jsonl'), [user(work2), call('n1', 'Skill', { skill: 'story-batch-planner', args: 'x' }), call('n2', 'Bash', { command: 'node scripts/plan.mjs --in batch.json' })].join('\n'));
    const run = (...dirs) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'subagent_usage.mjs'), d, '--forbid', 'story-batch-planner|plan\.mjs', ...dirs], { encoding: 'utf8' }).stdout);
    const o = run(work, work2);
    assert.equal(o[work].forbiddenCalls, 0);
    assert.equal(o[work2].forbiddenCalls, 2);
    // without --forbid the field is absent
    const plain = JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'subagent_usage.mjs'), d, work], { encoding: 'utf8' }).stdout);
    assert.equal('forbiddenCalls' in plain[work], false);
  });
});
