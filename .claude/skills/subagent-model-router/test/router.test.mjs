import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ruleFeatures, ruleTier, combine, consistency, orderings, buildRequest, route, loadConfig, maxTier, nextTier, TIERS,
} from '../scripts/router.mjs';
import { handle, definitionModel } from '../scripts/hook-pretooluse.mjs';
import { sessionSpend } from '../scripts/spend-ledger.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-test-'));
// Each config gets its own ledger file, so tests never share spend and never touch the real home ledger.
let ledgerN = 0;
const cfgOf = (o = {}) => loadConfig({ env: {}, file: path.join(tmp, 'none.json'), overrides: { log: path.join(tmp, 'log.jsonl'), ledger: path.join(tmp, `ledger-${ledgerN++}.json`), ...o } });

/** Fake provider: answers the tier question with `pick(order, callIndex)`; counts calls. `cost` is the USD the provider reports per call (omit → no cost). */
function fakeDecide(pick, cost) {
  let n = 0;
  const fn = async ({ questions }) => {
    const order = Object.keys(questions.tier.criteria);
    const label = pick(order, n++);
    const probabilities = Object.fromEntries(order.map((t) => [t, t === label ? 0.97 : 0.015]));
    const meta = { latencyMs: 5, ...(cost === undefined ? {} : { cost }) };
    return { ok: true, answers: { tier: { probabilities }, multi_file_design: { noul: 0.5 }, mechanical: { noul: 0.5 }, costly_failure: { noul: 0.5 } }, meta };
  };
  fn.calls = () => n;
  return fn;
}
const failing = async () => ({ ok: false, error: 'http 500', meta: { latencyMs: 3 } });
const timingOut = async () => ({ ok: false, error: 'timeout', meta: { latencyMs: 8000 } });

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

test('consistency: all the same → that label (stable); any disagreement → no label (unstable)', () => {
  assert.equal(consistency([{ tier: 'haiku' }, { tier: 'haiku' }, { tier: 'haiku' }]).tier, 'haiku');
  const u = consistency([{ tier: 'haiku' }, { tier: 'sonnet' }, { tier: 'haiku' }]);
  assert.equal(u.tier, null);
  assert.equal(u.stable, false);
  assert.equal(u.unstable, true);
  assert.equal(consistency([{ error: 'x' }, { tier: 'haiku' }]).tier, 'haiku');
});

test('combine: gating picks the cheaper tier only when rule and provider agree', () => {
  const a = (t) => [{ tier: t }];
  assert.equal(combine('gate', 'haiku', a('haiku')), 'haiku');
  assert.equal(combine('gate', 'haiku', a('opus')), 'opus');
  assert.equal(combine('gate', 'opus', a('haiku')), 'opus');
  assert.equal(combine('jev', 'opus', a('haiku')), 'haiku');
  assert.equal(combine('rules', 'sonnet', []), 'sonnet');
  assert.equal(combine('gate', 'haiku', [{ error: 'x' }]), null);
});

test('combine: a split vote keeps the rule tier and never raises it (sc, gate+sc)', () => {
  const split = [{ tier: 'haiku' }, { tier: 'sonnet' }, { tier: 'haiku' }];
  assert.equal(combine('sc', 'sonnet', split), 'sonnet');
  assert.equal(combine('gate+sc', 'haiku', split), 'haiku');
  const opusSplit = [{ tier: 'opus' }, { tier: 'opus' }, { tier: 'sonnet' }];
  assert.equal(combine('gate+sc', 'haiku', opusSplit), 'haiku');
  assert.equal(combine('sc', 'haiku', opusSplit), 'haiku');
  // a stable vote still applies: agreement on opus raises the tier
  assert.equal(combine('gate+sc', 'haiku', [{ tier: 'opus' }, { tier: 'opus' }, { tier: 'opus' }]), 'opus');
});

