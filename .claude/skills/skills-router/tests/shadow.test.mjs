// Run: node --test .claude/skills/skills-router/tests/shadow.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../scripts/catalog.mjs';
import { readJsonl } from '../scripts/mine-history.mjs';
import { pickLocalProvider, promptHash, runHook } from '../scripts/shadow-hook.mjs';
import { report, score, turnLabels } from '../scripts/shadow-report.mjs';
import { fakeProvider, fixture } from './helpers.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'shadow-hook.mjs');
const fx = fixture();
const catalog = loadCatalog({ root: fx.root, home: fx.home, useCache: false, builtinFiles: fx.builtinFiles });
const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skills-router-shadow-')), 'shadow.jsonl');
const payload = (prompt, extra = {}) => JSON.stringify({ session_id: 's1', transcript_path: null, cwd: fx.root, prompt, hook_event_name: 'UserPromptSubmit', ...extra });

describe('shadow hook', () => {
  it('logs one line per prompt in the documented format', async () => {
    const logFile = tmpLog();
    const long = `merge these PDF files ${'x'.repeat(400)}`;
    await runHook({ stdin: payload(long), env: {}, logFile, catalog });
    const [e] = readJsonl(logFile);
    assert.deepEqual(Object.keys(e), ['t', 'session', 'transcript', 'cwd', 'hash', 'prompt', 'suggestion', 'confidence', 'abstain', 'reasons', 'alternatives', 'provider', 'latencyMs', 'error']);
    assert.equal(e.session, 's1');
    assert.equal(e.prompt.length, 300);
    assert.equal(e.hash, promptHash(long));
    assert.equal(e.provider, 'none');
    assert.equal(e.suggestion, 'pdf-tools');
    assert.equal(typeof e.latencyMs, 'number');
  });

  it('uses laya only when asked and up; never jev', async () => {
    const up = { fetchImpl: async () => ({ ok: true }) };
    assert.equal(await pickLocalProvider({ env: { SKILLS_ROUTER_SHADOW_PROVIDER: 'laya' }, ...up }), 'laya');
    assert.equal(await pickLocalProvider({ env: { SKILLS_ROUTER_SHADOW_PROVIDER: 'laya' }, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }), 'none');
    assert.equal(await pickLocalProvider({ env: { SKILLS_ROUTER_SHADOW_PROVIDER: 'jev' }, ...up }), 'none');
    assert.equal(await pickLocalProvider({ env: {}, ...up }), 'none');
    const fake = fakeProvider();
    const logFile = tmpLog();
    const fetchImpl = async (url, init) => (String(url).endsWith('/health') ? { ok: true } : fake.fetchImpl(url, init));
    const e = await runHook({ stdin: payload('review this pull request'), env: { SKILLS_ROUTER_SHADOW_PROVIDER: 'laya' }, fetchImpl, logFile, catalog });
    assert.equal(e.provider, 'laya');
    assert.ok(fake.calls.every((c) => !c.url.includes('openrouter')));
  });

  it('never fails: bad stdin, provider errors and an unwritable log return quietly', async () => {
    assert.equal(await runHook({ stdin: 'not json', env: {}, logFile: tmpLog() }), null);
    assert.equal(await runHook({ stdin: payload('   '), env: {}, logFile: tmpLog() }), null);
    const logFile = tmpLog();
    const fetchImpl = async (url) => (String(url).endsWith('/health') ? { ok: true } : Promise.reject(new Error('boom')));
    const e = await runHook({ stdin: payload('review this pull request'), env: { SKILLS_ROUTER_SHADOW_PROVIDER: 'laya' }, fetchImpl, logFile, catalog });
    assert.equal(e.suggestion, null);
    assert.match(e.error, /boom/);
    const dirAsFile = tmpLog();
    fs.mkdirSync(dirAsFile);
    assert.equal(await runHook({ stdin: payload('merge pdf'), env: {}, logFile: dirAsFile, catalog }), null);
  });

  it('as a process: prints nothing and exits 0, even on garbage', () => {
    const env = { ...process.env, SKILLS_ROUTER_SHADOW_LOG: tmpLog(), SKILLS_ROUTER_SHADOW_PROVIDER: 'none' };
    for (const input of [payload('merge two pdf files'), '{{{', '']) {
      const out = execFileSync(process.execPath, [HOOK], { input, env, encoding: 'utf8' });
      assert.equal(out, '');
    }
  });
});

describe('shadow report', () => {
  const rec = (o) => ({ sessionId: 's1', ...o });
  const transcript = [
    rec({ type: 'user', turnOrigin: 'human', message: { content: 'merge these pdf files' } }),
    rec({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'pdf-tools' } }] } }),
    rec({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    rec({ type: 'user', turnOrigin: 'human', message: { content: 'what does this regex do' } }),
    rec({ type: 'user', message: { content: '<command-message>deploy-app</command-message>\n<command-name>/deploy-app</command-name>\n<command-args>staging</command-args>' } }),
    rec({ type: 'user', message: { content: '<command-name>/model</command-name>\n<command-args>opus</command-args>' } }),
    rec({ type: 'user', turnOrigin: 'human', message: { content: 'review the PR' } }),
    rec({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'review-pr' } }] } }),
  ];
  const entry = (prompt, suggestion, abstain = !suggestion) => ({ t: 'x', session: 's1', hash: promptHash(prompt), suggestion, abstain, provider: 'none' });

  it('labels each turn with what Claude invoked', () => {
    assert.deepEqual(turnLabels(transcript).map((l) => [l.via, l.invoked]), [['skill-tool', 'pdf-tools'], ['prompt', null], ['slash', 'deploy-app'], ['skill-tool', 'review-pr']]);
    assert.equal(turnLabels(transcript)[2].hash, promptHash('/deploy-app staging'));
  });

  it('joins on session + prompt hash and scores agreement, wrong, needless, abstain precision', () => {
    const entries = [
      entry('merge these pdf files', 'pdf-tools'), // agree
      entry('what does this regex do', 'deploy-app'), // needless
      entry('/deploy-app staging', 'deploy-app'), // agree (typed)
      entry('review the PR', null), // missed
      entry('never in a transcript', 'x'), // unmatched
    ];
    const s = score(entries, new Map([['s1', turnLabels(transcript)]]));
    assert.equal(s.labelled, 4);
    assert.equal(s.unmatched, 1);
    assert.equal(s.typed, 1);
    assert.equal(s.agreement, 0.5);
    assert.equal(s.needlessRate, 1);
    assert.equal(s.wrongRate, 0);
    assert.equal(s.missRate, 0.333);
    assert.equal(s.abstainPrecision, 0);
  });

  it('reads the log and finds the transcript by session id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-router-rep-'));
    fs.mkdirSync(path.join(dir, 'proj'));
    fs.writeFileSync(path.join(dir, 'proj', 's1.jsonl'), transcript.map((r) => JSON.stringify(r)).join('\n'));
    const logFile = path.join(dir, 'shadow.jsonl');
    fs.writeFileSync(logFile, `${JSON.stringify(entry('merge these pdf files', 'pdf-tools'))}\n`);
    const r = report({ logFile, projectsDir: dir });
    assert.equal(r.labelled, 1);
    assert.equal(r.agreement, 1);
  });
});
