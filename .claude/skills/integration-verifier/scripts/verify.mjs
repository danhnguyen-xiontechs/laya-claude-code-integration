#!/usr/bin/env node
// verify.mjs — integration-verifier: checks a batch of parallel story branches together.
// Zero dependencies, Node >= 18, needs git on PATH.
//
//   node verify.mjs --batch <batch.json> [--out <dir>] [--jev] [--keep-worktree]
//
// Deterministic rules decide every status. Jev (--jev, needs OPENROUTER_API_KEY) only adds a
// labelled category suggestion to failure clusters the rules could not classify (shadow mode):
// it never changes a status, so it can never turn FAIL / BLOCKED / missing evidence into PASS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, top, appendJsonl } from './decision-provider.mjs';

export const STATUSES = ['PASS', 'REVIEW_REQUIRED', 'BLOCKED', 'FAIL']; // ascending severity
export const CATEGORIES = ['code_regression', 'test_data', 'environment', 'dependency', 'flaky_test', 'unknown'];
export const MANIFEST_SCHEMA = 'integration-verifier/story-result@1';
const worst = (...s) => s.reduce((a, b) => (STATUSES.indexOf(b) > STATUSES.indexOf(a) ? b : a), 'PASS');

// ---------- path kinds (Phase 3 rules) ----------
const RX = {
  migration: /(^|\/)(migrations?|db\/migrate|alembic\/versions)\//i,
  fixture: /(^|\/)(fixtures?|__fixtures__|testdata|__mocks__|mocks|seeds?)\//i,
  config: /(^|\/)(config|settings)\/|(^|\/)(\.env[^/]*|appsettings[^/]*\.json|application[^/]*\.(ya?ml|properties)|[^/]*\.config\.(js|mjs|json))$/i,
  contract: /(^|\/)(contracts?|dto|dtos|schemas?|openapi|proto|api)\/|\.(proto|graphql|d\.ts)$|openapi[^/]*\.(ya?ml|json)$/i,
  generated: /(^|\/)(generated|gen|__generated__)\/|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/i,
};
export function pathKind(p) {
  for (const k of ['migration', 'fixture', 'generated', 'contract', 'config']) if (RX[k].test(p)) return k;
  return 'code';
}
/** Migration ordering key: leading version digits ("0003_add.sql" → "0003", "20241001120000_x" → that). */
export const migrationKey = (p) => (path.basename(p).match(/^(\d+)/) || [])[1] ?? null;

