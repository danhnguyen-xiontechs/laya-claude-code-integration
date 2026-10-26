// Benchmark over the fixed corpus: baseline vs rule-only vs rule+Jev.
//   node scripts/bench.ts            rule arms only (no network)
//   node scripts/bench.ts --live     + real TypeSafe Jev calls (OPENROUTER_API_KEY), at most --max-calls (10)
// Writes reports/bench.json and prints a markdown table.
import fs from 'node:fs';
import { DEFAULTS, byteLen, decideAndBuild, planTrim } from '../../haiku-100k/hooks/trim/core.ts';
import type { Fetcher } from '../../haiku-100k/hooks/trim/core.ts';
import { FIXTURES } from '../tests/fixtures.ts';

const live = process.argv.includes('--live');
const maxCalls = Number(process.argv[process.argv.indexOf('--max-calls') + 1]) || 10;
let calls = 0;
const fetcher: Fetcher = async (url, init) => {
  calls++;
  const r = await fetch(url, init);
  return { ok: r.ok, status: r.status, text: await r.text() };
};
const jev = () => (live && calls < maxCalls ? { key: process.env.OPENROUTER_API_KEY, fetcher, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now: () => Date.now() } : null);

const rows = [];
for (const f of FIXTURES) {
  const status = f.isError ? 'Command FAILED.' : 'Command succeeded (exit code 0).';
  const base = byteLen(f.text);
  const rule = await decideAndBuild({ command: f.command, text: f.text, opt: { ...DEFAULTS, useJev: false }, statusLine: status, rawPath: '~/.claude/smart-context-trimming/raw/x.log' });
  const withJev = await decideAndBuild({ command: f.command, text: f.text, opt: { ...DEFAULTS, useJev: true }, statusLine: status, rawPath: '~/.claude/smart-context-trimming/raw/x.log', jev: jev() });
  const lost = (t: string) => f.critical.filter((c) => !t.includes(c));
  const ruleText = rule.built?.text ?? f.text, jevText = withJev.built?.text ?? f.text;
  rows.push({
    name: f.name, ask: planTrim(f.command, f.text, DEFAULTS).ask.length,
    baseline: base, rule: byteLen(ruleText), jev: byteLen(jevText),
    ruleReduction: +(1 - byteLen(ruleText) / base).toFixed(3), jevReduction: +(1 - byteLen(jevText) / base).toFixed(3),
    unchanged: ruleText === f.text, lostRule: lost(ruleText), lostJev: lost(jevText),
    jevCalled: withJev.jev.called, jevStrategy: withJev.jev.strategy ?? null, jevConfidence: withJev.jev.confidence ?? null,
    jevError: withJev.jev.error ?? null, jevLatencyMs: withJev.jev.latencyMs ?? null, jevReason: withJev.plan.reason,
  });
}
const elig = rows.filter((r) => !r.unchanged);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const summary = {
  live, jevCalls: calls,
  medianRuleReduction: med(elig.map((r) => r.ruleReduction)), medianJevReduction: med(elig.map((r) => r.jevReduction)),
  lostCriticalRule: rows.reduce((s, r) => s + r.lostRule.length, 0), lostCriticalJev: rows.reduce((s, r) => s + r.lostJev.length, 0),
  jevLatencies: rows.filter((r) => r.jevLatencyMs != null).map((r) => r.jevLatencyMs),
};
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/bench.json', JSON.stringify({ summary, rows }, null, 2));
console.log('| fixture | baseline B | rule B (−%) | rule+Jev B (−%) | Jev decision | lost |');
console.log('|---|---:|---:|---:|---|---:|');
for (const r of rows) console.log(`| ${r.name} | ${r.baseline} | ${r.rule} (${Math.round(r.ruleReduction * 100)}%) | ${r.jev} (${Math.round(r.jevReduction * 100)}%) | ${r.jevCalled ? (r.jevError ? `error ${r.jevError}` : `${r.jevStrategy} p=${r.jevConfidence} ${r.jevLatencyMs}ms`) : '—'} | ${r.lostRule.length + r.lostJev.length} |`);
console.log(JSON.stringify(summary));
