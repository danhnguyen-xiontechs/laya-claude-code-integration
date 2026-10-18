import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ruleFeatures, ruleTier, combine, consistency, orderings, buildRequest, route, loadConfig, maxTier, nextTier, TIERS,
} from '../scripts/router.mjs';
import { handle, definitionModel } from '../scripts/hook-pretooluse.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-test-'));
const cfgOf = (o = {}) => loadConfig({ env: {}, file: path.join(tmp, 'none.json'), overrides: { log: path.join(tmp, 'log.jsonl'), ...o } });

/** Fake provider: answers the tier question with `pick(order, callIndex)`; counts calls. */
function fakeDecide(pick) {
  let n = 0;
  const fn = async ({ questions }) => {
    const order = Object.keys(questions.tier.criteria);
    const label = pick(order, n++);
    const probabilities = Object.fromEntries(order.map((t) => [t, t === label ? 0.97 : 0.015]));
    return { ok: true, answers: { tier: { probabilities }, multi_file_design: { noul: 0.5 }, mechanical: { noul: 0.5 }, costly_failure: { noul: 0.5 } }, meta: { latencyMs: 5 } };
  };
  fn.calls = () => n;
  return fn;
}
const failing = async () => ({ ok: false, error: 'http 500', meta: { latencyMs: 3 } });

test('rule tiers: lookup → haiku, ordinary fix → sonnet, design/migration → opus', () => {
  assert.equal(ruleTier(ruleFeatures('Find every file that imports lodash and list them. Do not edit anything.')).tier, 'haiku');
  assert.equal(ruleTier(ruleFeatures('Implement a retry helper in src/net/retry.ts with exponential backoff.')).tier, 'sonnet');
  assert.equal(ruleTier(ruleFeatures('Design the migration of the billing module to the new event bus and propose trade-offs.')).tier, 'opus');
});

test('rule features: subagent type, files, ACs, checks', () => {
  assert.equal(ruleTier(ruleFeatures('Where is the config loaded?', 'Explore')).tier, 'haiku');
  assert.notEqual(ruleTier(ruleFeatures('Outline the steps.', 'Plan')).tier, 'haiku');
  const f = ruleFeatures('Update a.py, b.py, c.ts and d.cs.\n- AC1 x\n- AC2 y\nRun the tests with pytest.');
  assert.equal(f.files, 4);
  assert.equal(f.acs, 2);
  assert.equal(f.hasCheck, true);
});

test('rule features: test globs are not files, so one file plus a test command is "checked"', () => {
  const p = 'Fix `paginate` in src/paginate.js. Run `node --test` (it finds test/*.test.mjs; also **/*.spec.js). Only change **src/paginate.js**.';
  assert.equal(ruleFeatures(p).files, 1);
  assert.deepEqual(ruleTier(ruleFeatures(p)), { tier: 'haiku', score: 0, why: ['checked'] });
  assert.equal(ruleFeatures('Run node --test "test/*.test.mjs" and *.test.mjs and test/**/*.mjs').files, 0);
});

test('rule features: markdown bold/italic file names are files, not globs', () => {
  assert.equal(ruleFeatures('Change **paginate.js**.').files, 1);
  assert.equal(ruleFeatures('Change *cursor.js* only.').files, 1);
  assert.equal(ruleFeatures('Edit *a.js*.').files, 1);
  const p = 'Change **paginate.js**, **cursor.js** and **api.js**. Run node --test.';
  assert.equal(ruleFeatures(p).files, 3);
  assert.ok(!ruleTier(ruleFeatures(p)).why.includes('checked'));
  assert.notEqual(ruleTier(ruleFeatures(p)).tier, 'haiku');
});

test('orderings rotate the tiers so each tier is first once in k=3', () => {
  const o = orderings(3);
  assert.deepEqual(o.map((x) => x[0]).sort(), [...TIERS].sort());
  assert.equal(orderings(5).length, 5);
  assert.deepEqual(Object.keys(buildRequest('t', '', o[1]).questions.tier.criteria), o[1]);
});