// ---------- environment / dependency signatures (deterministic triage first) ----------
const ENV_RX = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|getaddrinfo|connection refused|could not connect|no space left|permission denied|EACCES|is not recognized as an internal or external command|command not found|docker daemon|service unavailable|database .* does not exist|port \d+ (is )?already in use|EADDRINUSE/i;
const DEP_RX = /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|No module named|could not resolve dependency|ERESOLVE|package .* not found|unable to resolve/i;
const FLAKY_RX = /\b(flaky|timed? ?out after|Timeout of \d+ms exceeded|retry \d+\/\d+)\b/i;
export function deterministicCategory(log, exitCode) {
  if (exitCode === 127 || exitCode === 9009) return 'environment'; // shell: command not found (posix / cmd.exe)
  if (ENV_RX.test(log)) return 'environment';
  if (DEP_RX.test(log)) return 'dependency';
  if (FLAKY_RX.test(log)) return 'flaky_test';
  return null; // ambiguous → optional Jev shadow suggestion, status stays as the rules set it
}
/** First meaningful error line, with digits/paths/hex normalised, so equal failures cluster. */
export function signature(log) {
  const lines = String(log).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /error|fail|assert|exception|expected|cannot|refused|not found|undefined|not a function/i.test(l)) || lines.at(-1) || '';
  return hit.replace(/[A-Za-z]:\\[^\s:]+|\/[^\s:]+\/[^\s:]+/g, '<path>').replace(/0x[0-9a-f]+/gi, '<hex>').replace(/\d+/g, '<n>').slice(0, 200);
}
/** Redact obvious secrets before anything leaves the machine. */
export const redact = (s) => String(s)
  .replace(/(api[_-]?key|token|secret|password|pwd|authorization)\s*[:=]\s*\S+/gi, '$1=<redacted>')
  .replace(/\b(sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{8,}/g, '<redacted>')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>');

// ---------- small process helpers ----------
function sh(cmd, cwd, timeoutMs = 600000) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const exit = r.error?.code === 'ETIMEDOUT' ? 124 : (r.status ?? 1);
  return { exit, out: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`, ms: Date.now() - t0 };
}
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// ---------- Phase 1: load the per-story result manifest ----------
export function validateManifest(m, storyId) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest missing or not JSON'];
  if (m.schema !== MANIFEST_SCHEMA) errs.push(`schema must be "${MANIFEST_SCHEMA}"`);
  if (m.story_id !== storyId) errs.push(`story_id "${m.story_id}" ≠ "${storyId}"`);
  for (const k of ['acceptance_criteria', 'checks', 'changed_files']) if (!Array.isArray(m[k])) errs.push(`${k} must be an array`);
  return errs;
}
function loadManifest(story, repo, baseDir) {
  if (story.manifest) return readJson(path.resolve(baseDir, story.manifest));
  const r = git(['show', `${story.branch}:.integration/${story.id}.json`], repo);
  return r.ok ? (() => { try { return JSON.parse(r.out); } catch { return null; } })() : null;
}

// ---------- Phase 2a: per-story evidence ----------
function verifyStory(story, ctx) {
  const { batch, repo, baseDir, acMatrix, findings } = ctx;
  const res = { id: story.id, branch: story.branch, status: 'PASS', reasons: [], checks: [], acs: [], files: [], manifest: null };
  const add = (status, reason) => { res.status = worst(res.status, status); res.reasons.push(`${status}: ${reason}`); };

  const ref = git(['rev-parse', '--verify', `${story.branch}^{commit}`], repo);
  if (!ref.ok) { add('BLOCKED', `branch ${story.branch} not found`); return res; }
  const d = git(['diff', '--name-only', `${batch.base}...${story.branch}`], repo);
  res.files = d.ok ? d.out.split(/\r?\n/).filter(Boolean).filter((f) => !f.startsWith('.integration/')) : [];
  if (!d.ok) add('BLOCKED', `git diff failed: ${d.err.slice(0, 120)}`);
  if (!res.files.length) add('REVIEW_REQUIRED', 'branch has no changes against base');

  const m = loadManifest(story, repo, baseDir);
  const errs = validateManifest(m, story.id);
  if (errs.length) { add('BLOCKED', `result manifest invalid: ${errs.join('; ')}`); return res; }
  res.manifest = m;

  // Claimed vs actual changed files (agent reports may omit or invent files).
  const claimed = new Set(m.changed_files);
  const unclaimed = res.files.filter((f) => !claimed.has(f));
  const phantom = [...claimed].filter((f) => !res.files.includes(f));
  if (unclaimed.length) add('REVIEW_REQUIRED', `changed but not declared: ${unclaimed.join(', ')}`);
  if (phantom.length) add('REVIEW_REQUIRED', `declared but not in diff: ${phantom.join(', ')}`);

  // Required checks: must be recorded with an exit code AND a non-empty log artifact.
  const byName = Object.fromEntries(m.checks.map((c) => [c.name, c]));
  for (const rc of batch.required_checks) {
    const c = byName[rc.name];
    const row = { name: rc.name, exit: c?.exit_code ?? null, log: c?.log_path ?? null, evidence: 'missing' };
    if (!c) add('BLOCKED', `required check "${rc.name}" not run (no record)`);
    else if (!c.log_path || !fs.existsSync(path.resolve(baseDir, c.log_path)) || !fs.statSync(path.resolve(baseDir, c.log_path)).size) add('BLOCKED', `required check "${rc.name}" has no log artifact — a claim without a log is not evidence`);
    else if (typeof c.exit_code !== 'number') add('BLOCKED', `required check "${rc.name}" has no exit code`);
    else if (c.exit_code !== 0) { row.evidence = 'log'; add('FAIL', `required check "${rc.name}" exited ${c.exit_code} in the story worktree`); }
    else row.evidence = 'log';
    res.checks.push(row);
  }

  // Acceptance criteria → evidence. Valid evidence: a passing check with a log, a covered row in
  // the acceptance-criteria-coverage matrix, or an explicit human decision. Claims alone never count.
  const passed = new Set(res.checks.filter((c) => c.evidence === 'log' && c.exit === 0).map((c) => c.name));
  for (const c of m.checks) if (c.exit_code === 0 && c.log_path && fs.existsSync(path.resolve(baseDir, c.log_path))) passed.add(c.name);
  for (const ac of m.acceptance_criteria) {
    const ev = [];
    for (const e of ac.evidence || []) {
      if (e.type === 'check' && passed.has(e.name)) ev.push(`check:${e.name}`);
      if (e.type === 'human' && e.by) ev.push(`human:${e.by}`);
    }
    const cov = acMatrix.filter((r) => r.story === story.id && r.ac === ac.id);
    if (cov.some((r) => r.status === 'covered')) ev.push(`ac-coverage:${cov.find((r) => r.status === 'covered').test || 'covered'}`);
    const uncovered = cov.some((r) => r.status === 'uncovered');
    const row = { id: ac.id, claimed: ac.claimed ?? null, evidence: ev, status: 'PASS' };
    if (ac.claimed === 'failed') { row.status = 'FAIL'; add('FAIL', `AC ${ac.id} reported failed`); }
    else if (uncovered && !ev.length) { row.status = 'REVIEW_REQUIRED'; add('REVIEW_REQUIRED', `AC ${ac.id} uncovered in AC-coverage matrix`); }
    else if (!ev.length) { row.status = 'REVIEW_REQUIRED'; add('REVIEW_REQUIRED', `AC ${ac.id} has no evidence (claim only)`); }
    res.acs.push(row);
  }
  if (!m.acceptance_criteria.length) add('REVIEW_REQUIRED', 'no acceptance criteria listed');

  // Consumed review findings (review-pr-jev-classify / subagent-validator artifacts), not re-called.
  for (const f of findings.filter((x) => x.story === story.id)) {
    const sev = String(f.severity || '').toLowerCase();
    if (['blocker', 'critical', 'high'].includes(sev)) add('REVIEW_REQUIRED', `review finding [${f.severity}] ${f.title || ''}`.trim());
  }
  return res;
}

// ---------- Phase 3: cross-story consistency ----------
export function crossStory(stories) {
  const conflicts = [];
  const touch = {};
  for (const s of stories) for (const f of s.files) (touch[f] ||= []).push(s.id);
  for (const [f, ids] of Object.entries(touch)) if (ids.length > 1) {
    const kind = pathKind(f);
    conflicts.push({ type: `shared_${kind}`, items: [f], stories: ids, status: kind === 'code' || kind === 'generated' ? 'REVIEW_REQUIRED' : 'FAIL', why: `${ids.length} stories change the same ${kind} file` });
  }
  // Duplicate migration versions (different files, same version key).
  const mig = {};
  for (const s of stories) for (const f of s.files) if (pathKind(f) === 'migration' && migrationKey(f)) (mig[`${path.dirname(f)}#${migrationKey(f)}`] ||= []).push({ f, id: s.id });
  for (const [k, list] of Object.entries(mig)) {
    const files = [...new Set(list.map((x) => x.f))];
    if (files.length > 1) conflicts.push({ type: 'duplicate_migration', items: files, stories: [...new Set(list.map((x) => x.id))], status: 'FAIL', why: `migration version ${k.split('#')[1]} used by ${files.length} files` });
  }
  // Declared contracts: provided signature vs what other stories consume / provide.
  const prov = {}, cons = [];
  for (const s of stories) {
    for (const c of s.manifest?.contracts?.provides || []) (prov[c.name] ||= []).push({ ...c, id: s.id });
    for (const c of s.manifest?.contracts?.consumes || []) cons.push({ ...c, id: s.id });
  }
  for (const [name, list] of Object.entries(prov)) {
    const sigs = [...new Set(list.map((x) => x.signature))];
    if (sigs.length > 1) conflicts.push({ type: 'contract_divergence', items: [name, ...sigs], stories: list.map((x) => x.id), status: 'FAIL', why: `contract ${name} provided with ${sigs.length} different signatures` });
  }
  for (const c of cons) for (const p of prov[c.name] || []) if (p.id !== c.id && p.signature !== c.signature)
    conflicts.push({ type: 'contract_mismatch', items: [c.name, `provides ${p.signature}`, `consumes ${c.signature}`], stories: [p.id, c.id], status: 'FAIL', why: `${c.id} consumes ${c.name} as "${c.signature}" but ${p.id} changes it to "${p.signature}"` });
  // Same config key set to different values.
  const cfg = {};
  for (const s of stories) for (const [k, v] of Object.entries(s.manifest?.config || {})) (cfg[k] ||= []).push({ v: JSON.stringify(v), id: s.id });
  for (const [k, list] of Object.entries(cfg)) if (new Set(list.map((x) => x.v)).size > 1)
    conflicts.push({ type: 'config_conflict', items: [k, ...list.map((x) => `${x.id}=${x.v}`)], stories: list.map((x) => x.id), status: 'FAIL', why: `config key ${k} set to different values` });
  return conflicts;
}

// ---------- Phase 2b: combined change in an isolated integration worktree ----------
function combined(batch, repo, stories, outDir, keep) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-wt-'));
  const res = { worktree: wt, merged: [], merge_conflicts: [], checks: [], status: 'PASS' };
  const add = git(['worktree', 'add', '--detach', wt, batch.base], repo);
  if (!add.ok) { res.status = 'BLOCKED'; res.error = `worktree add failed: ${add.err.slice(0, 160)}`; return res; }
  try {
    const id = ['-c', 'user.name=integration-verifier', '-c', 'user.email=iv@localhost'];
    for (const s of stories) {
      if (!git(['rev-parse', '--verify', `${s.branch}^{commit}`], wt).ok) continue;
      const m = git([...id, 'merge', '--no-ff', '--no-edit', s.branch], wt);
      if (m.ok) { res.merged.push(s.id); continue; }
      const files = git(['diff', '--name-only', '--diff-filter=U'], wt).out.split(/\r?\n/).filter(Boolean);
      res.merge_conflicts.push({ story: s.id, files });
      git(['merge', '--abort'], wt);
    }
    if (res.merge_conflicts.length) res.status = 'FAIL';
    for (const rc of batch.required_checks) {
      const r = sh(rc.cmd, wt, rc.timeout_ms);
      const log = path.join(outDir, 'logs', `combined-${rc.name.replace(/[^\w.-]/g, '_')}.log`);
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.writeFileSync(log, `$ ${rc.cmd}\n# exit ${r.exit} in ${r.ms} ms\n${r.out}`);
      const cat = r.exit === 0 ? null : deterministicCategory(r.out, r.exit);
      const status = r.exit === 0 ? 'PASS' : cat === 'environment' ? 'BLOCKED' : 'FAIL';
      res.checks.push({ name: rc.name, cmd: rc.cmd, exit: r.exit, ms: r.ms, log: path.relative(outDir, log).replace(/\\/g, '/'), status, category: cat, signature: r.exit ? signature(r.out) : null, out: r.out });
      res.status = worst(res.status, status);
    }
  } finally {
    if (!keep) { git(['worktree', 'remove', '--force', wt], repo); fs.rmSync(wt, { recursive: true, force: true }); }
  }
  return res;
}

