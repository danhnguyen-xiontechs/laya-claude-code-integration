// replay.mjs — offline A/B of the element-grounding decision: the SAME logged short lists go through Laya and
// Jev with the same question (ground-question.mjs) and the same acceptance gate; nothing touches a browser.
//
//   node replay.mjs collect [--log <ground-jev-log.jsonl|ground-log.jsonl>]... [--all] [--out ab-cases.jsonl]
//       Builds a frozen case file from find.mjs logs: one row per distinct (goal, page, short list), only short lists
//       of >= 2 candidates (the ones a model is asked about; --all also keeps rule-resolved ones). Each row has
//       "gold": null — a human fills it with the right candidate id, or "none" when no candidate fits.
//       Default logs: ~/.ess-web-test/ground-jev-log.jsonl and the original skill's ~/.ess-web-test/ground-log.jsonl.
//
//   node replay.mjs run --cases ab-cases.jsonl [--providers laya,jev] [--out ab-results.json]
//       Asks every provider about every case (sequentially, same order), then prints per provider: answered,
//       accepted by the gate (p >= 0.8, margin >= 0.25), and — on rows with gold — top-1 accuracy, accuracy of
//       accepted picks, wrong accepted picks, latency, tokens and cost. Laya must be running for provider laya
//       (laya-check.mjs starts it); Jev needs OPENROUTER_API_KEY.
//
// Gold labels are never inferred from either model. The case file is the frozen input: re-running `run` on it
// sends byte-identical requests (model sampling aside).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decide, jevReady, PROVIDERS } from './decision-provider.mjs';
import { buildGroundRequest, gate, MAX_LAYA } from './ground-question.mjs';
import { alive, loadConfig } from './laya-lib.mjs';

const STATE_DIR = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.ess-web-test');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));

/** Distinct cases from find.mjs log entries. */
export function collectCases(entries, { all = false } = {}) {
  const seen = new Map();
  for (const e of entries) {
    const shortlist = (e.shortlist || []).slice(0, MAX_LAYA).map(({ id, role, name, hint, disabled }) => ({ id, role, name, hint: hint || '', disabled: !!disabled }));
    if (!e.goal || shortlist.length < (all ? 1 : 2)) continue;
    if (!all && e.by === 'rule') continue; // rules decided it; no model was (or would be) asked
    const key = JSON.stringify([e.goal, e.url, shortlist.map((c) => [c.id, c.role, c.name, c.hint, c.disabled])]);
    if (!seen.has(key)) seen.set(key, { key: `c${seen.size + 1}`, goal: e.goal, url: e.url ?? '', shortlist, liveBy: e.by ?? null, liveChosen: e.chosen ?? null, gold: null });
  }
  return [...seen.values()];
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(0.95 * xs.length))] : null);

/** Per-provider summary of results rows ({ gold, byProvider: { p: { label, accepted, ok, latencyMs, usage, cost } } }). */
export function summarize(rows, provider) {
  const rs = rows.map((r) => ({ gold: r.gold, a: r.byProvider[provider] })).filter((x) => x.a);
  const answered = rs.filter((x) => x.a.ok);
  const gold = answered.filter((x) => x.gold != null);
  const acc = gold.filter((x) => x.a.accepted);
  const lat = answered.map((x) => x.a.latencyMs);
  const sum = (k) => answered.reduce((s, x) => s + (x.a.usage?.[k] ?? 0), 0);
  return {
    provider,
    cases: rs.length,
    answered: answered.length,
    errors: rs.length - answered.length,
    accepted: answered.filter((x) => x.a.accepted).length,
    withGold: gold.length,
    top1Correct: gold.filter((x) => x.a.label === x.gold).length,
    acceptedWithGold: acc.length,
    acceptedCorrect: acc.filter((x) => x.a.label === x.gold).length,
    wrongAccepted: acc.filter((x) => x.a.label !== x.gold).length,
    meanLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    p95LatencyMs: p95(lat),
    inputTokens: sum('input_tokens'),
    outputTokens: sum('output_tokens'),
    costUsd: answered.some((x) => typeof x.a.cost === 'number') ? Number(answered.reduce((s, x) => s + (x.a.cost ?? 0), 0).toFixed(9)) : null,
  };
}

