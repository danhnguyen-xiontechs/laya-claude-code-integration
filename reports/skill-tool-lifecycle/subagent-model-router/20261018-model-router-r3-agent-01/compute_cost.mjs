// Price-weighted cost per arm from the subagent transcripts (evidence/subagent-usage.json), with retries.
// Usage fields use pricing.mjs: input, output, cache read, cache write at 1.25x input (5 min TTL assumed).
import fs from 'node:fs';
import { usageCost, PRICES } from '../../../../.claude/skills/subagent-model-router/scripts/pricing.mjs';
const u = JSON.parse(fs.readFileSync(new URL('./evidence/subagent-usage.json', import.meta.url), 'utf8'));
const tierOf = (model) => model; // tiers are named in the folder/index below
const idx = JSON.parse(fs.readFileSync(new URL('./evidence/run-index.json', import.meta.url), 'utf8'));
const rows = [];
const cost = (tier, x) => usageCost(tier, {
  input_tokens: x.inputTokens, output_tokens: x.outputTokens,
  cache_read_input_tokens: x.cacheReadTokens, cache_creation_input_tokens: x.cacheWriteTokens,
});
for (const [dir, v] of Object.entries(u)) {
  const name = dir.split(/[\/]/).pop();
  const esc = name.endsWith('.esc');
  const base = esc ? name.slice(0, -4) : name;
  const [caseId, arm, rep] = base.split('.'); // e.g. d5-deps.B.r1
  const tier = esc ? 'sonnet' : (idx.find((e) => e.case === caseId && e.arm === arm && `r${e.rep}` === rep).model);
  rows.push({ name, case: caseId, arm, rep, attempt: esc ? 'escalation' : 'first', tier, usage: v.usage, usd: cost(tier, v.usage) });
}
const sum = (f) => rows.filter(f).reduce((a, r) => a + r.usd, 0);
const tok = (f) => rows.filter(f).reduce((a, r) => a + r.usage.inputTokens + r.usage.outputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens, 0);
const A = (r) => r.arm === 'A';
const B = (r) => r.arm === 'B';
const out = {
  priceRatioHaikuToSonnet: { input: PRICES.haiku.input / PRICES.sonnet.input, output: PRICES.haiku.output / PRICES.sonnet.output },
  A: { usd: sum(A), rawTokens: tok(A), runs: rows.filter(A).length },
  B: { usd: sum(B), rawTokens: tok(B), runs: rows.filter(B).length, firstAttemptUsd: sum((r) => B(r) && r.attempt === 'first'), escalationUsd: sum((r) => B(r) && r.attempt === 'escalation') },
  paired_pct_B_vs_A_usd: null,
  perCase: {},
  rows,
};
out.paired_pct_B_vs_A_usd = +(100 * (out.B.usd / out.A.usd - 1)).toFixed(1);
for (const c of [...new Set(rows.map((r) => r.case))]) {
  const f = (arm) => rows.filter((r) => r.case === c && r.arm === arm);
  out.perCase[c] = { A_usd: +f('A').reduce((a, r) => a + r.usd, 0).toFixed(4), B_usd: +f('B').reduce((a, r) => a + r.usd, 0).toFixed(4), B_tier: idx.find((e) => e.case === c && e.arm === 'B').model };
}
for (const k of ['A', 'B']) out[k].usd = +out[k].usd.toFixed(4);
fs.writeFileSync(new URL('./evidence/cost.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ A: out.A, B: out.B, paired: out.paired_pct_B_vs_A_usd, ratio: out.priceRatioHaikuToSonnet, perCase: out.perCase }, null, 2));
