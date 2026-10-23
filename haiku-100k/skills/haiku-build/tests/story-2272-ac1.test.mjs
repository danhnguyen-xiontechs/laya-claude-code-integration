// Story 2272 AC1: the plan maps every AC to a target and a verify; the report shows each AC with its status,
// and an unmapped AC is named, warned and never counted as passing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAcs, acMap, acEvidence } from '../scripts/ac_map.mjs';
import { savePlanSpec, renderHtml, measure } from '../scripts/build_report.mjs';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const spec = (acs) => [
  '# Spec: fixture', '', '## 1. Goal & Intent', 'Add a flag.', '',
  '## 6. Tasks & Acceptance Criteria', '- `src/a.mjs` add the flag', '', ...acs, '',
  '## 7. Red Checks', 'red: test "flag" fails before', '', '## 8. Verification', '`node --test test/a.test.mjs`', '',
].join('\n');
const MAPPED = [
  '- AC1: `--flag` sets the flag — target: `src/a.mjs`; verify: `node --test test/a.test.mjs`',
  '- AC2: no flag keeps the default — target: `src/a.mjs`; verify: `node --test test/b.test.mjs`',
];
const UNMAPPED = [...MAPPED, '- AC3: help text lists the flag'];

function runDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-build-2272-ac1-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, runId: 'ac1', tool: 'haiku-build', status: 'INTAKE', task: 't', opusCalls: [], phases: [], haiku: {} }));
  return dir;
}
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('2272 AC1 plan: savePlanSpec records manifest.acMap with target and verify for each AC', () => {
  const dir = runDir();
  const r = savePlanSpec(dir, spec(MAPPED));
  assert.equal(r.ok, true);
  assert.equal(r.warnings, undefined);
  const m = manifest(dir);
  assert.equal(m.acMap.ok, true);
  assert.deepEqual(m.acMap.unmapped, []);
  assert.deepEqual(m.acMap.acs[0], { id: 'AC1', text: '`--flag` sets the flag', target: 'src/a.mjs', verify: 'node --test test/a.test.mjs', missing: [] });
  assert.equal(m.acMap.acs[1].verify, 'node --test test/b.test.mjs');
  assert.equal(m.warnings, undefined);
});

test('2272 AC1 plan: an unmapped AC is named with an ac-unmapped warning and the plan is still saved', () => {
  const dir = runDir();
  const r = savePlanSpec(dir, spec(UNMAPPED));
  assert.equal(r.ok, true);
  assert.deepEqual(r.unmapped, ['AC3']);
  assert.match(r.warnings[0], /^ac-unmapped \(AC3\)$/);
  const m = manifest(dir);
  assert.equal(m.status, 'PLANNED');
  assert.ok(fs.existsSync(path.join(dir, 'spec.md')));
  assert.deepEqual(m.warnings, ['ac-unmapped']);
  assert.deepEqual(m.acMap.acs[2].missing, ['target', 'verify']);
  assert.equal(m.acMap.ok, false);
  assert.match(m.acMap.reason, /unmapped: AC3/);
});

test('2272 AC1 plan: a failed plan check records no acMap (gate unchanged)', () => {
  const dir = runDir();
  const r = savePlanSpec(dir, 'no headings - AC1: x');
  assert.equal(r.ok, false);
  assert.equal(manifest(dir).acMap, undefined);
});

