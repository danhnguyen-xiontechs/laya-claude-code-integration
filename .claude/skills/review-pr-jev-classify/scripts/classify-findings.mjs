// classify-findings.mjs — Laya's independent severity check for Claude's verified findings.
//
//   node classify-findings.mjs --findings <pr-<id>.findings.json> [--rules <rules.md>]
//        [--out <pr-<id>.laya.json>] [--mode off|shadow|recheck] [--threshold <0..1>] [--provider laya|jev]
//        [--policy stable-disagreement|threshold] [--k <2..8>] [--pr <pr-<id>.json>] [--patch <pr-<id>.patch>]
//
// Laya never sees Claude's severity, and severity words are removed from the text it reads.
// Comparison is done here, in code. Two re-check policies:
//   threshold            differs and top probability ≥ threshold → re-check (needs a calibrated threshold)
//   stable-disagreement  the severity question is asked k more times with the option order shuffled;
//                        flag only when all k answers give the same label AND it differs from Claude
//                        AND it crosses the merge boundary (Minor/Suggestion ↔ Critical/Major)
// Either way: re-checks only in recheck mode, once per finding, max 3 per PR (threshold: boundary
// crossings first; stable-disagreement: upward — a possible missed block — first).
// When the PR JSON is next to the findings file (or --pr), two yes/no questions per finding are
// also asked and logged: introduced_by_pr (with the cited line's patch status, computed here) and
// already_raised (with the 3 most similar existing thread passages, picked here by BM25).
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
  askChoice, askMerge, askWithRetry, buildMergeQuestion, buildMergeState, buildQuestion, buildState,
  compareOne, counts, extractOverrides, isBlocking, loadConfig, mapLimit, merge, normLabel, pickRechecks,
  providerUp, providerWhere, readFindings, retry, ruleBaseline,
} from './laya-severity.mjs';
import {
  YES_NO, annotatePatch, buildIntroducedQuestion, buildIntroducedState, buildRaisedQuestion, buildRaisedState,
  citedLineStatus, pickStableRechecks, projectRuleSeverities, projectRuleSeverity, reorderQuestion,
  shuffledOrders, similarThreads, stableFlag, summarizeStability, threadPassages,
} from './finding-questions.mjs';

export const SCHEMA = 'review-pr-laya/laya@1';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--findings', '--rules', '--out', '--mode', '--threshold', '--provider', '--policy', '--k', '--pr', '--patch'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const USAGE = 'Usage: node classify-findings.mjs --findings <file> [--rules <file>] [--out <file>] [--mode off|shadow|recheck] [--threshold <0..1>] [--provider laya|jev] [--policy stable-disagreement|threshold] [--k <2..8>] [--pr <pr json>] [--patch <file>]';

export function defaultLogPath(findingsFile, provider = 'laya') {
  return findingsFile.replace(/\.findings\.json$/i, '').replace(/\.json$/i, '') + `.${provider}.json`;
}

const slim = (a) => (a ? { label: a.label, confidence: a.confidence, probabilities: a.probabilities } : null);

/**
 * Runs the check. Returns { log, lines }. Pure apart from fetchImpl (no file writes).
 * prData = the normalized PR JSON (threads[] used), patchText = the PR's unified diff; without
 * prData the two yes/no questions are skipped.
 */
