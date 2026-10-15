#!/usr/bin/env node
// rules-layer.mjs — the "Project Rules (Jev)" review layer for bmad-code-review.
//
//   node rules-layer.mjs --diff <diff_file> --project-root <dir> [--provider jev|laya|kev] [--threshold 0.6]
//
// For every hunk of the diff (added lines only) and every semantic rule whose scope matches the hunk's
// file, asks one Noul: "does the added code violate this rule?". One request per hunk; all rules for
// that hunk are asked together. Pairs with P(yes) >= threshold become findings, printed as a Markdown
// list in the shape bmad-code-review's triage normalizes. Jev never writes text: each finding is
// assembled by this script from the pair it asked about.
//
// Exit code is always 0. When the layer cannot run (no rule set, no key, provider down) it prints a
// line starting with "LAYER FAILED:" so the workflow records it in failed_layers.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, loadConfig, parseArgs, pool, pYes, resolveProvider } from './decision-provider.mjs';
import { effectiveRules, matchesAny, parseDiff, pickLine } from './rules-lib.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUN_DIR = path.join(os.homedir(), '.bmad-jev', 'review-runs');
export const IGNORE = ['**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/*.min.*', '**/*.map', '**/*.snap', '**/*.g.cs', '**/*.designer.cs', '**/Migrations/**', '**/*.svg', '**/*.lock'];

export function hunkRequest(hunk, rules) {
  return {
    state: {
      file: hunk.file,
      added_code: hunk.added.map((a) => `${a.line}: ${a.text}`).join('\n'),
      surrounding_unchanged_code: hunk.context.slice(0, 12).join('\n'),
      rules: rules.map((r) => r.text),
    },
    questions: Object.fromEntries(rules.map((r, k) => [`v_${k}`, {
      type: 'noul',
      instructions: `Does the code added in \`added_code\` (file \`file\`) break the project rule \`rules[${k}]\`? Judge only what the added lines do; \`surrounding_unchanged_code\` is context. Answer no when the rule does not apply to this code or the added code follows it.`,
    }])),
  };
}

export async function runLayer({ root, diffText, provider, cfg, threshold, fetchImpl, env }) {
  const th = threshold ?? cfg.thresholds?.flagMin ?? 0.6;
  const maxPairs = cfg.thresholds?.maxPairs ?? 400;
  const { generated, rules } = effectiveRules(root);
  if (!generated) return { ok: false, error: 'no rule set: run rules-build.mjs first (writes _bmad/custom/jev-rules.generated.json)' };
  const semantic = rules.filter((r) => r.kind === 'semantic');
  if (!semantic.length) return { ok: false, error: 'rule set has no semantic rules' };
  const ignore = [...IGNORE, ...(cfg.ignore || [])];
  const hunks = parseDiff(diffText).filter((h) => !matchesAny(h.file, ignore));
  let budget = maxPairs;
  const jobs = [];
  for (const h of hunks) {
    if (budget <= 0) break;
    const rs = semantic.filter((r) => matchesAny(h.file, r.scope)).slice(0, budget);
    if (!rs.length) continue;
    budget -= rs.length;
    jobs.push({ hunk: h, rules: rs });
  }
  const pairsTotal = hunks.reduce((a, h) => a + semantic.filter((r) => matchesAny(h.file, r.scope)).length, 0);
  const results = await pool(jobs, cfg.concurrency ?? 4, async (job) => ({ job, res: await decide({ provider, cfg, fetchImpl, env, ...hunkRequest(job.hunk, job.rules) }) }));
  const pairs = [];
  const errors = [];
  for (const { job, res } of results) {
    if (!res.ok) { errors.push(res.error); continue; }
    job.rules.forEach((r, k) => {
      const p = pYes(res.answers[`v_${k}`]);
      if (p !== null) pairs.push({ hunk: job.hunk.id, file: job.hunk.file, line: pickLine(job.hunk, r.text), ruleId: r.id, rule: r.text, p });
    });
  }
  const findings = pairs.filter((x) => x.p >= th).sort((a, b) => b.p - a.p).map((x, i) => ({ id: `J${i + 1}`, ...x }));
  const metas = results.map((r) => r.res.meta);
  return {
    ok: errors.length < results.length || results.length === 0,
    provider, model: metas.find((m) => m.model)?.model ?? null, threshold: th,
    stats: { hunks: hunks.length, rules: semantic.length, pairsAsked: pairs.length, pairsInScope: pairsTotal, capped: pairsTotal > maxPairs, calls: results.length, failedCalls: errors.length,
      latencyMsMax: Math.max(0, ...metas.map((m) => m.latencyMs || 0)), costUsd: metas.reduce((a, m) => a + (m.cost || 0), 0) || null },
    errors: [...new Set(errors)], findings, pairs,
  };
}

export function toMarkdown(r) {
  const s = r.stats;
  const head = `Project Rules (Jev) — ${r.provider}${r.model ? ` ${r.model}` : ''}, threshold ${r.threshold}: ${s.hunks} hunks × ${s.rules} semantic rules → ${s.pairsAsked} pairs asked in ${s.calls} calls${s.capped ? ` (capped from ${s.pairsInScope})` : ''}${s.failedCalls ? `, ${s.failedCalls} calls failed` : ''}.`;
  if (!r.findings.length) return `${head}\n\nNo rule violations above the threshold.`;
  const items = r.findings.map((f) => `- **${f.id}** \`${f.file}:${f.line}\` — added code may break project rule ${f.ruleId}: "${f.rule}" (P(violation)=${f.p.toFixed(2)}). Evidence: the added lines of this hunk; check them against the rule before keeping the finding.`);
  return `${head}\n\n${items.join('\n')}`;
}

async function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args['project-root'] || process.cwd());
  const cfg = loadConfig(SKILL_DIR);
  let provider;
  try { provider = resolveProvider({ flag: typeof args.provider === 'string' ? args.provider : undefined, cfg }); }
  catch (e) { console.log(`LAYER FAILED: ${e.message}`); return; }
  if (typeof args.diff !== 'string') { console.log('LAYER FAILED: --diff <file> is required'); return; }
  let diffText;
  try { diffText = fs.readFileSync(args.diff, 'utf8'); } catch { console.log(`LAYER FAILED: cannot read diff file ${args.diff}`); return; }
  const r = await runLayer({ root, diffText, provider, cfg, threshold: args.threshold ? Number(args.threshold) : undefined });
  if (!r.ok) { console.log(`LAYER FAILED: ${r.error || r.errors.join('; ')}`); return; }
  const runFile = path.join(RUN_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(root)}.json`);
  try {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify({ project: path.basename(root), diff: path.basename(args.diff), ...r, verdicts: {} }, null, 2));
  } catch { /* best-effort */ }
  console.log(toMarkdown(r));
  console.log(`\n(run log: ${runFile})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
