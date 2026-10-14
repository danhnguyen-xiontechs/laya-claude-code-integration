// classify-findings.mjs — Laya's independent severity check for Claude's verified findings.
//
//   node classify-findings.mjs --findings <pr-<id>.findings.json> [--rules <rules.md>]
//        [--out <pr-<id>.laya.json>] [--mode off|shadow|recheck] [--threshold <0..1>] [--provider laya|jev]
//
// Laya never sees Claude's severity, and severity words are removed from the text it reads.
// Comparison is done here, in code:
//   Laya unavailable / invalid       → keep Claude
//   Laya agrees                      → keep Claude
//   differs, confidence < threshold  → keep Claude, log only (no Claude call)
//   differs, confidence ≥ threshold  → re-check by Claude, once (recheck mode only, max 3 per PR,
//                                      merge-boundary crossings first)
// Nothing here changes a severity. Writes the log (default: next to the findings file,
// pr-<id>.<provider>.json) and prints one summary line plus one line per re-check.
// Exit 0 whatever Laya does; 1 only for bad input.
//
// A/B copy: --provider (else XT_REVIEW_PR_DECIDER / DECISION_PROVIDER / laya.json, default laya) picks
// who answers the same questions over the same state: Laya, or TypeSafe Jev via OpenRouter. Each
// answer carries meta (provider, model, latency, tokens, cost); the summary adds token/cost totals.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  askMerge, askWithRetry, buildMergeQuestion, buildMergeState, buildQuestion, buildState,
  compareOne, counts, extractOverrides, isBlocking, loadConfig, mapLimit, merge, normLabel, pickRechecks,
  providerUp, providerWhere, readFindings, retry, ruleBaseline,
} from './laya-severity.mjs';

export const SCHEMA = 'review-pr-laya/laya@1';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--findings', '--rules', '--out', '--mode', '--threshold', '--provider'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const USAGE = 'Usage: node classify-findings.mjs --findings <file> [--rules <file>] [--out <file>] [--mode off|shadow|recheck] [--threshold <0..1>] [--provider laya|jev]';

export function defaultLogPath(findingsFile, provider = 'laya') {
  return findingsFile.replace(/\.findings\.json$/i, '').replace(/\.json$/i, '') + `.${provider}.json`;
}