// ---------- Phase 5: failure clusters, attribution, Jev shadow triage ----------
export function attribute(out, stories) {
  // Stories whose changed files (or their basenames) appear in the failure output, ranked by hits.
  const text = String(out).replace(/\\/g, '/');
  return stories.map((s) => ({ id: s.id, hits: s.files.filter((f) => text.includes(f) || text.includes(path.basename(f, path.extname(f)))).length }))
    .filter((x) => x.hits).sort((a, b) => b.hits - a.hits).map((x) => x.id);
}
export function buildTriageRequest(cluster, stories) {
  const lines = String(cluster.excerpt).split(/\r?\n/).filter((l) => /error|fail|assert|expected|cannot|refused|not found|undefined|not a function|at /i.test(l)).slice(0, 12);
  const text = [
    `Check: ${cluster.check} (exit ${cluster.exit})`,
    `Failure signature: ${cluster.signature}`,
    `Failure excerpt (redacted):\n${redact(lines.join('\n')).slice(0, 1200)}`,
    `Stories in the batch and the files they changed:`,
    ...stories.map((s) => `- ${s.id}: ${s.files.slice(0, 12).join(', ')}`),
  ].join('\n');
  const criteria = {
    code_regression: 'Production code is wrong or two stories\' code changes are incompatible (signature, interface, logic).',
    test_data: 'Test fixtures, mocks, seed or expected test data are wrong or were changed inconsistently.',
    environment: 'A service, network, permission, tool or machine problem outside the code.',
    dependency: 'A package / module / version is missing or incompatible.',
    flaky_test: 'Nondeterministic timing or ordering; the same code may pass on rerun.',
    unknown: 'Not enough information to tell.',
  };
  return { state: { text }, questions: { category: { type: 'choice', instructions: 'Which category best explains this combined-build failure?', criteria } } };
}
async function triage(comb, stories, opts) {
  const clusters = {};
  for (const c of comb.checks.filter((x) => x.exit !== 0)) {
    const key = `${c.category || '?'}|${c.signature}`;
    (clusters[key] ||= { signature: c.signature, category: c.category, category_source: c.category ? 'rule' : null, checks: [], check: c.name, exit: c.exit, excerpt: c.out, stories: attribute(c.out, stories) }).checks.push(c.name);
  }
  const list = Object.values(clusters);
  let calls = 0;
  for (const cl of list) {
    if (!cl.category && opts.jev && calls < opts.maxJev) {
      calls++;
      const { state, questions } = buildTriageRequest(cl, stories);
      const r = await decide({ provider: 'jev', state, questions, timeoutMs: 15000 });
      if (r.ok && r.answers.category) {
        const t = top(r.answers.category.probabilities);
        cl.jev = { suggestion: t.label, p: t.p, margin: Number((t.p - t.second).toFixed(3)), latencyMs: r.meta.latencyMs, cost: r.meta.cost };
      } else cl.jev = { error: r.error };
      appendJsonl(path.join(opts.outDir, 'jev-shadow.jsonl'), { batch: opts.batchId, signature: cl.signature, request_chars: state.text.length, result: cl.jev, model: r.meta.model });
    }
    if (!cl.category) { cl.category = 'unknown'; cl.category_source = 'rule-fallback'; }
    delete cl.excerpt;
  }
  return { clusters: list, jev_calls: calls };
}

