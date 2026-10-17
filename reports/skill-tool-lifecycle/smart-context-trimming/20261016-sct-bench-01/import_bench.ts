// Runs the mod on every fixture and writes the two arms:
//   A = Claude reads the raw output; B = Claude + mod (TypeSafe Jev live, rules as fallback).
// Pass = every critical line of the fixture is still in what Claude reads. Tokens = real count (count_tokens.mjs).
//   node import_bench.ts            (needs OPENROUTER_API_KEY for Jev; without it B is rules only)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULTS, decideAndBuild } from '../../../../smart-context-trimming/hooks/trim-core.ts';
import type { Fetcher } from '../../../../smart-context-trimming/hooks/trim-core.ts';
import { FIXTURES } from '../../../../smart-context-trimming/tests/fixtures.ts';

const dir = import.meta.dirname;
const id = path.basename(dir);
const texts = path.join(dir, 'evidence', 'texts');
fs.mkdirSync(texts, { recursive: true });
const fetcher: Fetcher = async (url, init) => {
  const r = await fetch(url, init);
  return { ok: r.ok, status: r.status, text: await r.text() };
};
const key = process.env.OPENROUTER_API_KEY;
const jev = () => (key ? { key, fetcher, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now: () => Date.now() } : null);

const rows = [];
for (const f of FIXTURES) {
  const t0 = Date.now();
  const out = await decideAndBuild({ command: f.command, text: f.text, opt: { ...DEFAULTS, useJev: !!key },
    statusLine: f.isError ? 'Command FAILED.' : 'Command succeeded (exit code 0).', rawPath: '~/.claude/smart-context-trimming/raw/x.log', jev: jev() });
  const bText = out.built?.text ?? f.text;
  fs.writeFileSync(path.join(texts, `${f.name}.A.txt`), f.text);
  fs.writeFileSync(path.join(texts, `${f.name}.B.txt`), bText);
  rows.push({ f, bText, ms: Date.now() - t0, jev: out.jev, reason: out.plan.reason });
}

const files = rows.flatMap((r) => ['A', 'B'].map((a) => path.join(texts, `${r.f.name}.${a}.txt`)));
const counted = JSON.parse(execFileSync(process.execPath, [path.join(dir, '../../../../.claude/skills/build-skill-tool-workflow/scripts/count_tokens.mjs'), ...files], { encoding: 'utf8', maxBuffer: 16 << 20 }));
fs.writeFileSync(path.join(dir, 'evidence', 'token-count.json'), JSON.stringify(counted, null, 2));
// identical text = identical tokens; the count has ±5 tokens of noise between calls
const same = new Set(rows.filter((r) => r.bText === r.f.text).map((r) => r.f.name));
const tok = (name: string, arm: string) => counted.files[path.join(texts, `${name}.${same.has(name) ? 'A' : arm}.txt`)];

const now = new Date().toISOString();
const write = (folder: string, arm: string, cases: object[]) => {
  const d = path.join(dir, 'runs', folder, 'bench');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'results.json'), JSON.stringify({ experimentId: id, arm, runId: 'bench', startedAt: now, finishedAt: now, cases }, null, 2));
};
const source = `real input tokens via claude -p (${counted.model}), evidence/token-count.json`;
const kase = (r: (typeof rows)[number], arm: 'A' | 'B') => {
  const text = arm === 'A' ? r.f.text : r.bText;
  const lost = r.f.critical.filter((c: string) => !text.includes(c));
  return {
    experimentId: id, caseId: r.f.name, arm, status: lost.length ? 'fail' : 'pass', correct: !lost.length,
    goldOutcome: `${r.f.critical.length} critical lines kept`,
    observedOutcome: lost.length ? `lost ${lost.length}: ${lost.join(' | ')}` : arm === 'A' ? 'raw output' : r.reason,
    usage: { inputTokens: tok(r.f.name, arm), providerCalls: arm === 'B' && r.jev.called ? 1 : 0,
      fallbackCount: arm === 'B' && r.jev.error ? 1 : 0, providerLatencyMs: arm === 'B' ? (r.jev.latencyMs ?? null) : null, source },
    evidenceRefs: [`../../../evidence/texts/${r.f.name}.${arm}.txt`], startedAt: now, finishedAt: now,
  };
};
write('A-claude', 'A', rows.map((r) => kase(r, 'A')));
write('B-claude-jev', 'B', rows.map((r) => kase(r, 'B')));
console.log(`${rows.length} cases, jev ${key ? 'live' : 'off'}, baseline ${counted.baseline} tokens`);