export async function classify({ findings, pr = null, rulesText = '', cfg, fetchImpl = fetch, env = process.env, now = new Date(), prData = null, patchText = null }) {
  const provider = cfg.provider ?? 'laya';
  const who = provider === 'jev' ? 'Jev' : 'Laya';
  const policy = cfg.policy ?? 'threshold';
  const k = cfg.k ?? 3;
  const base = { schema: SCHEMA, pr, provider, mode: cfg.mode, policy, ...(policy === 'stable-disagreement' ? { k, stabilityScope: cfg.stabilityScope ?? 'all' } : {}), threshold: cfg.threshold, url: provider === 'jev' ? 'openrouter' : cfg.url, model: provider === 'jev' ? cfg.jevModel : cfg.model, createdAt: now.toISOString() };
  if (cfg.mode === 'off') return { log: null, lines: [`${provider}: off — Claude severities kept`] };

  const up = await providerUp(cfg, { fetchImpl, env });
  const overrides = extractOverrides(rulesText);
  const ruleMap = projectRuleSeverities(rulesText);
  const question = buildQuestion(overrides);
  const qs = { introducedByPr: true, alreadyRaised: true, ...(cfg.questions ?? {}) };
  const ctx = prData ? { patch: patchText != null ? annotatePatch(patchText) : null, passages: threadPassages(prData.threads ?? []) } : null;
  const opts = { fetchImpl, env };
  const t0 = Date.now();
  // The merge question (one call for the whole PR) runs alongside the per-finding calls.
  const mergeCall = up
    ? (async () => {
      const s = Date.now();
      const laya = await retry(() => askMerge(cfg, buildMergeState(findings), buildMergeQuestion(), { ...opts, blockThreshold: cfg.mergeBlockThreshold }));
      return { laya, ms: Date.now() - s };
    })()
    : Promise.resolve({ laya: null, ms: 0 });

  const perFinding = async (f) => {
    const s = Date.now();
    const state = buildState(f);
    const laya = await askWithRetry(cfg, state, question, opts);
    const out = { laya, ms: Date.now() - s, metas: [] };
    // Stability: k more answers with the option order shuffled (deterministic per finding id).
    if (policy === 'stable-disagreement') {
      const crosses = laya && isBlocking(normLabel(laya.label)) !== isBlocking(f.severity);
      if ((cfg.stabilityScope ?? 'all') === 'boundary' && !crosses) {
        out.stability = { skipped: laya ? "first answer does not cross the merge boundary" : 'first answer unavailable' };
      } else {
        const orders = shuffledOrders(f.id, k);
        const samples = [];
        for (const o of orders) samples.push(await askWithRetry(cfg, state, reorderQuestion(question, o), opts));
        out.metas.push(...samples.map((x) => x?.meta));
        out.stability = { ...summarizeStability(samples, orders), samples: samples.map(slim) };
      }
    }
    if (ctx && qs.introducedByPr) {
      const status = ctx.patch ? citedLineStatus(ctx.patch, f) : { kind: 'unknown', text: null };
      if (!status.text) {
        out.introducedByPr = { cited: status.kind, answer: null, reason: 'patch not available' };
      } else {
        const a = await retry(() => askChoice(cfg, buildIntroducedState(f, status), buildIntroducedQuestion(), { ...opts, labels: YES_NO }));
        out.metas.push(a?.meta);
        out.introducedByPr = { cited: status.kind, answer: a?.label ?? null, pYes: a?.probabilities?.yes ?? null };
      }
    }
    if (ctx && qs.alreadyRaised) {
      const similar = similarThreads(f, ctx.passages);
      if (!similar.length) {
        out.alreadyRaised = { answer: 'no', local: true, reason: ctx.passages.length ? 'no similar thread passage' : 'no existing threads', threads: [] };
      } else {
        const a = await retry(() => askChoice(cfg, buildRaisedState(f, similar), buildRaisedQuestion(), { ...opts, labels: YES_NO, maxLen: 1024 }));
        out.metas.push(a?.meta);
        out.alreadyRaised = { answer: a?.label ?? null, pYes: a?.probabilities?.yes ?? null, threads: similar.map(({ threadId, status, score, file, line }) => ({ threadId, status, score, file, line })) };
      }
    }
    return out;
  };

  const [answers, mergeAns] = await Promise.all([
    up ? mapLimit(findings, provider === 'jev' ? 4 : 2, perFinding) : findings.map(() => ({ laya: null, ms: 0, metas: [] })),
    mergeCall,
  ]);

  const rows = findings.map((f, i) => {
    const a = answers[i];
    const cmp = compareOne(f.severity, a.laya, cfg.threshold);
    const projectRule = projectRuleSeverity(f, ruleMap);
    const crosses = cmp.wouldFlag && isBlocking(normLabel(a.laya.label)) !== isBlocking(f.severity);
    const flag = policy === 'stable-disagreement'
      ? stableFlag(f.severity, a.stability)
      : { wouldFlag: cmp.wouldFlag, direction: crosses ? (isBlocking(f.severity) ? 'down' : 'up') : null };
    return {
      id: f.id,
      file: f.file ?? null,
      line: f.line ?? null,
      claude: f.severity,
      laya: a.laya,
      ms: a.ms,
      // Project rules file first (rule id → its default severity, overrides applied), else the frozen baseline.
      rules: projectRule ?? ruleBaseline(f),
      rulesSource: projectRule ? 'project' : 'baseline',
      status: cmp.status,
      ...(a.stability ? { stability: a.stability } : {}),
      wouldFlag: flag.wouldFlag,
      direction: flag.direction,
      ...(a.introducedByPr ? { introducedByPr: a.introducedByPr } : {}),
      ...(a.alreadyRaised ? { alreadyRaised: a.alreadyRaised } : {}),
      // Kept so the log can become evaluation data later (local file; evidence is already redacted).
      input: { rule: f.rule ?? null, issue: f.issue ?? null, evidence: f.evidence ?? null, impact: f.impact ?? null },
    };
  });
  const picked = policy === 'stable-disagreement' ? pickStableRechecks(rows, { mode: cfg.mode }) : pickRechecks(rows, { mode: cfg.mode });
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
    ms: 0,
  };
  if (policy === 'stable-disagreement') {
    const sampled = rows.filter((r) => r.stability && !r.stability.skipped);
    Object.assign(summary, {
      policy, k,
      sampled: sampled.length,
      stable: sampled.filter((r) => r.stability.stable).length,
      unstable: sampled.filter((r) => !r.stability.stable).length,
      stableDisagree: n((r) => r.wouldFlag),
      flagsUp: n((r) => r.wouldFlag && r.direction === 'up'),
      flagsDown: n((r) => r.wouldFlag && r.direction === 'down'),
    });
  } else summary.policy = policy;
  const tally = (key, extra = {}) => {
    const rs = rows.filter((r) => r[key]);
    if (!rs.length) return null;
    return { asked: rs.length, yes: rs.filter((r) => r[key].answer === 'yes').length, no: rs.filter((r) => r[key].answer === 'no').length, unavailable: rs.filter((r) => !r[key].answer).length, ...extra };
  };
  const intro = tally('introducedByPr');
  if (intro) {
    intro.cited = {};
    for (const r of rows) if (r.introducedByPr) intro.cited[r.introducedByPr.cited] = (intro.cited[r.introducedByPr.cited] ?? 0) + 1;
  }
  const raised = tally('alreadyRaised', { localNo: n((r) => r.alreadyRaised?.local) });
  if (intro) summary.introducedByPr = intro;
  if (raised) summary.alreadyRaised = raised;
  if (!ctx && up && (qs.introducedByPr || qs.alreadyRaised)) summary.questionsSkipped = 'no PR JSON next to the findings file';
  summary.rulesFromProject = n((r) => r.rulesSource === 'project');
  summary.ms = Date.now() - t0;
  // Tokens and cost of the answered calls (Jev reports them; Laya does not → null). Retried
  // failures are not counted: OpenRouter reports usage only on a successful answer.
  const metas = [...rows.map((r) => r.laya?.meta), ...answers.flatMap((a) => a.metas), mergeAns.laya?.meta].filter(Boolean);
  const tot = (f) => (metas.some((m) => f(m) != null) ? metas.reduce((s, m) => s + (f(m) ?? 0), 0) : null);
  summary.calls = metas.length;
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
  const order = policy === 'stable-disagreement' ? [...picked] : rows.filter((x) => x.recheck === 'requested').map((x) => x.id);
  for (const id of order) {
    const r = rows.find((x) => x.id === id);
    const where = ` ${r.file ?? ''}${r.line ? `:${r.line}` : ''}`;
    if (policy === 'stable-disagreement') {
      lines.push(`recheck ${r.id}: Claude ${r.claude} → ${who} ${r.stability.label} (stable ${r.stability.k}/${r.stability.k}, mean p ${r.stability.meanP?.toFixed(2) ?? '?'}) [merge boundary, ${r.direction === 'up' ? 'possible missed block' : 'possible over-block'}]${where}`);
    } else {
      const cross = isBlocking(r.claude) !== isBlocking(normLabel(r.laya.label)) ? ' [merge boundary]' : '';
      lines.push(`recheck ${r.id}: Claude ${r.claude} → ${who} ${r.laya.label} (${r.laya.confidence.toFixed(2)})${cross}${where}`);
    }
  }
  const flagged = cfg.mode === 'recheck' ? ` recheck=${summary.rechecks}${summary.capped ? ` capped=${summary.capped}` : ''}` : ` wouldFlag=${summary.wouldFlag}`;
  lines.push(mergeLog.laya
    ? `${provider} merge: ${mergeLog.laya.label} (P(Blocked) ${mergeLog.laya.pBlock.toFixed(2)}, blocked at ≥ ${mergeLog.laya.threshold}; ${who} top: ${mergeLog.laya.topLabel}); rule on Claude's severities: ${mergeLog.rule} — ${mergeLog.status} (log only)`
    : `${provider} merge: unavailable (log only)`);
  if (intro || raised) {
    lines.push(`${provider} questions (log only):${intro ? ` introduced_by_pr yes=${intro.yes} no=${intro.no} unavailable=${intro.unavailable}` : ''}${raised ? `${intro ? ';' : ''} already_raised yes=${raised.yes} no=${raised.no} (no similar thread ${raised.localNo}) unavailable=${raised.unavailable}` : ''}`);
  }
  const stab = policy === 'stable-disagreement' ? ` policy=stable-disagreement k=${k} stable=${summary.stable}/${summary.sampled} stable-disagree=${summary.stableDisagree} (up ${summary.flagsUp}, down ${summary.flagsDown})` : ` policy=${policy}`;
  const cost = summary.costUsd != null ? ` tokens=${summary.inputTokens}/${summary.outputTokens} cost=$${summary.costUsd}` : '';
  lines.push(`${provider}: mode=${cfg.mode} findings=${summary.findings} agree=${summary.agree} differs=${summary.differs} low-confidence=${summary.lowConfidence}${flagged} unavailable=${summary.unavailable}${stab} ${(summary.ms / 1000).toFixed(1)}s${cost}`);
  return { log, lines };
}