// ---------- assemble ----------
export function finalize(storyRes, conflicts, comb, clusters) {
  for (const c of conflicts) for (const id of c.stories) {
    const s = storyRes.find((x) => x.id === id);
    if (s) { s.status = worst(s.status, c.status); s.reasons.push(`${c.status}: ${c.type} — ${c.why}`); }
  }
  for (const mc of comb.merge_conflicts) {
    const s = storyRes.find((x) => x.id === mc.story);
    if (s) { s.status = worst(s.status, 'FAIL'); s.reasons.push(`FAIL: merge conflict in combined worktree (${mc.files.join(', ')})`); }
  }
  for (const cl of clusters) {
    const st = cl.category === 'environment' ? 'BLOCKED' : 'FAIL';
    // Attributed stories take the failure; every other story is at least REVIEW_REQUIRED (BLOCKED
    // for an environment failure): a red combined run never leaves any story PASS.
    for (const s of storyRes) {
      const mine = cl.stories.includes(s.id);
      const apply = mine ? st : st === 'BLOCKED' ? 'BLOCKED' : 'REVIEW_REQUIRED';
      s.status = worst(s.status, apply);
      s.reasons.push(`${apply}: combined ${cl.checks.join('+')} failed (${cl.category}, ${mine ? 'attributed' : 'not attributed'}) — ${cl.signature}`);
    }
  }
  // Combined checks must have actually run and passed for any PASS.
  if (comb.status === 'BLOCKED' && comb.error) for (const s of storyRes) { s.status = worst(s.status, 'BLOCKED'); s.reasons.push(`BLOCKED: ${comb.error}`); }
  if (!comb.checks.length) for (const s of storyRes) { s.status = worst(s.status, 'BLOCKED'); s.reasons.push('BLOCKED: no combined check ran'); }
  const batch = worst(comb.status, ...storyRes.map((s) => s.status), ...conflicts.map((c) => c.status));
  return batch;
}

