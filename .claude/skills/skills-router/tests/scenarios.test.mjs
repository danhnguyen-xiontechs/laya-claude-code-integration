// Run: node --test .claude/skills/skills-router/tests/scenarios.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { acceptsNone, confusion, covered, labelsOf, loadScenarios, matches, metrics, scenarioCatalog } from '../scripts/eval.mjs';
import { promptOf, replay } from '../scripts/shadow-replay.mjs';
import { fixture } from './helpers.mjs';

const EVAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
const bm25 = (ids) => ({ mode: 'bm25', shortlist: ids.map((id, i) => ({ id, score: 10 - i, mentioned: false })) });
const row = (expected, ids, extra = {}) => ({ expected, covered: true, category: 'c', raw: bm25(ids), ...extra });

describe('expected notation', () => {
  it('accepts null, "none", an id, or a list that may include "none"', () => {
    assert.deepEqual(labelsOf(null), []);
    assert.deepEqual(labelsOf('none'), []);
    assert.deepEqual(labelsOf('a'), ['a']);
    assert.deepEqual(labelsOf(['a', 'none', 'b']), ['a', 'b']);
    assert.equal(acceptsNone('none'), true);
    assert.equal(acceptsNone(['a', 'none']), true);
    assert.equal(acceptsNone(['a', 'b']), false);
    assert.ok(matches('x:b', ['a', 'b']));
    assert.ok(!matches('c', ['a', 'b']));
    assert.ok(!matches(null, 'a'));
    assert.ok(covered('none', []));
    assert.ok(covered(['zz', 'a'], [{ id: 'a' }]));
  });

  it('scores list answers, allowed abstentions and per-category accuracy', () => {
    const rows = [
      row(['a', 'b'], ['b']), // right (second valid answer)
      row(['a', 'none'], [], { raw: bm25([]) }), // abstain allowed → right
      row(['a'], [], { raw: bm25([]), category: 'd' }), // missed
      row('none', ['x'], { category: 'd' }), // needless
      row('none', [], { raw: bm25([]), category: 'd' }), // right abstain
    ];
    const m = metrics(rows, { bm25Min: 0 });
    assert.equal(m.skill, 3);
    assert.equal(m.missed, 1);
    assert.equal(m.wrong, 0);
    assert.equal(m.needless, 1);
    assert.equal(m.abstainPrecision, 0.667);
    assert.deepEqual(m.byCategory, { c: { n: 2, accuracy: 1 }, d: { n: 3, accuracy: 0.333 } });
  });

  it('lists the wrong answers of a category', () => {
    const rows = [row('a', ['b'], { id: 'S1', query: 'q1', category: 'overlap' }), row('a', ['a'], { id: 'S2', query: 'q2', category: 'overlap' }), row('a', ['b'], { id: 'S3', query: 'q3' })];
    assert.deepEqual(confusion(rows, { bm25Min: 0 }, 'overlap').map((c) => [c.id, c.got]), [['S1', 'b']]);
  });
});

