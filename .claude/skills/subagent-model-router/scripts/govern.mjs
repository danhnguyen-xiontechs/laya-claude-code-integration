#!/usr/bin/env node
// govern.mjs — route a whole batch of stories, then pass each through the agent-budget-governor.
//
//   node govern.mjs --stories stories.json [--provider none|jev] [--k 1] [--budget 30] [--max-concurrent 3]
//
// stories.json: [{ id, summary, task, type?, risk?: {security,migration,publicContract,ambiguous,files,dependencies}, priority? }]
// The rule tier is the proposed tier; a provider answer (if any) is passed to the governor as
// JEV input (shadow by default: recorded, not executed). Prints one execution_profile per story.
// route.mjs keeps its old behaviour; this is the opt-in governed path.
import fs from 'node:fs';
import { loadConfig, route } from './router.mjs';
import { loadGovernorConfig, createBatch, govern, recordUsage, summary } from './governor.mjs';

const a = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
if (!a.stories) { console.error('usage: govern.mjs --stories stories.json [--provider none|jev]'); process.exit(2); }

const stories = JSON.parse(fs.readFileSync(a.stories, 'utf8'));
const cfg = loadConfig({ overrides: { mode: 'shadow', provider: a.provider, policy: a.provider && a.provider !== 'none' ? 'jev' : undefined, k: a.k ? Number(a.k) : undefined } });
const gcfg = loadGovernorConfig();
const batch = createBatch(gcfg, { budget: a.budget ? Number(a.budget) : undefined, maxConcurrent: a['max-concurrent'] ? Number(a['max-concurrent']) : undefined });

const recs = await Promise.all(stories.map((s) => route({ task: s.task ?? s.summary ?? '', type: s.type ?? '', cfg, source: 'governor' })));
const out = [];
for (const [i, s] of stories.entries()) {
  const r = recs[i];
  const ans = r.answers?.[0];
  const jev = cfg.provider === 'none' ? undefined : (ans && !ans.error ? { tier: ans.tier, confidence: ans.p } : { error: ans?.error ?? 'no answer' });
  if (cfg.provider !== 'none') recordUsage(batch, { units: 0, source: 'actual', kind: 'overhead', note: `routing ${s.id} (JEV cost: see router log)` });
  out.push(govern({ story: s, proposedTier: r.rule?.tier, jev, cfg: gcfg, batch }));
}
console.log(JSON.stringify({ profiles: out, batch: summary(batch) }, null, 2));
