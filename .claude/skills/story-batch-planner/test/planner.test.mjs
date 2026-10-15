import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, extract, findCycles, jevShadow, interpretJev, buildJevRequest, loadConfig, summary, JEV_LABELS } from '../scripts/planner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', n), 'utf8'));
const cfg = (o = {}) => loadConfig({ overrides: { ...o, jev: { enabled: false, log: null, ...(o.jev || {}) } } });
const waveOf = (p, id) => p.stories.find((s) => s.id === id).wave;
const edge = (p, a, b) => p.edges.find((e) => (e.pair && e.pair.includes(a) && e.pair.includes(b)) || (e.from === a && e.to === b) || (e.from === b && e.to === a));

test('extract: files, modules, endpoints/DTO roles, tables, fixtures, refs', () => {
  const r = extract({ id: 'X', title: 'API', description: 'Add endpoint GET /api/leave/balance returning LeaveBalanceDto. Update tests/fixtures/a.json. Add column x to the employees table. Depends on S-9.' });
  assert.equal(r.contract.get('/api/leave/balance'), 'producer');
  assert.equal(r.contract.get('LeaveBalanceDto'), 'producer');
  assert.ok(r.fixture.has('tests/fixtures/a.json'));
  assert.ok(r.module.has('tests/fixtures'));
  assert.ok(r.table.has('employees') && r.migration);
  assert.ok(r.textRefs.has('S-9'));
  assert.equal(extract({ id: 'Y', title: 'Fixes', description: 'Misc.' }).incomplete, true);
});

test('independent stories share one wave', () => {
  const p = plan(fx('01-independent.json'), cfg());
  assert.deepEqual(p.waves.map((w) => w.stories), [['S-1', 'S-2', 'S-3']]);
  assert.equal(p.independent_pairs, 3);
});

test('shared file → serialized; same module only → unknown + review', () => {
  const p = plan(fx('02-shared-module.json'), cfg());
  assert.equal(edge(p, 'S-1', 'S-2').relation, 'shared_resource');
  assert.notEqual(waveOf(p, 'S-1'), waveOf(p, 'S-2'));
  const u = edge(p, 'S-1', 'S-3');
  assert.equal(u.relation, 'unknown'); assert.ok(u.needs_review && u.ambiguous);
  assert.ok(p.blocked_or_review_required.some((r) => r.kind === 'pair'));
});

test('API producer before consumer; two producers of a DTO conflict', () => {
  const p = plan(fx('03-api-dto.json'), cfg());
  const d = p.edges.find((e) => e.relation === 'depends_on');
  assert.deepEqual([d.from, d.to, d.source], ['S-2', 'S-1', 'contract_role']);
  assert.ok(waveOf(p, 'S-1') < waveOf(p, 'S-2'));
  assert.equal(edge(p, 'S-1', 'S-3').relation, 'shared_resource');
});

test('migrations are protected and serialized; schema reader waits for the migration', () => {
  const p = plan(fx('04-migration.json'), cfg());
  const m = edge(p, 'S-1', 'S-2');
  assert.ok(m.protected && m.handling === 'serialize_protected');
  assert.notEqual(waveOf(p, 'S-1'), waveOf(p, 'S-2'));
  assert.notEqual(waveOf(p, 'S-1'), waveOf(p, 'S-3'));
});

test('shared test fixture → serialized', () => {
  const p = plan(fx('05-fixture.json'), cfg());
  assert.match(edge(p, 'S-1', 'S-2').evidence.join(), /fixture/);
  assert.notEqual(waveOf(p, 'S-1'), waveOf(p, 'S-2'));
});

test('explicit ADO link and text reference are kept; out-of-batch link becomes an assumption', () => {
  const p = plan(fx('06-explicit.json'), cfg());
  assert.equal(edge(p, 'S-2', 'S-1').source, 'explicit_link');
  assert.equal(edge(p, 'S-3', 'S-1').source, 'text_reference');
  assert.ok(waveOf(p, 'S-1') < waveOf(p, 'S-2') && waveOf(p, 'S-1') < waveOf(p, 'S-3'));
  assert.ok(p.assumptions.some((a) => a.includes('OPS-99')));
});

