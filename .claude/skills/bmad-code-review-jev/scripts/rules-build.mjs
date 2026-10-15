#!/usr/bin/env node
// rules-build.mjs — builds the project's rule set for the Jev review layer, once per change of the rules.
//
//   node rules-build.mjs --project-root <dir> [--provider jev|laya|kev] [--force] [--dry-run]
//
// 1. Reads the project's own rules: project-context.md (legacy), the AGENTS.md bmad:context block,
//    literal persistent_facts in _bmad/custom/bmad-code-review*.toml.
// 2. Splits them into candidate rules (one per bullet), each with a stable id (hash of its text).
// 3. Asks the decision model, per rule: kind (semantic | mechanical | not_a_rule) and a file scope
//    chosen from the repo's real folders and file types. Rules already classified keep their answers.
// 4. Writes _bmad/custom/jev-rules.generated.json for a person to review. Corrections go to
//    _bmad/custom/jev-rules.json (never overwritten). --dry-run prints the parse and calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, loadConfig, parseArgs, pool, ranked, resolveProvider } from './decision-provider.mjs';
import { GENERATED, findRuleSources, parseRuleLines, readJson, scopeCandidates, sha } from './rules-lib.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BATCH = 15;

export const KIND_CRITERIA = {
  semantic: 'A coding rule whose violation can only be seen by understanding what the code does: behaviour, data flow, UI flow, which API, hook or helper to use, error handling, architecture. A text search cannot reliably detect it.',
  mechanical: 'A coding rule a text search, linter, formatter or compiler detects reliably: a banned token or element, syntax, import form, naming pattern, file location or file name, units or literal values.',
  not_a_rule: 'Not a rule about code in a diff: a description, version, tool or library name, command to run, setup fact, or a process rule about git, branches, tickets, reviews or communication.',
};

export function scopeCriteria(scopes) {
  const c = {};
  for (const s of scopes) {
    if (s === '**') c[s] = 'Any file in the repository: the rule is not tied to a folder or file type.';
    else if (s.startsWith('**/*')) c[s] = `Every ${s.slice(4)} file, wherever it is.`;
    else c[s] = `Files under ${s.replace(/\/\*\*$/, '/')}`;
  }
  return c;
}

export function classifyRequest(batch, scopes) {
  const questions = {};
  batch.forEach((r, i) => {
    questions[`kind_${i}`] = { type: 'choice', instructions: `What kind of statement is \`rules[${i}].text\` (found under the heading \`rules[${i}].heading\` of the project's agent instructions)?`, criteria: KIND_CRITERIA };
    questions[`scope_${i}`] = { type: 'choice', instructions: `Which files does the rule in \`rules[${i}]\` apply to? Use the heading as a hint. Pick the narrowest option that still covers every file the rule talks about.`, criteria: scopeCriteria(scopes) };
  });
  return { state: { rules: batch.map((r) => ({ text: r.text, heading: r.heading })) }, questions };
}

export async function build({ root, provider, cfg, force = false, dryRun = false, fetchImpl, env }) {
  const sources = findRuleSources(root);
  if (!sources.length) return { ok: false, error: 'no rule source found (project-context.md, AGENTS.md bmad:context block, or persistent_facts)' };
  const seen = new Set();
  const candidates = [];
  for (const s of sources) for (const r of parseRuleLines(s.text, s.file)) if (!seen.has(r.id)) { seen.add(r.id); candidates.push(r); }
  const sourceHash = sha(sources.map((s) => s.text).join('\n\u0000'), 12);
  const scopes = scopeCandidates(root);
  const outFile = path.join(root, GENERATED);
  const prev = readJson(outFile);
  if (dryRun) return { ok: true, dryRun: true, sources: sources.map((s) => s.file), candidates, scopes };
  if (prev && prev.sourceHash === sourceHash && !force) return { ok: true, unchanged: true, file: GENERATED, rules: prev.rules.length };

  const known = new Map((prev?.rules || []).filter((r) => r.kind !== 'unclassified').map((r) => [r.id, r]));
  const todo = candidates.filter((r) => !known.has(r.id));
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  const calls = [];
  const classified = new Map();
  const errors = [];
  await pool(batches, 3, async (batch) => {
    const res = await decide({ provider, cfg, fetchImpl, env, ...classifyRequest(batch, scopes) });
    calls.push(res.meta);
    if (!res.ok) { errors.push(res.error); return; }
    batch.forEach((r, i) => {
      const k = ranked(res.answers[`kind_${i}`]?.probabilities)[0];
      const s = ranked(res.answers[`scope_${i}`]?.probabilities)[0];
      if (!k || !s) return;
      classified.set(r.id, { kind: k.label, kindP: k.p, scope: [s.label], scopeP: s.p });
    });
  });

  const rules = candidates.map((r) => {
    if (known.has(r.id)) { const k = known.get(r.id); return { ...r, kind: k.kind, kindP: k.kindP, scope: k.scope, scopeP: k.scopeP }; }
    const c = classified.get(r.id);
    return c ? { ...r, ...c } : { ...r, kind: 'unclassified', kindP: null, scope: ['**'], scopeP: null };
  });
  const doc = {
    generatedBy: 'bmad-code-review-jev/rules-build.mjs',
    note: 'Generated: review it, then commit. Do not hand-edit; put corrections in _bmad/custom/jev-rules.json as { "rules": { "<id>": { "kind": "...", "scope": ["..."], "disabled": true } }, "extra": [{ "text": "...", "scope": ["..."] }] }.',
    provider, model: calls.find((c) => c.model)?.model ?? null, builtAt: new Date().toISOString(),
    sources: sources.map((s) => s.file), sourceHash, scopeOptions: scopes, rules,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  const count = (k) => rules.filter((r) => r.kind === k).length;
  return {
    ok: errors.length === 0, file: GENERATED, rules: rules.length, reused: candidates.length - todo.length, classifiedNow: classified.size,
    semantic: count('semantic'), mechanical: count('mechanical'), notARule: count('not_a_rule'), unclassified: count('unclassified'),
    errors: [...new Set(errors)], costUsd: calls.reduce((a, c) => a + (c.cost || 0), 0) || null,
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args['project-root'] || process.cwd());
  const cfg = loadConfig(SKILL_DIR);
  const provider = resolveProvider({ flag: typeof args.provider === 'string' ? args.provider : undefined, cfg });
  const r = await build({ root, provider, cfg, force: Boolean(args.force), dryRun: Boolean(args['dry-run']) });
  if (r.dryRun) {
    console.log(`sources: ${r.sources.join(', ')}\ncandidate rules: ${r.candidates.length}\nscope options: ${r.scopes.length}`);
    for (const c of r.candidates) console.log(`  ${c.id}  [${c.heading}]  ${c.text.slice(0, 110)}`);
    return;
  }
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