test('maxTier / nextTier (cascade)', () => {
  assert.equal(maxTier('haiku', 'opus', 'sonnet'), 'opus');
  assert.equal(nextTier('haiku'), 'sonnet');
  assert.equal(nextTier('sonnet'), 'opus');
  assert.equal(nextTier('opus'), null);
});

test('route: k calls, option order shuffled, position-biased provider → unstable → rule tier', async () => {
  const fake = fakeDecide((order) => order[0]); // always answers the first option shown
  const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev', k: 3 }), decideImpl: fake, log: false });
  assert.equal(fake.calls(), 3);
  assert.equal(r.consistency.stable, false);
  assert.equal(r.unstable, true);
  assert.equal(r.rule.tier, 'haiku');
  assert.equal(r.tier, 'haiku'); // not opus: the provider disagreed with itself
});

test('route: stable cheap answer + cheap rule → haiku; k configurable', async () => {
  const fake = fakeDecide(() => 'haiku');
  const r = await route({ task: 'List the files under docs/. Do not edit anything.', cfg: cfgOf({ provider: 'jev', k: 5 }), decideImpl: fake, log: false });
  assert.equal(fake.calls(), 5);
  assert.equal(r.tier, 'haiku');
});

test('route: provider failure → rule tier (rules_only) with fallback_reason; mode off → no calls', async () => {
  const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev' }), decideImpl: failing, log: false });
  assert.equal(r.tier, 'haiku');
  assert.equal(r.applied, 'rules_only');
  assert.equal(r.fallback_reason, 'provider http 500');
  const fake = fakeDecide(() => 'haiku');
  const off = await route({ task: 'x', cfg: cfgOf({ mode: 'off', provider: 'jev' }), decideImpl: fake, log: false });
  assert.equal(off.tier, null);
  assert.equal(fake.calls(), 0);
});

test('route: a timeout falls back to the rule tier, even when the provider would raise it', async () => {
  const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev' }), decideImpl: timingOut, log: false });
  assert.equal(r.tier, 'haiku');
  assert.equal(r.fallback_reason, 'provider timeout');
  assert.equal(r.providerCalls, 3);
});

test('route: a partial failure uses the good answers; no good answer → rule tier', async () => {
  let n = 0;
  const someFail = async (a) => (n++ === 0 ? timingOut() : fakeDecide(() => 'opus')(a));
  const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev', policy: 'gate+sc', k: 3 }), decideImpl: someFail, log: false });
  assert.equal(r.fallback_reason, undefined);
  assert.equal(r.tier, 'opus'); // two good answers agree on opus, which is above the rule's haiku
  assert.equal(r.applied, 'gate+sc');
});

test('route: an out-of-range tier answer is invalid output → rule tier', async () => {
  const badTier = async () => ({ ok: true, answers: { tier: { probabilities: { expert: 0.9, opus: 0.1 } } }, meta: { latencyMs: 5 } });
  const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev' }), decideImpl: badTier, log: false });
  assert.equal(r.tier, 'haiku');
  assert.equal(r.applied, 'rules_only');
  assert.equal(r.fallback_reason, 'provider no tier answer');
});

test('route: spend accumulates per session, a capped session stops calling, other sessions are unaffected', async () => {
  const ledger = path.join(tmp, 'cap.json');
  const cfg = cfgOf({ provider: 'jev', policy: 'jev', k: 1, maxUsdPerSession: 1, ledger });
  const fake = fakeDecide(() => 'haiku', 0.5);
  const a1 = await route({ task: 'Find the config file.', cfg, session: 'cap-a', decideImpl: fake, log: false });
  assert.equal(a1.cost_usd, 0.5);
  assert.equal(a1.applied, 'jev');
  await route({ task: 'Find the config file.', cfg, session: 'cap-a', decideImpl: fake, log: false });
  assert.deepEqual(sessionSpend(ledger, 'cap-a'), { usd: 1, calls: 2, unreported: 0 });
  const a3 = await route({ task: 'Find the config file.', cfg, session: 'cap-a', decideImpl: fake, log: false });
  assert.equal(fake.calls(), 2); // the third route made no provider call
  assert.equal(a3.providerCalls, 0);
  assert.equal(a3.applied, 'rules_only');
  assert.equal(a3.tier, 'haiku');
  assert.match(a3.fallback_reason, /^usd cap reached/);
  assert.equal(a3.cost_usd, 0);
  const b = await route({ task: 'Find the config file.', cfg, session: 'cap-b', decideImpl: fake, log: false });
  assert.equal(b.applied, 'jev');
  assert.equal(fake.calls(), 3);
});

