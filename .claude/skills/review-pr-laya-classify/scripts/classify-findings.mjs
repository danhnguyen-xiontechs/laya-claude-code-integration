// classify-findings.mjs — Laya's independent severity check for Claude's verified findings.
//
//   node classify-findings.mjs --findings <pr-<id>.findings.json> [--rules <rules.md>]
//        [--out <pr-<id>.laya.json>] [--mode off|shadow|recheck] [--threshold <0..1>]
//
// Laya never sees Claude's severity, and severity words are removed from the text it reads.
// Comparison is done here, in code:
//   Laya unavailable / invalid       → keep Claude
//   Laya agrees                      → keep Claude
//   differs, confidence < threshold  → keep Claude, log only (no Claude call)
//   differs, confidence ≥ threshold  → re-check by Claude, once (recheck mode only, max 3 per PR,
//                                      merge-boundary crossings first)
// Nothing here changes a severity. Writes the log (default: next to the findings file,
// pr-<id>.laya.json) and prints one summary line plus one line per re-check.
// Exit 0 whatever Laya does; 1 only for bad input.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  alive, askWithRetry, buildQuestion, buildState, compareOne, extractOverrides, isBlocking, loadConfig,
  mapLimit, normLabel, pickRechecks, readFindings, ruleBaseline,
} from './laya-severity.mjs';

export const SCHEMA = 'review-pr-laya/laya@1';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--findings', '--rules', '--out', '--mode', '--threshold'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const USAGE = 'Usage: node classify-findings.mjs --findings <file> [--rules <file>] [--out <file>] [--mode off|shadow|recheck] [--threshold <0..1>]';

export function defaultLogPath(findingsFile) {
  return findingsFile.replace(/\.findings\.json$/i, '').replace(/\.json$/i, '') + '.laya.json';
}

/** Runs the check. Returns { log, lines }. Pure apart from fetchImpl (no file writes). */
export async function classify({ findings, pr = null, rulesText = '', cfg, fetchImpl = fetch, now = new Date() }) {
  const base = { schema: SCHEMA, pr, mode: cfg.mode, threshold: cfg.threshold, url: cfg.url, model: cfg.model, createdAt: now.toISOString() };
  if (cfg.mode === 'off') return { log: null, lines: ['laya: off — Claude severities kept'] };

  const up = await alive(cfg.url, { fetchImpl });
  const question = buildQuestion(extractOverrides(rulesText));
  const t0 = Date.now();
  const answers = up
    ? await mapLimit(findings, 2, async (f) => {
      const s = Date.now();
      const laya = await askWithRetry(cfg, buildState(f), question, { fetchImpl });
      return { laya, ms: Date.now() - s };
    })
    : findings.map(() => ({ laya: null, ms: 0 }));

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
  const log = { ...base, warning: cfg.warning, summary, results: rows };

  const lines = [];
  if (!up) {
    lines.push(`laya: unavailable (no server at ${cfg.url}) — Claude severities kept; add "Laya check unavailable" to the report notes`);
    return { log, lines };
  }
  if (cfg.warning) lines.push(`laya: note — ${cfg.warning}`);
  for (const r of rows.filter((x) => x.recheck === 'requested')) {
    const cross = isBlocking(r.claude) !== isBlocking(normLabel(r.laya.label)) ? ' [merge boundary]' : '';
    lines.push(`recheck ${r.id}: Claude ${r.claude} → Laya ${r.laya.label} (${r.laya.confidence.toFixed(2)})${cross} ${r.file ?? ''}${r.line ? `:${r.line}` : ''}`);
  }
  const flagged = cfg.mode === 'recheck' ? ` recheck=${summary.rechecks}${summary.capped ? ` capped=${summary.capped}` : ''}` : ` wouldFlag=${summary.wouldFlag}`;
  lines.push(`laya: mode=${cfg.mode} findings=${summary.findings} agree=${summary.agree} differs=${summary.differs} low-confidence=${summary.lowConfidence}${flagged} unavailable=${summary.unavailable} ${(summary.ms / 1000).toFixed(1)}s`);
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
    const cfg = loadConfig({ env, overrides: { mode: a.mode, threshold: a.threshold != null ? Number(a.threshold) : undefined } });
    const rulesText = a.rules && fs.existsSync(a.rules) ? fs.readFileSync(a.rules, 'utf8') : '';
    const res = await classify({ findings, pr, rulesText, cfg, fetchImpl });
    if (res.log) {
      const out = path.resolve(a.out ?? defaultLogPath(file));
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
