// Run: node --test .claude/skills/bmad-code-review-jev/tests/rules.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { build } from '../scripts/rules-build.mjs';
import { globToRegExp, matchesAny, parseDiff, parsePersistentFacts, parseRuleLines, pickLine, ruleId } from '../scripts/rules-lib.mjs';
import { runLayer, toMarkdown } from '../scripts/rules-layer.mjs';
import { parseSet, summarize } from '../scripts/verdicts.mjs';

const env = { OPENROUTER_API_KEY: 'sk-or-test-secret-123' };

const CONTEXT = `---
project_name: x
---
# Project Context

## Tech
| Layer | Tech |
| --- | --- |
| UI | React |

## Framework Rules

- Use \`isFetching\` for modal skeletons — NOT \`isLoading\` (first fetch only)
- No \`style={{}}\` inline — SCSS classes only
- Open UI first, fetch second
  - never block modal open on fetch completion

\`\`\`ts
- this bullet is inside a code fence
\`\`\`
❌ \`<InlineNotification>\` directly in pages
- short
`;

const DIFF = `diff --git a/src/pages/leave/LeaveEditModal.tsx b/src/pages/leave/LeaveEditModal.tsx
--- /dev/null
+++ b/src/pages/leave/LeaveEditModal.tsx
@@ -0,0 +1,4 @@
+export const LeaveEditModal = () => {
+  const { data, isLoading } = useQuery(q);
+  return isLoading ? <TextInputSkeleton /> : <Form data={data} />;
+};
diff --git a/src/utils/date.ts b/src/utils/date.ts
--- a/src/utils/date.ts
+++ b/src/utils/date.ts
@@ -10,2 +10,3 @@ export const a = 1;
 const keep = 1;
+export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
 const keep2 = 2;
diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-{}
+{"a":1}
diff --git a/src/old.ts b/src/old.ts
--- a/src/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmad-cr-jev-'));
  fs.mkdirSync(path.join(root, '_bmad-output'), { recursive: true });
  fs.writeFileSync(path.join(root, '_bmad-output', 'project-context.md'), CONTEXT);
  fs.mkdirSync(path.join(root, 'src', 'pages', 'leave'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'utils'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pages', 'leave', 'LeaveEditModal.tsx'), '');
  fs.writeFileSync(path.join(root, 'src', 'utils', 'date.ts'), '');
  fs.mkdirSync(path.join(root, '_bmad', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(root, '_bmad', 'custom', 'bmad-code-review.toml'), '[workflow]\npersistent_facts = [\n  "Never throw raw strings in services",\n  "file:{project-root}/docs/*.md",\n]\n');
  return root;
}

describe('parsing', () => {
  it('rule lines: bullets and ❌ kept, tables / fences / short lines dropped, sub-bullets joined', () => {
    const rules = parseRuleLines(CONTEXT, 'pc.md');
    assert.deepEqual(rules.map((r) => r.text), [
      'Use `isFetching` for modal skeletons — NOT `isLoading` (first fetch only)',
      'No `style={{}}` inline — SCSS classes only',
      'Open UI first, fetch second — never block modal open on fetch completion',
      '❌ `<InlineNotification>` directly in pages',
    ]);
    assert.equal(rules[0].heading, 'Project Context > Framework Rules');
    assert.equal(rules[0].id, ruleId(rules[0].text));
    assert.equal(ruleId('A  b'), ruleId('a b'), 'id ignores case and spacing');
  });
  it('persistent_facts: literals only', () => {
    assert.deepEqual(parsePersistentFacts('persistent_facts = ["a rule here", \'file:x.md\']'), ['a rule here']);
  });
  it('globs', () => {
    assert.ok(globToRegExp('src/pages/**').test('src/pages/leave/A.tsx'));
    assert.ok(globToRegExp('**/*.tsx').test('A.tsx'));
    assert.ok(globToRegExp('**/*.tsx').test('src/x/A.tsx'));
    assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
    assert.ok(globToRegExp('**/*.{test,spec}.*').test('src/a.spec.ts'));
    assert.ok(matchesAny('anything/at/all.cs', ['**']));
  });
  it('diff: new-side line numbers, deleted files skipped, big hunks split', () => {
    const h = parseDiff(DIFF);
    assert.deepEqual(h.map((x) => x.file), ['src/pages/leave/LeaveEditModal.tsx', 'src/utils/date.ts', 'package-lock.json']);
    assert.deepEqual(h[0].added.map((a) => a.line), [1, 2, 3, 4]);
    assert.deepEqual(h[1].added.map((a) => a.line), [11]);
    assert.deepEqual(h[1].context, ['const keep = 1;', 'const keep2 = 2;']);
    const big = `+++ b/a.ts\n@@ -0,0 +1,5 @@\n${'+x\n'.repeat(5)}`;
    assert.equal(parseDiff(big, { maxAdded: 2 }).length, 3);
    assert.equal(pickLine(h[0], 'Use `isFetching` … NOT `isLoading`'), 2);
  });
});

/** Fake provider: classifies by keywords, flags isLoading against the isFetching rule. */
function fake() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answers = {};
    for (const [k] of Object.entries(body.questions)) {
      if (k.startsWith('kind_')) {
        const t = body.state.rules[Number(k.slice(5))].text;
        answers[k] = { probabilities: /style|InlineNotification/.test(t) ? { mechanical: 0.8, semantic: 0.1, not_a_rule: 0.1 } : { semantic: 0.85, mechanical: 0.1, not_a_rule: 0.05 } };
      } else if (k.startsWith('scope_')) {
        const t = body.state.rules[Number(k.slice(6))].text;
        answers[k] = { probabilities: /modal|UI first/i.test(t) ? { 'src/pages/**': 0.7, '**': 0.3 } : { '**': 0.9, 'src/pages/**': 0.1 } };
      } else if (k.startsWith('v_')) {
        const rule = body.state.rules[Number(k.slice(2))];
        answers[k] = { noul: /isFetching/.test(rule) && body.state.added_code.includes('isLoading') ? 0.93 : 0.05 };
      }
    }
    return { ok: true, status: 200, json: async () => ({ model: 'typesafe/jev-1.13-x', answers, usage: { input_tokens: 100, output_tokens: 0, cost: 0.00002 } }) };
  };
  return { calls, fetchImpl };
}

describe('build + layer', () => {
  it('builds once, reuses on unchanged sources, keeps classifications on edit', async () => {
    const root = project();
    const f = fake();
    const r1 = await build({ root, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(r1.ok, true);
    assert.equal(r1.rules, 5);
    assert.deepEqual([r1.semantic, r1.mechanical], [3, 2]);
    const gen = JSON.parse(fs.readFileSync(path.join(root, '_bmad', 'custom', 'jev-rules.generated.json'), 'utf8'));
    assert.ok(gen.sources.includes('_bmad/custom/bmad-code-review.toml'));
    assert.deepEqual(gen.rules.find((r) => /isFetching/.test(r.text)).scope, ['src/pages/**']);
    const r2 = await build({ root, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(r2.unchanged, true);
    fs.appendFileSync(path.join(root, '_bmad-output', 'project-context.md'), '\n- Brand new rule about query keys\n');
    const before = f.calls.length;
    const r3 = await build({ root, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.deepEqual([r3.reused, r3.classifiedNow], [5, 1]);
    assert.equal(f.calls.length, before + 1);
  });

  it('layer: pairs only in scope, lockfile ignored, finding assembled by the script', async () => {
    const root = project();
    const f = fake();
    await build({ root, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    fs.writeFileSync(path.join(root, '_bmad', 'custom', 'jev-rules.json'), JSON.stringify({ rules: {}, extra: [{ text: 'Dates are formatted with the shared dayjs helper', scope: ['src/utils/**'] }] }));
    f.calls.length = 0;
    const r = await runLayer({ root, diffText: DIFF, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    assert.equal(r.ok, true);
    assert.equal(r.stats.hunks, 2, 'package-lock.json ignored');
    assert.equal(f.calls.length, 2, 'one request per hunk');
    const modal = f.calls.find((c) => c.state.file.endsWith('LeaveEditModal.tsx'));
    assert.equal(Object.keys(modal.questions).length, 3, 'modal hunk: 2 page rules + 1 any-file rule');
    const util = f.calls.find((c) => c.state.file.endsWith('date.ts'));
    assert.ok(util.state.rules.includes('Dates are formatted with the shared dayjs helper'));
    assert.ok(!util.state.rules.some((t) => /isFetching/.test(t)), 'page-scoped rule not asked for utils');
    assert.equal(r.findings.length, 1);
    assert.deepEqual([r.findings[0].id, r.findings[0].file, r.findings[0].line], ['J1', 'src/pages/leave/LeaveEditModal.tsx', 2]);
    assert.match(toMarkdown(r), /\*\*J1\*\* `src\/pages\/leave\/LeaveEditModal.tsx:2`/);
  });

  it('layer fails cleanly without a rule set or a key', async () => {
    const root = project();
    const r = await runLayer({ root, diffText: DIFF, provider: 'jev', cfg: {}, env });
    assert.match(r.error, /no rule set/);
    const f = fake();
    await build({ root, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env });
    const r2 = await runLayer({ root, diffText: DIFF, provider: 'jev', cfg: {}, fetchImpl: f.fetchImpl, env: {} });
    assert.equal(r2.ok, false);
    assert.match(r2.errors[0], /OPENROUTER_API_KEY/);
  });
});

describe('verdicts', () => {
  it('parses and summarizes precision', () => {
    assert.deepEqual(parseSet('J1=medium, j2=false'), { J1: 'medium', J2: 'false' });
    assert.throws(() => parseSet('J1=critical'));
    const s = summarize([{ provider: 'jev', model: 'm', findings: [{}, {}], stats: { pairsAsked: 10 }, verdicts: { J1: 'medium', J2: 'false' } }]);
    assert.deepEqual([s['jev m'].precision, s['jev m'].falsePerRun], [0.5, 1]);
  });
});