export function renderMarkdown(r) {
  const L = [];
  L.push(`# Integration verification — ${r.batch_id}`, '', `**Batch status: ${r.status}** · base \`${r.base}\` · ${r.stories.length} stories · ${r.generated_at}`, '');
  L.push('No merge was performed: this report is evidence for a human gate (v1 never auto-merges).', '');
  L.push('## Per-story status', '', '| Story | Branch | Status | Reasons |', '|---|---|---|---|');
  for (const s of r.stories) L.push(`| ${s.id} | \`${s.branch}\` | **${s.status}** | ${s.reasons.map((x) => x.replace(/\|/g, '\\|')).join('<br>') || '—'} |`);
  L.push('', '## AC → evidence', '', '| Story | AC | Claimed | Evidence | Status |', '|---|---|---|---|---|');
  for (const s of r.stories) for (const a of s.acs) L.push(`| ${s.id} | ${a.id} | ${a.claimed ?? '—'} | ${a.evidence.join(', ') || '**none**'} | ${a.status} |`);
  L.push('', '## Checks run', '', '| Where | Check | Exit | Log | Status |', '|---|---|---|---|---|');
  for (const s of r.stories) for (const c of s.checks) L.push(`| ${s.id} (reported) | ${c.name} | ${c.exit ?? '—'} | ${c.log ?? '**missing**'} | ${c.evidence === 'missing' ? 'BLOCKED' : c.exit === 0 ? 'PASS' : 'FAIL'} |`);
  for (const c of r.combined.checks) L.push(`| combined (run by verifier) | ${c.name} \`${c.cmd}\` | ${c.exit} | ${c.log} | ${c.status} |`);
  L.push('', `Merged into integration worktree: ${r.combined.merged.join(', ') || 'none'}${r.combined.merge_conflicts.length ? ` · merge conflicts: ${r.combined.merge_conflicts.map((m) => `${m.story} (${m.files.join(', ')})`).join('; ')}` : ''}`);
  L.push('', '## Cross-story conflicts', '');
  if (!r.conflicts.length) L.push('None found.');
  else { L.push('| Type | Items | Stories | Status | Why |', '|---|---|---|---|---|'); for (const c of r.conflicts) L.push(`| ${c.type} | ${c.items.join('; ')} | ${c.stories.join(', ')} | ${c.status} | ${c.why} |`); }
  L.push('', '## Failure clusters', '');
  if (!r.clusters.length) L.push('None.');
  else {
    L.push('| Signature | Checks | Category (rules) | Likely stories | Jev suggestion (shadow, not used) |', '|---|---|---|---|---|');
    for (const c of r.clusters) L.push(`| \`${c.signature.replace(/\|/g, '\\|')}\` | ${c.checks.join(', ')} | ${c.category} (${c.category_source}) | ${c.stories.join(', ') || 'unattributed'} | ${c.jev ? (c.jev.error ? `error: ${c.jev.error}` : `${c.jev.suggestion} p=${c.jev.p}`) : '—'} |`);
  }
  L.push('', '## Missing evidence and next actions', '');
  const miss = r.stories.flatMap((s) => s.reasons.filter((x) => /BLOCKED|no evidence|not declared|no log/.test(x)).map((x) => `- ${s.id}: ${x}`));
  L.push(...(miss.length ? miss : ['- None.']));
  L.push('', r.status === 'PASS' ? '- All required checks ran and passed on the combined change; hand to a human for merge.' : '- Resolve the FAIL / BLOCKED items above, re-run the stories\' checks with logs, then re-run this verifier.');
  return L.join('\n') + '\n';
}

