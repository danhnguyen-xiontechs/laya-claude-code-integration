#!/usr/bin/env node
// mine-history.mjs — where did subagent quota go? Mines Claude Code transcripts for Agent/Task calls.
//
//   node mine-history.mjs [--root ~/.claude/projects] [--out ~/.subagent-model-router/history]
//
// Layout (observed on Claude Code 2.1.29x; internal format, may change between versions):
//   <project>/<session>.jsonl                         main thread (isSidechain false)
//   <project>/<session>/subagents/agent-<id>.jsonl    one subagent: first line = its prompt
//   <project>/<session>/subagents/agent-<id>.meta.json { agentType, description, toolUseId, model? }
// An API response is split into one line per content block that all carry the same usage, so usage
// is counted once per message.id.
//
// Writes, OUTSIDE the repo (real prompts stay local):
//   subagents.jsonl — one row per subagent, prompt included (for later routing experiments);
//   summary.json / summary.md — aggregates only, no prompt text (safe to quote).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tierOf, usageCost, PRICES } from './pricing.mjs';
import { ruleFeatures, ruleTier } from './router.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const ROOT = args.root ?? path.join(os.homedir(), '.claude', 'projects');
const OUT = args.out ?? path.join(os.homedir(), '.subagent-model-router', 'history');

/** Coarse task kind from the prompt (first match wins). */
export function taskKind(prompt, type) {
  const t = String(prompt);
  if (/^(explore|claude-code-guide)$/i.test(type)) return 'explore/lookup';
  if (/^plan$/i.test(type)) return 'plan/design';
  if (/\b(review|audit|verify|validate the|check (the|that|whether))\b/i.test(t) && !/\b(fix|implement)\b/i.test(t)) return 'review/verify';
  if (/\b(design|architect|propose|plan)\b/i.test(t)) return 'plan/design';
  if (/\b(research|investigate|compare|summari[sz]e|read and report|docs?)\b/i.test(t) && !/\b(fix|implement|refactor)\b/i.test(t)) return 'research/summarise';
  if (/\b(refactor|migrat|rename|extract)\w*/i.test(t)) return 'refactor/migrate';
  if (/\b(write|add)\b[^.\n]{0,40}\btests?\b/i.test(t)) return 'write tests';
  if (/\b(fix|bug|debug|failing|error)\b/i.test(t)) return 'fix/debug';
  if (/\b(implement|build|create|add|write)\b/i.test(t)) return 'implement';
  if (/\b(find|search|list|locate|where|grep)\b/i.test(t)) return 'explore/lookup';
  if (/\b(test|run|execute)\b/i.test(t)) return 'run/test';
  return 'other';
}

export function readJsonl(f) {
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return out;
}

/** Sum usage per tier over assistant messages, once per message.id. */
function usageByTier(lines, filter = () => true) {
  const seen = new Set();
  const acc = {};
  for (const l of lines) {
    if (l.type !== 'assistant' || !l.message?.usage || !filter(l)) continue;
    const id = l.message.id ?? l.requestId ?? l.uuid;
    if (seen.has(id)) continue;
    seen.add(id);
    const tier = tierOf(l.message.model);
    if (!tier) continue;
    const u = l.message.usage;
    const a = (acc[tier] ??= { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
    a.messages++;
    a.input += u.input_tokens ?? 0;
    a.output += u.output_tokens ?? 0;
    a.cacheRead += u.cache_read_input_tokens ?? 0;
    a.cacheWrite += u.cache_creation_input_tokens ?? 0;
    a.cost += usageCost(tier, u);
  }
  return acc;
}

export function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p;
  }
}

function promptText(first) {
  const c = first?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return '';
}

