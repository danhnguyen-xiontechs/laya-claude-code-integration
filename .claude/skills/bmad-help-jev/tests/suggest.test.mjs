// Run: node --test .claude/skills/bmad-help-jev/tests/suggest.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { decide, pYes, resolveProvider } from '../scripts/decision-provider.mjs';
import { listArtifacts, loadCatalog, parseCsv, scoreEval, skillExcerpt, suggest } from '../scripts/suggest.mjs';

const KEY = 'sk-or-test-secret-123';
const env = { OPENROUTER_API_KEY: KEY };

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmad-help-jev-'));
  fs.mkdirSync(path.join(root, '_bmad', '_config'), { recursive: true });
  fs.writeFileSync(path.join(root, '_bmad', '_config', 'bmad-help.csv'), [
    'module,skill,display-name,menu-code,description,action,args,phase,preceded-by,followed-by,required,output-location,outputs',
    'BMad Method,_meta,,,,,,,,,false,https://docs.bmad-method.org/,',
    'BMad Method,bmad-prd,PRD,PR,"Write a PRD, with ""quoted"" words.",,,plan,,,true,planning_artifacts,prd.md',
    'BMad Method,bmad-code-review,Code Review,CR,"Review code changes.",,,ship,,,false,,',
    'BMad Method,bmad-code-review,Code Review,CR,"duplicate row",,,ship,,,false,,',
  ].join('\n'));
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'bmad-prd'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'bmad-prd', 'SKILL.md'), '---\nname: bmad-prd\n---\n# PRD\nWrites the product requirements document.');
  fs.mkdirSync(path.join(root, '_bmad-output', 'planning-artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '_bmad-output', 'planning-artifacts', 'brief.md'), 'x');
  return root;
}

/** Fake Jev: answers the wide request and the rerank request; records bodies. */
function fakeJev({ gate = [0.9, 0.8, 0.1], fit = 0.85, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (status !== 200) return { ok: false, status, json: async () => ({ error: { code: 'x', message: 'nope' } }) };
    const answers = {};
    if (body.questions.which) {
      answers.which = { type: 'choice', probabilities: { 'bmad-prd': 0.7, 'bmad-code-review': 0.2, none: 0.1 } };
      answers.gate_workflow = { type: 'noul', noul: gate[0] };
      answers.gate_artifact = { type: 'noul', noul: gate[1] };
      answers.gate_prose = { type: 'noul', noul: gate[2] };
    } else {
      answers.best = { type: 'choice', probabilities: { 'bmad-prd': 0.8, 'bmad-code-review': 0.2 } };
      answers.fit_0 = { type: 'noul', noul: fit };
      answers.fit_1 = { type: 'noul', noul: 0.1 };
    }
    return { ok: true, status: 200, json: async () => ({ model: 'typesafe/jev-1.13-x', answers, usage: { input_tokens: 10, output_tokens: 0, cost: 0.00001 } }) };
  };
  return { calls, fetchImpl };
}

describe('catalog', () => {
  it('parses quoted CSV, drops _meta and duplicate rows', () => {
    const rows = parseCsv('a,b\n"x, ""y""",2\n');
    assert.deepEqual(rows, [{ a: 'x, "y"', b: '2' }]);
    const { entries } = loadCatalog(project());
    assert.deepEqual(entries.map((e) => e.key), ['bmad-prd', 'bmad-code-review']);
    assert.equal(entries[0].description, 'Write a PRD, with "quoted" words.');
  });
  it('reads rows under a stale older header positionally', () => {
    const root = project();
    fs.writeFileSync(path.join(root, '_bmad', '_config', 'bmad-help.csv'), [
      'module,phase,name,code,sequence,workflow-file,command,required,agent-name,agent-command,agent-display-name,agent-title,options,description,output-location,outputs',
      'BMad Builder,bmad-agent-builder,Build an Agent,BA,"Create, edit, convert, or fix an agent skill.",build-process,[-H],anytime,,,,,x,false,output_folder,agent skill',
    ].join('\n'));
    const { entries } = loadCatalog(root);
    assert.deepEqual(entries.map((e) => [e.key, e.name, e.code, e.phase]), [['bmad-agent-builder:build-process', 'Build an Agent', 'BA', 'anytime']]);
    assert.equal(entries[0].description, 'Create, edit, convert, or fix an agent skill.');
  });
  it('reads SKILL.md excerpt without frontmatter and lists artifact names', () => {
    const root = project();
    assert.match(skillExcerpt(root, 'bmad-prd'), /^# PRD Writes/);
    assert.equal(skillExcerpt(root, 'missing'), '');
    assert.deepEqual(listArtifacts(root), ['_bmad-output/planning-artifacts/brief.md']);
  });
});

describe('suggest', () => {
  it('two requests; suggests the reranked skill when gate and fit pass', async () => {
    const f = fakeJev();
    const r = await suggest({ root: project(), query: 'write the PRD', provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(f.calls.length, 2);
    assert.equal(r.suggestion.skill, 'bmad-prd');
    assert.equal(r.gate, Number(((0.9 + 0.8 + 0.9) / 3).toFixed(4)));
    assert.ok(f.calls[0].body.questions.which.criteria.none, 'no-match option present');
    assert.equal(f.calls[1].body.state.candidates.length, 2);
    assert.ok(!JSON.stringify(r).includes(KEY), 'key never in the result');
  });
  it('low gate → no rerank, no suggestion', async () => {
    const f = fakeJev({ gate: [0.1, 0.1, 0.9] });
    const r = await suggest({ root: project(), query: 'what is BMad?', provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(f.calls.length, 1);
    assert.equal(r.suggestion, null);
  });
  it('low fit → no suggestion', async () => {
    const f = fakeJev({ fit: 0.1 });
    const r = await suggest({ root: project(), query: 'x', provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(r.suggestion, null);
    assert.equal(r.fit, 0.1);
  });
  it('provider error → suggestion null with error, never throws', async () => {
    const f = fakeJev({ status: 401 });
    const r = await suggest({ root: project(), query: 'x', provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(r.suggestion, null);
    assert.match(r.error, /http 401/);
    const noKey = await suggest({ root: project(), query: 'x', provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env: {} });
    assert.match(noKey.error, /OPENROUTER_API_KEY/);
  });
});

describe('provider + eval', () => {
  it('resolves provider and reads noul in both shapes', async () => {
    assert.equal(resolveProvider({ env: {}, cfg: {} }), 'jev');
    assert.equal(resolveProvider({ flag: 'KEV', env: {} }), 'kev');
    assert.throws(() => resolveProvider({ flag: 'gpt' }));
    assert.equal(pYes({ noul: 0.3 }), 0.3);
    assert.equal(pYes({ probabilities: { yes: 0.6, no: 0.4 } }), 0.6);
    const seen = [];
    await decide({ provider: 'kev', state: 's', questions: {}, cfg: { kev: { url: 'http://k:9/' } }, fetchImpl: async (u) => { seen.push(u); return { ok: true, status: 200, json: async () => ({ answers: {} }) }; } });
    assert.deepEqual(seen, ['http://k:9/v1/systemone']);
  });
  it('scores wrong / needless / missed', () => {
    const s = scoreEval([
      { expected: 'bmad-prd', got: 'bmad-prd' },
      { expected: 'bmad-prd', got: 'bmad-spec' },
      { expected: 'bmad-prd', got: null },
      { expected: null, got: 'bmad-prd' },
      { expected: null, got: null },
    ]);
    assert.deepEqual([s.correct, s.wrong, s.missed, s.needless, s.correctNone], [1, 1, 1, 1, 1]);
  });
});