test('consistency: stable → shared label, unstable → highest', () => {
  assert.deepEqual(consistency([{ tier: 'haiku' }, { tier: 'haiku' }, { tier: 'haiku' }]).tier, 'haiku');
  const u = consistency([{ tier: 'haiku' }, { tier: 'sonnet' }, { tier: 'haiku' }]);
  assert.equal(u.tier, 'sonnet');
  assert.equal(u.stable, false);
  assert.equal(consistency([{ error: 'x' }, { tier: 'haiku' }]).tier, 'haiku');
});

test('combine: gating picks the cheaper tier only when rule and provider agree', () => {
  const a = (t) => [{ tier: t }];
  assert.equal(combine('gate', 'haiku', a('haiku')), 'haiku');
  assert.equal(combine('gate', 'haiku', a('opus')), 'opus');
  assert.equal(combine('gate', 'opus', a('haiku')), 'opus');
  assert.equal(combine('jev', 'opus', a('haiku')), 'haiku');
  assert.equal(combine('rules', 'sonnet', []), 'sonnet');
  assert.equal(combine('gate+sc', 'haiku', [{ tier: 'haiku' }, { tier: 'sonnet' }, { tier: 'haiku' }]), 'sonnet');
  assert.equal(combine('gate', 'haiku', [{ error: 'x' }]), null);
});

test('maxTier / nextTier (cascade)', () => {
  assert.equal(maxTier('haiku', 'opus', 'sonnet'), 'opus');
  assert.equal(nextTier('haiku'), 'sonnet');
  assert.equal(nextTier('sonnet'), 'opus');
  assert.equal(nextTier('opus'), null);
});

test('route: k calls, option order shuffled, position-biased provider → unstable → higher tier', async () => {
  const fake = fakeDecide((order) => order[0]); // always answers the first option shown
  const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev', k: 3 }), decideImpl: fake, log: false });
  assert.equal(fake.calls(), 3);
  assert.equal(r.consistency.stable, false);
  assert.equal(r.tier, 'opus');
});

test('route: stable cheap answer + cheap rule → haiku; k configurable', async () => {
  const fake = fakeDecide(() => 'haiku');
  const r = await route({ task: 'List the files under docs/. Do not edit anything.', cfg: cfgOf({ provider: 'jev', k: 5 }), decideImpl: fake, log: false });
  assert.equal(fake.calls(), 5);
  assert.equal(r.tier, 'haiku');
});

test('route: provider failure → null tier (keep default), mode off → no calls', async () => {
  const r = await route({ task: 'x', cfg: cfgOf({ provider: 'jev' }), decideImpl: failing, log: false });
  assert.equal(r.tier, null);
  const fake = fakeDecide(() => 'haiku');
  const off = await route({ task: 'x', cfg: cfgOf({ mode: 'off', provider: 'jev' }), decideImpl: fake, log: false });
  assert.equal(off.tier, null);
  assert.equal(fake.calls(), 0);
});

test('route logs one line without the prompt text', async () => {
  const log = path.join(tmp, 'route-log.jsonl');
  await route({ task: 'SECRET-PROMPT find x', cfg: cfgOf({ provider: 'none', log }) });
  const text = fs.readFileSync(log, 'utf8');
  assert.equal(text.trim().split('\n').length, 1);
  assert.ok(!text.includes('SECRET-PROMPT'));
});

test('loadConfig: env and overrides, provider none forces rules', () => {
  const d = loadConfig({ env: {}, file: path.join(tmp, 'none.json') });
  assert.equal(d.provider, 'none'); // default: no prompt leaves the machine
  assert.equal(d.mode, 'shadow');
  const c = loadConfig({ env: { SUBAGENT_ROUTER_MODE: 'apply', SUBAGENT_ROUTER_K: '5', SUBAGENT_ROUTER_PROVIDER: 'jev' }, file: path.join(tmp, 'none.json') });
  assert.equal(c.mode, 'apply');
  assert.equal(c.k, 5);
  assert.equal(c.policy, 'gate+sc');
  assert.equal(loadConfig({ env: {}, file: 'x', overrides: { provider: 'none', policy: 'sc' } }).policy, 'rules');
  assert.throws(() => loadConfig({ env: { SUBAGENT_ROUTER_MODE: 'bogus' }, file: 'x' }));
});

