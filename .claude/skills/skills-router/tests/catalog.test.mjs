// Run: node --test .claude/skills/skills-router/tests/catalog.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { bmadRows, isExplicitOnly, loadCatalog, parseFrontmatter } from '../scripts/catalog.mjs';
import { fixture } from './helpers.mjs';

describe('frontmatter', () => {
  it('reads plain, quoted, multi-line and block scalars, CRLF included', () => {
    assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: plain text: with colon\n---\nbody').data, { name: 'a', description: 'plain text: with colon' });
    assert.equal(parseFrontmatter("---\ndescription: 'it''s quoted'\n---\n").data.description, "it's quoted");
    assert.equal(parseFrontmatter('---\ndescription: "say \\"hi\\""\n---\n').data.description, 'say "hi"');
    assert.equal(parseFrontmatter('---\ndescription: first line,\n  second line\nx: 1\n---\n').data.description, 'first line, second line');
    assert.equal(parseFrontmatter('---\r\ndescription: >-\r\n  folded one\r\n  folded two\r\n---\r\n').data.description, 'folded one folded two');
    assert.equal(parseFrontmatter('---\ndescription: |\n  line one\n  line two\n---\n').data.description, 'line one\nline two');
    assert.equal(parseFrontmatter('---\ndescription:\n  Indented on the next line.\n---\n').data.description, 'Indented on the next line.');
    assert.deepEqual(parseFrontmatter('no frontmatter').data, {});
    assert.equal(parseFrontmatter('---\nname: a\n---\n# Title\nText').body, '# Title\nText');
  });

  it('flags explicit-only descriptions', () => {
    assert.equal(isExplicitOnly('Trigger only on "/x <url>" or an explicit request to A/B.'), true);
    assert.equal(isExplicitOnly('Use only when the user explicitly asks to see their brief.'), true);
    assert.equal(isExplicitOnly('Runs only via /deploy.'), true);
    assert.equal(isExplicitOnly('Anything', { 'disable-model-invocation': 'true' }), true);
    assert.equal(isExplicitOnly('Use this skill only when you have a tool for spawning subagents.'), false);
    assert.equal(isExplicitOnly('Review a pull request.'), false);
  });
});

describe('BMad csv', () => {
  it('parses quoted fields, drops _meta, keeps actions', () => {
    const rows = bmadRows('module,skill,display-name,menu-code,description,action\nM,_meta,,,,\nM,bmad-prd,PRD,PR,"a, ""b""",validate\n');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, 'a, "b"');
    assert.equal(rows[0].action, 'validate');
  });
});

describe('catalog', () => {
  const fx = fixture();
  const cat = loadCatalog({ root: fx.root, home: fx.home, cacheDir: fx.cacheDir, builtinFiles: fx.builtinFiles });
  const by = Object.fromEntries(cat.entries.map((e) => [e.name, e]));

  it('finds every source and normalizes entries', () => {
    assert.deepEqual(cat.counts, { project: 7, user: 3, 'plugin:frontend': 2, bmad: 3, builtin: 1 });
    assert.deepEqual(Object.keys(by).sort(), [
      'bmad-code-review', 'bmad-prd', 'bmad-prd:validate', 'code-review', 'deploy-app', 'frontend:frontend-design', 'git:commit',
      'morning-brief', 'pdf-tools', 'release', 'review-pr', 'review-pr-jev-classify', 'test-runner',
    ]);
    assert.equal(by['deploy-app'].description, "Deploy the app to staging or production; it's the release workflow.");
    assert.equal(by['deploy-app'].source, 'project');
    assert.equal(by['pdf-tools'].description, 'Read, merge and split PDF files, fill PDF forms and extract tables.');
    assert.equal(by['pdf-tools'].head.length, 700);
    assert.equal(by['frontend:frontend-design'].source, 'plugin:frontend');
    assert.equal(by['frontend:frontend-design'].invocation, '/frontend:frontend-design');
    assert.equal(by['frontend:frontend-design'].description, 'Build distinctive, production-grade web UI "without" generic AI looks.');
    assert.equal(by['git:commit'].kind, 'command');
    assert.equal(by['git:commit'].invocation, '/git:commit');
    assert.equal(by.release.description, 'Cut a release: bump version, tag and push');
    assert.equal(by['test-runner'].kind, 'agent');
    assert.equal(by['test-runner'].invocation, 'Agent(subagent_type: "test-runner")');
    assert.equal(by['bmad-prd:validate'].invocation, '/bmad-prd validate');
    assert.equal(by['bmad-prd'].kind, 'bmad');
    assert.equal(by['code-review'].source, 'builtin');
    assert.ok(!by.ignored, 'marketplace checkouts are not installed plugins');
  });

  it('dedupes by name with precedence project > user > plugin > bmad and records shadowed copies', () => {
    assert.equal(by['review-pr'].source, 'project');
    assert.deepEqual(by['review-pr'].shadowed.map((s) => s.source), ['user', 'plugin:frontend']);
    assert.equal(by['bmad-code-review'].kind, 'skill');
    assert.equal(by['bmad-code-review'].bmad.phase, '4-implementation', 'the BMad row lends its phase to the skill');
  });

  it('marks explicit-only skills', () => {
    assert.equal(by['review-pr-jev-classify'].explicitOnly, true);
    assert.equal(by['morning-brief'].explicitOnly, true);
    assert.equal(by['review-pr'].explicitOnly, false);
  });

  it('caches by mtime + size and rebuilds when a file changes', () => {
    const again = loadCatalog({ root: fx.root, home: fx.home, cacheDir: fx.cacheDir, builtinFiles: fx.builtinFiles });
    assert.equal(again.cached, true);
    assert.equal(again.entries.length, cat.entries.length);
    fs.appendFileSync(path.join(fx.root, '.agents/skills/deploy-app/SKILL.md'), '\nmore');
    const changed = loadCatalog({ root: fx.root, home: fx.home, cacheDir: fx.cacheDir, builtinFiles: fx.builtinFiles });
    assert.equal(changed.cached, false);
  });

  it('falls back to a plugin scan without installed_plugins.json, skipping marketplaces', () => {
    fs.rmSync(path.join(fx.home, '.claude/plugins/installed_plugins.json'));
    const c = loadCatalog({ root: fx.root, home: fx.home, useCache: false, builtinFiles: [] });
    const names = c.entries.map((e) => e.name);
    assert.ok(names.includes('frontend:frontend-design'));
    assert.ok(!names.some((n) => n.endsWith(':ignored')));
  });
});