describe('scenario files', () => {
  it('the shipped scenario file matches its manifest and is well formed', () => {
    const s = loadScenarios(path.join(EVAL, 'scenarios.jsonl'));
    const m = JSON.parse(fs.readFileSync(path.join(EVAL, 'scenarios.manifest.json'), 'utf8'));
    assert.equal(s.length, m.n);
    assert.ok(s.every((x) => x.id && x.prompt && x.category && ['en', 'vi'].includes(x.lang) && ['dev', 'test'].includes(x.split) && x.expected));
    assert.equal(new Set(s.map((x) => x.id)).size, s.length);
    for (const [cat, n] of Object.entries(m.byCategory)) assert.ok(n >= 15, `${cat} has ${n}`);
    for (const x of s.filter((y) => Array.isArray(y.expected))) assert.ok(x.why, `${x.id} lists several answers and needs a why`);
    const h = (x) => crypto.createHash('sha1').update(`${m.salt}\u0000${x.id}`).digest().readUInt32BE(0) / 2 ** 32 < 0.5 ? 'dev' : 'test';
    assert.ok(s.every((x) => x.split === h(x)), 'split is the documented hash');
  });

  it('refuses a modified file unless told otherwise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-router-scn-'));
    fs.copyFileSync(path.join(EVAL, 'scenarios.jsonl'), path.join(dir, 'scenarios.jsonl'));
    fs.copyFileSync(path.join(EVAL, 'scenarios.manifest.json'), path.join(dir, 'scenarios.manifest.json'));
    assert.ok(loadScenarios(path.join(dir, 'scenarios.jsonl')).length > 0);
    fs.appendFileSync(path.join(dir, 'scenarios.jsonl'), '{"id":"X","prompt":"p","category":"c","lang":"en","expected":"none","split":"dev"}\n');
    assert.throws(() => loadScenarios(path.join(dir, 'scenarios.jsonl')), /changed since it was frozen/);
    assert.ok(loadScenarios(path.join(dir, 'scenarios.jsonl'), { allowModified: true }).length > 0);
  });

  it('adds the synthetic entries and scrubs customer strings from descriptions', () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.root, '.claude/skills/review-pr/SKILL.md'), '---\nname: review-pr\ndescription: Review PRs of acme-corp/ACME-HR in Azure DevOps.\n---\nBody about acme-corp.');
    const extra = path.join(fx.base, 'extra.json');
    fs.writeFileSync(extra, JSON.stringify({ scrub: [['acme-corp\\/ACME-HR', '<org>/<project>'], ['acme-corp', '<org>']], entries: [{ name: 'bmad-x', description: 'Synthetic.' }, { name: 'pdf-tools', description: 'dup' }] }));
    const home = process.env.HOME, profile = process.env.USERPROFILE;
    process.env.HOME = process.env.USERPROFILE = fx.home; // os.homedir() for the user-skill sources
    try {
      const c = scenarioCatalog(fx.root, extra);
      const by = Object.fromEntries(c.entries.map((e) => [e.id, e]));
      assert.equal(by['review-pr'].description, 'Review PRs of <org>/<project> in Azure DevOps.');
      assert.match(by['review-pr'].head, /<org>/);
      assert.ok(!by['review-pr'].head.includes('acme-corp'));
      assert.equal(by['bmad-x'].synthetic, true);
      assert.equal(by['bmad-x'].invocation, '/bmad-x');
      assert.equal(c.entries.filter((e) => e.id === 'pdf-tools').length, 1, 'existing ids are not duplicated');
    } finally { process.env.HOME = home; process.env.USERPROFILE = profile; }
  });
});

describe('shadow replay', () => {
  it('rebuilds typed slash commands as the hook would have seen them', () => {
    assert.equal(promptOf({ via: 'slash', expected: 'web-test', query: 'verify story' }), '/web-test verify story');
    assert.equal(promptOf({ via: 'prompt', expected: null, query: 'hello there' }), 'hello there');
  });

  it('runs every case through the hook and joins with the transcripts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-router-replay-'));
    fs.mkdirSync(path.join(dir, 'p'));
    const lines = [
      { type: 'user', sessionId: 's9', turnOrigin: 'human', message: { content: 'merge these pdf files' } },
      { type: 'assistant', sessionId: 's9', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'pdf-tools' } }] } },
      { type: 'user', sessionId: 's9', message: { content: '<command-name>/deploy-app</command-name>\n<command-args>to staging please</command-args>' } },
    ];
    fs.writeFileSync(path.join(dir, 'p', 's9.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
    const fx = fixture();
    const { loadCatalog } = await import('../scripts/catalog.mjs');
    const catalog = loadCatalog({ root: fx.root, home: fx.home, useCache: false, builtinFiles: fx.builtinFiles });
    const cases = [
      { session: 's9', cwd: fx.root, query: 'merge these pdf files', expected: 'pdf-tools', via: 'skill-tool' },
      { session: 's9', cwd: fx.root, query: 'to staging please', expected: 'deploy-app', via: 'slash' },
    ];
    const r = await replay({ cases, provider: 'none', logFile: path.join(dir, 'replay.jsonl'), env: {}, catalog, projectsDir: dir });
    assert.equal(r.replayed, 2);
    assert.equal(r.labelled, 2);
    assert.equal(r.unmatched, 0);
    assert.equal(r.typed, 1);
    assert.equal(r.agreement, 1);
  });
});