test('route: call cap stops calls; a provider that reports no cost is counted as unreported', async () => {
  const ledger = path.join(tmp, 'calls.json');
  const cfg = cfgOf({ provider: 'jev', policy: 'jev', k: 1, maxCallsPerSession: 2, ledger });
  const fake = fakeDecide(() => 'haiku'); // no cost reported
  const r1 = await route({ task: 'Find the config file.', cfg, session: 'calls', decideImpl: fake, log: false });
  assert.equal(r1.cost_unreported, 1);
  assert.equal(r1.cost_usd, 0);
  await route({ task: 'Find the config file.', cfg, session: 'calls', decideImpl: fake, log: false });
  const r3 = await route({ task: 'Find the config file.', cfg, session: 'calls', decideImpl: fake, log: false });
  assert.equal(fake.calls(), 2);
  assert.match(r3.fallback_reason, /^call cap reached/);
  assert.deepEqual(sessionSpend(ledger, 'calls'), { usd: 0, calls: 2, unreported: 2 });
});

test('route: a corrupt or wrong-shaped ledger fails closed (no provider call, ledger_error set)', async () => {
  for (const [name, text] of [['corrupt.json', '{not json'], ['shape.json', '{"x":1}']]) {
    const ledger = path.join(tmp, name);
    fs.writeFileSync(ledger, text);
    const fake = fakeDecide(() => 'opus');
    const r = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev', ledger }), session: 's', decideImpl: fake, log: false });
    assert.equal(fake.calls(), 0);
    assert.equal(r.tier, 'haiku');
    assert.equal(r.applied, 'rules_only');
    assert.match(r.fallback_reason, /^ledger error/);
    assert.ok(r.ledger_error);
  }
});

test('route: the log line carries cost_usd, fallback_reason and session, never the prompt', async () => {
  const log = path.join(tmp, 'cost-log.jsonl');
  const cfg = cfgOf({ provider: 'jev', policy: 'jev', k: 1, log, ledger: path.join(tmp, 'cost-ledger.json') });
  await route({ task: 'SECRET-COST find x', cfg, session: 'log-s', decideImpl: fakeDecide(() => 'haiku', 0.02) });
  await route({ task: 'SECRET-COST find x', cfg, session: 'log-s', decideImpl: failing });
  const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].cost_usd, 0.02);
  assert.equal(lines[0].session, 'log-s');
  assert.equal(lines[0].fallback_reason, undefined);
  assert.equal(lines[1].fallback_reason, 'provider http 500');
  assert.equal(lines[1].applied, 'rules_only');
  assert.ok(!fs.readFileSync(log, 'utf8').includes('SECRET-COST'));
});