test('2272 AC1 plan: parser reads a one-paragraph story, legacy "checked by", and the first occurrence of an id', () => {
  const para = 'AC1 — export parse target: `src/p.mjs`; verify: `node --test t/p.test.mjs` AC2 — reject empty input target: src/p.mjs; verify: node --test t/q.test.mjs';
  const acs = parseAcs(para);
  assert.deepEqual(acs.map((a) => [a.id, a.target, a.verify]), [['AC1', 'src/p.mjs', 'node --test t/p.test.mjs'], ['AC2', 'src/p.mjs', 'node --test t/q.test.mjs']]);
  assert.equal(acs[0].text, 'export parse');
  const legacy = parseAcs('## 6. Tasks & Acceptance Criteria\n- AC1: `parseList("a,,b")` returns `["a","b"]`, checked by `test/list.test.mjs` "skips empty items".\n');
  assert.equal(legacy[0].verify, 'test/list.test.mjs');
  assert.deepEqual(legacy[0].missing, ['target']);
  const dup = parseAcs('- AC1: first — target: `a`; verify: `b`\n- AC1: second — target: `c`; verify: `d`\n');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].target, 'a');
  // Only the Tasks & Acceptance section is read when present.
  const scoped = parseAcs('## 1. Goal\nAC9: elsewhere\n## 6. Tasks & Acceptance Criteria\n- AC1: x — target: `a`; verify: `b`\n## 7. Red Checks\nAC8: not an ac\n');
  assert.deepEqual(scoped.map((a) => a.id), ['AC1']);
  const none = acMap('## 6. Tasks & Acceptance Criteria\nnothing here\n');
  assert.deepEqual([none.ok, none.reason], [false, 'no acceptance criteria']);
});

test('2272 AC1 report: each AC shows target, verify and status', () => {
  const map = acMap(spec(MAPPED));
  const rows = acEvidence(map, { tests: { passed: 3, failed: 0 } });
  assert.deepEqual(rows.map((r) => [r.id, r.target, r.verify, r.status]), [
    ['AC1', 'src/a.mjs', 'node --test test/a.test.mjs', 'pass'],
    ['AC2', 'src/a.mjs', 'node --test test/b.test.mjs', 'pass'],
  ]);
  assert.deepEqual(acEvidence(map, { tests: { passed: 2, failed: 1 } }).map((r) => r.status), ['fail', 'fail']);
  assert.deepEqual(acEvidence(map, {}).map((r) => r.status), ['not_run', 'not_run']);
  assert.deepEqual(acEvidence(map, { tests: { passed: 3, failed: 0 }, results: { AC2: 'fail' } }).map((r) => r.status), ['pass', 'fail']);
  const html = renderHtml(measure({ runId: 'r', acMap: map, tests: { passed: 3, failed: 0 }, decision: 're_verify_only' }, { haiku: {} }), null);
  assert.match(html, /<h2>Acceptance criteria<\/h2>/);
  assert.match(html, /<td>AC1<\/td><td>`--flag` sets the flag<\/td><td>src\/a\.mjs<\/td><td>node --test test\/a\.test\.mjs<\/td><td>pass<\/td>/);
});

test('2272 AC1 report: an unmapped AC shows unmapped, never pass, even with passing tests or a pass result', () => {
  const map = acMap(spec(UNMAPPED));
  const rows = acEvidence(map, { tests: { passed: 9, failed: 0 }, results: { AC3: 'pass' } });
  assert.equal(rows[2].status, 'unmapped');
  assert.notEqual(rows[2].status, 'pass');
  const html = renderHtml({ runId: 'r', acMap: map, tests: { passed: 9, failed: 0 } }, null);
  assert.match(html, /<td>AC3<\/td><td>help text lists the flag<\/td><td>missing<\/td><td>missing<\/td><td>unmapped<\/td>/);
  assert.match(html, /Unmapped \(no target or verify; never counted as passing\): AC3/);
  assert.match(renderHtml({ runId: 'r' }, null), /No AC map recorded/);
});

test('2272 AC1 report: ac_map.mjs CLI prints the map and evidence, exit 1 when an AC is unmapped', () => {
  const dir = runDir();
  savePlanSpec(dir, spec(UNMAPPED));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'ac_map.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout.trim());
  assert.deepEqual(out.unmapped, ['AC3']);
  assert.equal(out.evidence[2].status, 'unmapped');
  const ok = runDir();
  savePlanSpec(ok, spec(MAPPED));
  assert.equal(spawnSync(process.execPath, [path.join(SCRIPTS, 'ac_map.mjs'), path.join(ok, 'spec.md')], { encoding: 'utf8' }).status, 0);
});