test('cycle is reported, its members and dependents are not scheduled', () => {
  const p = plan(fx('07-cycle.json'), cfg());
  const c = p.blocked_or_review_required.find((r) => r.kind === 'cycle');
  assert.deepEqual([...c.stories].sort(), ['S-1', 'S-2', 'S-3']);
  assert.ok(p.blocked_or_review_required.some((r) => r.kind === 'blocked' && r.stories[0] === 'S-4'));
  assert.deepEqual(p.waves.map((w) => w.stories), [['S-5']]);
  assert.deepEqual(findCycles(['a', 'b'], new Map([['a', new Set(['b'])], ['b', new Set()]])), []);
});

test('incomplete story goes to review and runs alone at the end', () => {
  const p = plan(fx('08-incomplete.json'), cfg());
  assert.ok(p.blocked_or_review_required.some((r) => r.kind === 'incomplete' && r.stories[0] === 'S-2'));
  assert.deepEqual(p.waves.at(-1).stories, ['S-2']);
  assert.notEqual(waveOf(p, 'S-1'), waveOf(p, 'S-3')); // hidden dependency: serialized as unknown
});

test('maxConcurrency splits a wide wave', () => {
  const p = plan(fx('01-independent.json'), cfg({ maxConcurrency: 2 }));
  assert.deepEqual(p.waves.map((w) => w.stories.length), [2, 1]);
});

test('output contract: every story has a wave or a review entry; dispatch matches waves', () => {
  for (const f of fs.readdirSync(path.join(here, '..', 'fixtures'))) {
    const p = plan(fx(f), cfg());
    for (const k of ['stories', 'edges', 'waves', 'blocked_or_review_required', 'assumptions', 'dispatch']) assert.ok(k in p, `${f} ${k}`);
    for (const s of p.stories) assert.ok(s.wave != null || p.blocked_or_review_required.some((r) => r.stories.includes(s.id)), `${f} ${s.id}`);
    assert.equal(p.dispatch.length, p.waves.flatMap((w) => w.stories).length);
    for (const e of p.edges) assert.ok(['depends_on', 'shared_resource', 'likely_independent', 'unknown'].includes(e.relation));
    assert.ok(summary(p).startsWith('# Story batch plan'));
  }
});

// ---- Jev shadow (fake provider, no network) ----
const fake = (label) => async () => ({ ok: true, answers: { relation: { probabilities: { [label]: 0.9, unknown: 0.1 } } }, meta: { latencyMs: 4, cost: 0.0001, model: 'fake' } });

test('Jev request uses the closed label set', () => {
  const b = fx('02-shared-module.json');
  const { questions } = buildJevRequest(b.stories[0], b.stories[2], { evidence: ['same module'] });
  assert.deepEqual(Object.keys(questions.relation.criteria), JEV_LABELS);
});

test('Jev shadow annotates only ambiguous edges and never changes waves', async () => {
  const b = fx('02-shared-module.json');
  const c = cfg({ jev: { enabled: true } });
  const before = plan(b, c);
  const after = await jevShadow(b, plan(b, c), c, { decideImpl: fake('independent') });
  assert.deepEqual(after.waves, before.waves);
  const ann = after.edges.filter((e) => e.jev_suggestion);
  assert.equal(ann.length, after.edges.filter((e) => e.ambiguous).length);
  assert.ok(ann.every((e) => e.jev_suggestion.applied === false && e.jev_suggestion.handling === 'would_parallelize_if_promoted'));
  assert.equal(after.jev_shadow.calls, ann.length);
});

test('Jev failure / invalid label / timeout / budget → unknown, serialize_and_review', async () => {
  assert.equal(interpretJev({ ok: false, error: 'timeout' }, {}).handling, 'serialize_and_review');
  assert.equal(interpretJev({ ok: true, answers: { relation: { probabilities: { banana: 1 } } } }, {}).label, 'unknown');
  assert.equal(interpretJev({ ok: true, answers: { relation: { probabilities: { independent: 0.99 } } } }, { protected: true }).handling, 'serialize_protected');
  const b = fx('08-incomplete.json');
  const c = cfg({ jev: { enabled: true, maxCalls: 1 } });
  const p = await jevShadow(b, plan(b, c), c, { decideImpl: async () => ({ ok: false, error: 'http 500', meta: {} }) });
  assert.equal(p.jev_shadow.calls, 1);
  assert.ok(p.jev_shadow.skipped >= 1);
  assert.ok(p.edges.filter((e) => e.jev_suggestion).every((e) => e.jev_suggestion.label === 'unknown'));
});