export async function runCases(cases, providers, { cfg = loadConfig(), env = process.env, fetchImpl = fetch } = {}) {
  const rows = [];
  for (const c of cases) {
    const { state, questions } = buildGroundRequest(c.goal, c.url, c.shortlist);
    const byProvider = {};
    for (const provider of providers) {
      const res = await decide({ provider, state, questions, laya: { url: cfg.url, model: cfg.model, maxLen: 768 }, jev: { model: cfg.jevModel }, env, fetchImpl });
      const ans = res.ok ? res.answers.target : null;
      const g = ans ? gate(ans.probabilities) : null;
      byProvider[provider] = {
        ok: !!ans, error: ans ? null : res.error ?? 'no answer', label: g?.label ?? null, p: g?.p ?? null, second: g?.second ?? null,
        accepted: !!g?.accepted, confidence: ans?.confidence ?? null, probabilities: ans?.probabilities ?? null,
        model: res.meta.model, latencyMs: res.meta.latencyMs, usage: res.meta.usage, cost: res.meta.cost,
      };
    }
    rows.push({ key: c.key, goal: c.goal, url: c.url, gold: c.gold ?? null, candidates: c.shortlist.length, byProvider });
  }
  return rows;
}

function parseArgs(argv) {
  const a = { cmd: argv[0], log: [] };
  for (let i = 1; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--log') a.log.push(argv[++i]);
    else if (['--out', '--cases', '--providers'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '--all') a.all = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const USAGE = 'Usage: node replay.mjs collect [--log <file>]... [--all] [--out ab-cases.jsonl]\n       node replay.mjs run --cases ab-cases.jsonl [--providers laya,jev] [--out ab-results.json]';

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error, env = process.env, fetchImpl = fetch } = {}) {
  try {
    const a = parseArgs(argv);
    if (a.cmd === 'collect') {
      const logs = a.log.length ? a.log : ['ground-jev-log.jsonl', 'ground-log.jsonl'].map((f) => path.join(STATE_DIR, f)).filter((f) => fs.existsSync(f));
      const cases = collectCases(logs.flatMap(readJsonl), { all: a.all });
      const out = path.resolve(a.out ?? 'ab-cases.jsonl');
      fs.writeFileSync(out, cases.map((c) => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : ''));
      log(`cases=${cases.length} from ${logs.length} log(s) → ${out}  (fill "gold" with the right candidate id or "none")`);
      return 0;
    }
    if (a.cmd === 'run') {
      if (!a.cases) throw new Error(USAGE);
      const providers = (a.providers ?? 'laya,jev').split(',').map((p) => p.trim().toLowerCase());
      for (const p of providers) if (!PROVIDERS.includes(p)) throw new Error(`unknown provider "${p}"`);
      const cfg = loadConfig();
      if (providers.includes('laya') && !(await alive(cfg.url))) throw new Error(`provider laya: no laya-serve at ${cfg.url} (start it with laya-check.mjs)`);
      if (providers.includes('jev') && !jevReady(env)) throw new Error('provider jev: OPENROUTER_API_KEY not set');
      const cases = readJsonl(a.cases);
      const rows = await runCases(cases, providers, { cfg, env, fetchImpl });
      const summary = providers.map((p) => summarize(rows, p));
      for (const r of rows) {
        log(`${r.key} ${JSON.stringify(r.goal)} gold=${r.gold ?? '-'} ` + providers.map((p) => {
          const x = r.byProvider[p];
          return x.ok ? `${p}=${x.label}@${x.p}${x.accepted ? '✓' : ''}` : `${p}=error(${x.error})`;
        }).join(' '));
      }
      for (const s of summary) {
        log(`${s.provider}: cases=${s.cases} answered=${s.answered} accepted=${s.accepted} | gold=${s.withGold} top1=${pct(s.top1Correct, s.withGold)} accepted-correct=${s.acceptedCorrect}/${s.acceptedWithGold} wrong-accepted=${s.wrongAccepted} | latency mean=${s.meanLatencyMs ?? '-'}ms p95=${s.p95LatencyMs ?? '-'}ms tokens=${s.inputTokens}/${s.outputTokens} cost=${s.costUsd == null ? '-' : `$${s.costUsd}`}`);
      }
      const out = path.resolve(a.out ?? a.cases.replace(/\.jsonl$/i, '') + '.results.json');
      fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), cases: path.resolve(a.cases), providers, summary, rows }, null, 2) + '\n');
      log(`results: ${out}`);
      return 0;
    }
    error(USAGE);
    return 1;
  } catch (err) {
    error(`replay: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