export function mine(root = ROOT) {
  const subagents = [];
  const main = {};
  for (const f of walk(root)) {
    const isSub = /[\\/]subagents[\\/]agent-[^\\/]+\.jsonl$/.test(f);
    const lines = readJsonl(f);
    if (!isSub) {
      for (const [t, a] of Object.entries(usageByTier(lines, (l) => !l.isSidechain))) {
        const m = (main[t] ??= { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
        for (const k of Object.keys(m)) m[k] += a[k];
      }
      continue;
    }
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* older versions */ }
    const prompt = promptText(lines.find((l) => l.type === 'user'));
    const usage = usageByTier(lines);
    const tiers = Object.keys(usage);
    const cost = Object.values(usage).reduce((s, a) => s + a.cost, 0);
    const type = meta.agentType ?? '';
    const rule = ruleTier(ruleFeatures(prompt, type));
    subagents.push({
      file: f, session: lines[0]?.sessionId ?? null, t: lines[0]?.timestamp ?? null,
      type, description: meta.description ?? null, requestedModel: meta.model ?? null,
      tier: tiers.sort((a, b) => usage[b].cost - usage[a].cost)[0] ?? null, usage, cost,
      turns: Object.values(usage).reduce((s, a) => s + a.messages, 0),
      kind: taskKind(prompt, type), ruleTier: rule.tier, chars: prompt.length, prompt,
    });
  }
  return { subagents, main };
}

const r2 = (x) => Math.round(x * 100) / 100;
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');

export function summarise({ subagents, main }) {
  const by = (key) => {
    const g = {};
    for (const s of subagents) {
      const k = key(s) ?? '?';
      const a = (g[k] ??= { n: 0, cost: 0, turns: 0 });
      a.n++; a.cost += s.cost; a.turns += s.turns;
    }
    return Object.fromEntries(Object.entries(g).sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => [k, { ...v, cost: r2(v.cost) }]));
  };
  const subCost = subagents.reduce((s, x) => s + x.cost, 0);
  const mainCost = Object.values(main).reduce((s, a) => s + a.cost, 0);
  // Counterfactual: same tokens re-priced at the rules router's tier (a rough upper bound on
  // savings: a cheaper model may need more turns, and a wrong downgrade costs a retry).
  let cf = 0;
  for (const s of subagents) for (const a of Object.values(s.usage)) {
    const t = s.ruleTier;
    cf += usageCost(t, { input_tokens: a.input, output_tokens: a.output, cache_read_input_tokens: a.cacheRead, cache_creation_input_tokens: a.cacheWrite });
  }
  const kindByTier = {};
  for (const s of subagents) {
    const k = (kindByTier[s.kind] ??= { haiku: 0, sonnet: 0, opus: 0 });
    if (s.tier) k[s.tier] += s.cost;
  }
  return {
    generated: new Date().toISOString(),
    subagents: subagents.length,
    sessionsWithSubagents: new Set(subagents.map((s) => s.session)).size,
    costUSD: { subagents: r2(subCost), mainThreads: r2(mainCost), subagentShare: pct(subCost, subCost + mainCost) },
    mainByTier: Object.fromEntries(Object.entries(main).map(([k, v]) => [k, { messages: v.messages, cost: r2(v.cost) }])),
    byTier: by((s) => s.tier),
    byType: by((s) => s.type),
    byKind: by((s) => s.kind),
    byRequestedModel: by((s) => s.requestedModel ?? '(none: inherited)'),
    byRuleTier: by((s) => s.ruleTier),
    kindByTier: Object.fromEntries(Object.entries(kindByTier).map(([k, v]) => [k, { haiku: r2(v.haiku), sonnet: r2(v.sonnet), opus: r2(v.opus) }])),
    counterfactualRules: { cost: r2(cf), vsActual: pct(cf, subCost) },
    prices: PRICES,
  };
}

export function toMarkdown(s) {
  const table = (title, g) => [`### ${title}`, '', '| group | subagents | turns | cost (USD, list) | share |', '|---|---:|---:|---:|---:|',
    ...Object.entries(g).map(([k, v]) => `| ${k} | ${v.n} | ${v.turns} | ${v.cost.toFixed(2)} | ${pct(v.cost, s.costUSD.subagents)} |`), ''].join('\n');
  return [
    `# Subagent quota history (${s.generated.slice(0, 10)})`, '',
    `${s.subagents} subagents in ${s.sessionsWithSubagents} sessions. Subagents $${s.costUSD.subagents} vs main threads $${s.costUSD.mainThreads} (subagents = ${s.costUSD.subagentShare} of all spend). Cost = list price, the quota proxy.`, '',
    table('By model tier that ran', s.byTier),
    table('By subagent type', s.byType),
    table('By task kind', s.byKind),
    table('By model the caller requested', s.byRequestedModel),
    table('By what the rules router would pick', s.byRuleTier),
    '### Task kind × tier (USD)', '', '| kind | haiku | sonnet | opus |', '|---|---:|---:|---:|',
    ...Object.entries(s.kindByTier).map(([k, v]) => `| ${k} | ${v.haiku} | ${v.sonnet} | ${v.opus} |`), '',
    `Rules-router counterfactual (same tokens, re-priced): $${s.counterfactualRules.cost} = ${s.counterfactualRules.vsActual} of actual. Upper bound: ignores retries and extra turns on a cheaper model.`, '',
  ].join('\n');
}

if (process.argv[1]?.endsWith('mine-history.mjs')) {
  const data = mine(ROOT);
  const s = summarise(data);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'subagents.jsonl'), data.subagents.map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(s, null, 2));
  fs.writeFileSync(path.join(OUT, 'summary.md'), toMarkdown(s));
  console.log(toMarkdown(s));
  console.log(`(wrote ${OUT})`);
}