export async function verifyBatch(batchFile, opts = {}) {
  const baseDir = path.dirname(path.resolve(batchFile));
  const batch = readJson(batchFile);
  if (!batch) throw new Error(`cannot read batch file ${batchFile}`);
  const repo = path.resolve(baseDir, batch.repo);
  const outDir = path.resolve(opts.out || path.join(baseDir, 'iv-out'));
  fs.mkdirSync(outDir, { recursive: true });
  const acMatrix = batch.artifacts?.ac_coverage ? readJson(path.resolve(baseDir, batch.artifacts.ac_coverage)) || [] : [];
  const findings = batch.artifacts?.review_findings ? readJson(path.resolve(baseDir, batch.artifacts.review_findings)) || [] : [];
  batch.required_checks ||= [];
  const ctx = { batch, repo, baseDir, acMatrix, findings };
  const stories = batch.stories.map((s) => verifyStory(s, ctx));
  if (!batch.required_checks.length) for (const s of stories) { s.status = worst(s.status, 'BLOCKED'); s.reasons.push('BLOCKED: batch defines no required checks'); }
  const conflicts = crossStory(stories);
  const comb = combined(batch, repo, stories, outDir, opts.keepWorktree);
  const { clusters, jev_calls } = await triage(comb, stories, { jev: !!opts.jev, maxJev: opts.maxJev ?? 3, outDir, batchId: batch.batch_id });
  const status = finalize(stories, conflicts, comb, clusters);
  for (const c of comb.checks) delete c.out;
  const report = { schema: 'integration-verifier/report@1', batch_id: batch.batch_id, base: batch.base, status, generated_at: new Date().toISOString(), stories: stories.map(({ manifest, ...s }) => s), conflicts, combined: comb, clusters, jev_calls, jev_mode: opts.jev ? 'shadow' : 'off' };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.md'), renderMarkdown(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  if (!get('--batch')) { console.error('usage: verify.mjs --batch <batch.json> [--out dir] [--jev] [--max-jev n] [--keep-worktree] [--json]'); process.exit(2); }
  const r = await verifyBatch(get('--batch'), { out: get('--out'), jev: a.includes('--jev'), maxJev: Number(get('--max-jev') ?? 3), keepWorktree: a.includes('--keep-worktree') });
  if (a.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else { console.log(`batch ${r.batch_id}: ${r.status}`); for (const s of r.stories) console.log(`  ${s.id}: ${s.status}`); }
  process.exit(r.status === 'PASS' ? 0 : r.status === 'FAIL' ? 1 : 3);
}