// ---- hook ----

const hookInput = (tool_input, extra = {}) => ({ session_id: 's', tool_use_id: 'tu', cwd: tmp, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input, ...extra });

test('hook apply: sets model and keeps every original field', async () => {
  const ti = { description: 'd', prompt: 'List the files in docs/. Do not edit anything.', subagent_type: 'general-purpose' };
  const out = await handle(hookInput(ti), { cfg: cfgOf({ mode: 'apply', provider: 'none' }), home: tmp });
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  assert.deepEqual(out.hookSpecificOutput.updatedInput, { ...ti, model: 'haiku' });
});

test('hook never overrides an explicit model, and shadow mode never outputs', async () => {
  const cfg = cfgOf({ mode: 'apply', provider: 'none' });
  assert.equal(await handle(hookInput({ prompt: 'find x', model: 'opus' }), { cfg, home: tmp }), null);
  assert.equal(await handle(hookInput({ prompt: 'find x' }), { cfg: cfgOf({ mode: 'shadow', provider: 'none' }), home: tmp }), null);
  assert.equal(await handle(hookInput({ prompt: 'find x' }, { tool_name: 'Bash' }), { cfg, home: tmp }), null);
});

test('hook leaves a subagent whose definition sets a model alone', async () => {
  fs.mkdirSync(path.join(tmp, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude', 'agents', 'pinned.md'), '---\nname: pinned\nmodel: opus\n---\nbody\n');
  fs.writeFileSync(path.join(tmp, '.claude', 'agents', 'inh.md'), '---\nname: inh\nmodel: inherit\n---\nbody\n');
  assert.equal(definitionModel('pinned', tmp, tmp), 'opus');
  const cfg = cfgOf({ mode: 'apply', provider: 'none' });
  assert.equal(await handle(hookInput({ prompt: 'find x', subagent_type: 'pinned' }), { cfg, home: tmp }), null);
  const inh = await handle(hookInput({ prompt: 'find x', subagent_type: 'inh' }), { cfg, home: tmp });
  assert.equal(inh.hookSpecificOutput.updatedInput.model, 'haiku');
});

test('hook with a failing provider keeps the default model', async () => {
  const out = await handle(hookInput({ prompt: 'find x' }), { cfg: cfgOf({ mode: 'apply', provider: 'jev' }), decideImpl: failing, home: tmp });
  assert.equal(out, null);
});

// ess-be pilot (research/subagent-router-ess-be-pilot.md, finding 1): the fixed definition of done
// said "Ignore those 17 and do not change them", which made coding stories look like lookups.
test('read-only: a "do not change them" guard in a coding brief is not a lookup', () => {
  const dod = 'Read its CLAUDE.md first. Definition of done: 0-warning build, the suite is green apart from the 17 tests that already fail on a clean checkout. Ignore those 17 and do not change them. Add tests, make one Conventional Commit, do not push.';
  const s1 = `Validate leave request fields and dates up front. Add rules to CreateLeaveRequestRequestValidator: LegalEntityId/LeaveType required, StartDate not default, EndDate >= StartDate when present, Comment <= 1000 chars.\n${dod}`;
  const f = ruleFeatures(s1);
  assert.equal(f.readOnly, false);
  assert.ok(!ruleTier(f).why.includes('lookup'));
  assert.equal(ruleTier(f).tier, 'sonnet');
  const s3 = `Bug: bank-account save returns 500. Fix the NRE when data is null and throw ApplicationException for a blank PersonnelNumber.\n${dod}`;
  assert.equal(ruleFeatures(s3).readOnly, false);
  // Genuine read-only tasks still are.
  assert.equal(ruleFeatures('Read src/a.ts and summarise it. Do not change anything.').readOnly, true);
  assert.equal(ruleFeatures('List the callers of foo. Read-only, no edits.').readOnly, true);
});