test('loadConfig: spend caps default to 2 USD and 60 calls; negative caps are rejected', () => {
  const d = loadConfig({ env: {}, file: path.join(tmp, 'none.json') });
  assert.equal(d.maxUsdPerSession, 2);
  assert.equal(d.maxCallsPerSession, 60);
  assert.equal(loadConfig({ env: {}, file: 'x', overrides: { maxUsdPerSession: 0 } }).maxUsdPerSession, 0);
  assert.throws(() => loadConfig({ env: {}, file: 'x', overrides: { maxUsdPerSession: -1 } }), /maxUsdPerSession/);
  assert.throws(() => loadConfig({ env: {}, file: 'x', overrides: { maxCallsPerSession: 'many' } }), /maxCallsPerSession/);
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

test('rule features: product names with a .js suffix are not files', () => {
  assert.equal(ruleFeatures('Use Node.js (`node`). No file changes are needed.').files, 0);
  assert.equal(ruleFeatures('Render with Next.js and Vue.js.').files, 0);
  assert.equal(ruleFeatures('Fix App.js. Use Node.js (`node`) to run it.').files, 1);
  assert.equal(ruleFeatures('Edit src/Node.js and Node.js.').files, 1);
});

test('checked policy: a checked task without a hard verb makes no provider call', async () => {
  const p = 'Fix `paginate` in src/paginate.js. Run `node --test` (it finds test/*.test.mjs).';
  const fake = fakeDecide(() => 'opus');
  const r = await route({ task: p, cfg: cfgOf({ provider: 'jev', policy: 'checked' }), decideImpl: fake, log: false });
  assert.equal(fake.calls(), 0);
  assert.equal(r.tier, ruleTier(ruleFeatures(p)).tier);
  assert.equal(r.tier, 'haiku');
  assert.equal(r.applied, 'rules');
  assert.equal(r.providerCalls, 0);
});

test('checked policy: an unchecked task asks k times (gate+sc); a hard checked task too', async () => {
  const fake = fakeDecide(() => 'sonnet');
  const u = await route({ task: 'Find the config file.', cfg: cfgOf({ provider: 'jev', policy: 'checked', k: 3 }), decideImpl: fake, log: false });
  assert.equal(fake.calls(), 3);
  assert.equal(u.applied, 'gate+sc');
  assert.equal(u.tier, 'sonnet');
  const fake2 = fakeDecide(() => 'opus');
  const h = await route({ task: 'Migrate the billing module to the new bus. Run node --test.', cfg: cfgOf({ provider: 'jev', policy: 'checked' }), decideImpl: fake2, log: false });
  assert.equal(fake2.calls(), 3);
  assert.equal(h.tier, 'opus');
});

test('combine checked: rule tier when checked and not hard; gate+sc otherwise', () => {
  assert.equal(combine('checked', 'haiku', [], ruleFeatures('Fix src/a.js. Run node --test.')), 'haiku');
  assert.equal(combine('checked', 'haiku', [{ tier: 'sonnet' }], ruleFeatures('Find the config file.')), 'sonnet');
  assert.equal(combine('checked', 'haiku', [{ tier: 'sonnet' }]), 'sonnet'); // no features: gate+sc
  assert.equal(combine('checked', 'haiku', [{ error: 'x' }], ruleFeatures('Find the config file.')), null);
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

test('hook with a failing provider sets the rule tier (not the default model)', async () => {
  const out = await handle(hookInput({ prompt: 'find x' }), { cfg: cfgOf({ mode: 'apply', provider: 'jev' }), decideImpl: failing, home: tmp });
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'haiku');
});

test('hook spend cap: a capped session gets the rule tier with no provider call', async () => {
  const cfg = cfgOf({ mode: 'apply', provider: 'jev', policy: 'jev', k: 1, maxUsdPerSession: 0 });
  const fake = fakeDecide(() => 'opus', 0.1);
  const out = await handle(hookInput({ prompt: 'find x' }), { cfg, decideImpl: fake, home: tmp });
  assert.equal(fake.calls(), 0);
  assert.equal(out.hookSpecificOutput.updatedInput.model, 'haiku');
});

test('hook logs the session id from the hook input, not the base fields', async () => {
  const log = path.join(tmp, 'hook-log.jsonl');
  await handle(hookInput({ prompt: 'find x' }, { session_id: 'hook-sess' }), { cfg: cfgOf({ mode: 'shadow', provider: 'none', log }), home: tmp });
  const rec = JSON.parse(fs.readFileSync(log, 'utf8').trim());
  assert.equal(rec.session, 'hook-sess');
  assert.equal(rec.source, 'hook');
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