/** Runs the check. Returns { log, lines }. Pure apart from fetchImpl (no file writes). */
export async function classify({ findings, pr = null, rulesText = '', cfg, fetchImpl = fetch, env = process.env, now = new Date() }) {
  const provider = cfg.provider ?? 'laya';
  const who = provider === 'jev' ? 'Jev' : 'Laya';
  const base = { schema: SCHEMA, pr, provider, mode: cfg.mode, threshold: cfg.threshold, url: provider === 'jev' ? 'openrouter' : cfg.url, model: provider === 'jev' ? cfg.jevModel : cfg.model, createdAt: now.toISOString() };
  if (cfg.mode === 'off') return { log: null, lines: [`${provider}: off — Claude severities kept`] };

  const up = await providerUp(cfg, { fetchImpl, env });
  const overrides = extractOverrides(rulesText);
  const question = buildQuestion(overrides);
  const t0 = Date.now();
  // The merge question (one call for the whole PR) runs alongside the per-finding severity calls.
  const mergeCall = up
    ? (async () => {
      const s = Date.now();
      const laya = await retry(() => askMerge(cfg, buildMergeState(findings), buildMergeQuestion(), { fetchImpl, env, blockThreshold: cfg.mergeBlockThreshold }));
      return { laya, ms: Date.now() - s };
    })()
    : Promise.resolve({ laya: null, ms: 0 });
  const [answers, mergeAns] = await Promise.all([
    up
      ? mapLimit(findings, 2, async (f) => {
        const s = Date.now();
        const laya = await askWithRetry(cfg, buildState(f), question, { fetchImpl, env });
        return { laya, ms: Date.now() - s };
      })
      : findings.map(() => ({ laya: null, ms: 0 })),
    mergeCall,
  ]);

  const rows = findings.map((f, i) => {
    const { laya, ms } = answers[i];
    const cmp = compareOne(f.severity, laya, cfg.threshold);
    return {
      id: f.id,
      file: f.file ?? null,
      line: f.line ?? null,
      claude: f.severity,
      laya,
      ms,
      rules: ruleBaseline(f),
      status: cmp.status,
      wouldFlag: cmp.wouldFlag,
      // Kept so the log can become evaluation data later (local file; evidence is already redacted).
      input: { rule: f.rule ?? null, issue: f.issue ?? null, evidence: f.evidence ?? null, impact: f.impact ?? null },
    };
  });
  const picked = pickRechecks(rows, { mode: cfg.mode });
  for (const r of rows) {
    r.recheck = picked.has(r.id) ? 'requested' : r.wouldFlag && cfg.mode === 'recheck' ? 'capped' : null;
  }

  const n = (fn) => rows.filter(fn).length;
  const summary = {
    findings: rows.length,
    agree: n((r) => r.status === 'agree'),
    differs: n((r) => r.status === 'differs'),
    lowConfidence: n((r) => r.status === 'differs' && !r.wouldFlag),
    wouldFlag: n((r) => r.wouldFlag),
    rechecks: picked.size,
    capped: n((r) => r.recheck === 'capped'),
    unavailable: n((r) => r.status === 'unavailable'),
    server: up ? 'up' : 'down',
    ms: Date.now() - t0,
  };
  // Tokens and cost of the answered calls (Jev reports them; Laya does not → null). Retried
  // failures are not counted: OpenRouter reports usage only on a successful answer.
  const metas = [...rows.map((r) => r.laya?.meta), mergeAns.laya?.meta].filter(Boolean);
  const tot = (f) => (metas.some((m) => f(m) != null) ? metas.reduce((s, m) => s + (f(m) ?? 0), 0) : null);
  summary.inputTokens = tot((m) => m.usage?.input_tokens);
  summary.outputTokens = tot((m) => m.usage?.output_tokens);
  summary.costUsd = tot((m) => m.cost) == null ? null : Number(tot((m) => m.cost).toFixed(9));
  // Merge: Laya's direct answer vs the rule on Claude's (initial) severities. Logged only —
  // the merge assessment in the report always comes from assess.mjs.
  const layaSevs = rows.map((r) => normLabel(r.laya?.label)).filter(Boolean);
  const mergeLog = {
    laya: mergeAns.laya,
    implied: mergeAns.laya?.label ?? null,
    rule: merge(counts(findings)),
    fromLayaSeverities: layaSevs.length === rows.length ? merge(counts(layaSevs.map((severity) => ({ severity })))) : null,
    ms: mergeAns.ms,
  };
  mergeLog.status = !mergeLog.laya ? 'unavailable' : mergeLog.implied === mergeLog.rule ? 'agree' : 'differs';
  const log = { ...base, warning: cfg.warning, summary, merge: mergeLog, results: rows };

  const lines = [];
  if (!up) {
    lines.push(`${provider}: unavailable (${providerWhere(cfg)}) — Claude severities kept; add "${who} check unavailable" to the report notes`);
    return { log, lines };
  }
  if (cfg.warning) lines.push(`${provider}: note — ${cfg.warning}`);
  for (const r of rows.filter((x) => x.recheck === 'requested')) {
    const cross = isBlocking(r.claude) !== isBlocking(normLabel(r.laya.label)) ? ' [merge boundary]' : '';
    lines.push(`recheck ${r.id}: Claude ${r.claude} → ${who} ${r.laya.label} (${r.laya.confidence.toFixed(2)})${cross} ${r.file ?? ''}${r.line ? `:${r.line}` : ''}`);
  }
  const flagged = cfg.mode === 'recheck' ? ` recheck=${summary.rechecks}${summary.capped ? ` capped=${summary.capped}` : ''}` : ` wouldFlag=${summary.wouldFlag}`;
  lines.push(mergeLog.laya
    ? `${provider} merge: ${mergeLog.laya.label} (P(Blocked) ${mergeLog.laya.pBlock.toFixed(2)}, blocked at ≥ ${mergeLog.laya.threshold}; ${who} top: ${mergeLog.laya.topLabel}); rule on Claude's severities: ${mergeLog.rule} — ${mergeLog.status} (log only)`
    : `${provider} merge: unavailable (log only)`);
  const cost = summary.costUsd != null ? ` tokens=${summary.inputTokens}/${summary.outputTokens} cost=$${summary.costUsd}` : '';
  lines.push(`${provider}: mode=${cfg.mode} findings=${summary.findings} agree=${summary.agree} differs=${summary.differs} low-confidence=${summary.lowConfidence}${flagged} unavailable=${summary.unavailable} ${(summary.ms / 1000).toFixed(1)}s${cost}`);
  return { log, lines };
}

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error, env = process.env, fetchImpl = fetch } = {}) {
  let a;
  try { a = parseArgs(argv); } catch (err) { error(err.message); error(USAGE); return 1; }
  if (a.help) { log(USAGE); return 0; }
  if (!a.findings) { error(USAGE); return 1; }
  try {
    const file = path.resolve(a.findings);
    const { pr, findings } = readFindings(file);
    const cfg = loadConfig({ env, overrides: { provider: a.provider, mode: a.mode, threshold: a.threshold != null ? Number(a.threshold) : undefined } });
    const rulesText = a.rules && fs.existsSync(a.rules) ? fs.readFileSync(a.rules, 'utf8') : '';
    const res = await classify({ findings, pr, rulesText, cfg, fetchImpl, env });
    if (res.log) {
      const out = path.resolve(a.out ?? defaultLogPath(file, cfg.provider));
      fs.writeFileSync(out, JSON.stringify(res.log, null, 2) + '\n');
      res.lines.push(`log: ${out}`);
    }
    for (const l of res.lines) log(l);
    return 0;
  } catch (err) {
    error(`classify-findings: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