const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

/** The PR JSON and patch next to the findings file (or given), for the yes/no questions. */
export function loadPrContext(findingsFile, { prFile, patchFile } = {}) {
  const stem = findingsFile.replace(/\.findings\.json$/i, '');
  const pj = prFile ?? `${stem}.json`;
  const prData = fs.existsSync(pj) ? readJsonFile(pj) : null;
  if (!prData) return { prData: null, patchText: null };
  const candidates = [patchFile, `${stem}.patch`, prData.diff?.file].filter(Boolean);
  const pf = candidates.find((p) => fs.existsSync(p));
  return { prData, patchText: pf ? fs.readFileSync(pf, 'utf8') : null };
}

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error, env = process.env, fetchImpl = fetch } = {}) {
  let a;
  try { a = parseArgs(argv); } catch (err) { error(err.message); error(USAGE); return 1; }
  if (a.help) { log(USAGE); return 0; }
  if (!a.findings) { error(USAGE); return 1; }
  try {
    const file = path.resolve(a.findings);
    const { pr, findings } = readFindings(file);
    const cfg = loadConfig({ env, overrides: { provider: a.provider, mode: a.mode, threshold: a.threshold != null ? Number(a.threshold) : undefined, policy: a.policy, k: a.k != null ? Number(a.k) : undefined } });
    const rulesText = a.rules && fs.existsSync(a.rules) ? fs.readFileSync(a.rules, 'utf8') : '';
    const { prData, patchText } = loadPrContext(file, { prFile: a.pr && path.resolve(a.pr), patchFile: a.patch && path.resolve(a.patch) });
    const res = await classify({ findings, pr, rulesText, cfg, fetchImpl, env, prData, patchText });
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
