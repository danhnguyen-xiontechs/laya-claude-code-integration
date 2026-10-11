// laya-eval.mjs — shadow evaluation and confidence calibration for the Laya severity check.
//
//   node laya-eval.mjs collect --logs <dir> [--out dataset.jsonl]
//       Gathers every *.laya.json (shadow logs) under <dir> into a JSONL dataset, one finding
//       per line, with an empty "human" field. A human then fills "human" with the reference
//       severity (Critical|Major|Minor|Suggestion). Rows can also be added by hand from old
//       reports (rule, issue, evidence, impact, claude, human; Deferred items excluded).
//
//   node laya-eval.mjs run --data dataset.jsonl [--rules <rules.md>] [--split 0.7] [--seed 1]
//                          [--relabel] [--out eval.json]
//       Compares Claude, Laya and the rule baseline against the human labels; picks the
//       threshold on the calibration split and checks it on the held-out split; prints the
//       stop/enable decision. Rows without a Laya answer (or all, with --relabel) are sent to
//       Laya, which must be running then.
//
// The split is a fixed hash of each row's key, so it never changes between runs. Freeze the
// rubric, the input format and the threshold before looking at the held-out numbers.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LABELS, alive, askWithRetry, buildQuestion, buildState, extractOverrides, isBlocking, loadConfig,
  mapLimit, normLabel, ruleBaseline,
} from './laya-severity.mjs';

export const TARGET_PRECISION = 0.5;
export const MAX_FLAGS_PER_PR = 1;
export const MAX_UNAVAILABLE = 0.05;
export const MAX_P95_MS = 10000;

// ---------------------------------------------------------------------------
// collect
// ---------------------------------------------------------------------------

function findLogs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findLogs(p, out);
    else if (e.name.endsWith('.laya.json')) out.push(p);
  }
  return out;
}

export function rowsFromLog(log, file) {
  const prKey = log.pr?.repoId && log.pr?.id != null ? `${log.pr.repoId}#${log.pr.id}` : path.basename(file).replace(/\.laya\.json$/, '');
  return (log.results ?? []).map((r) => ({
    key: `${prKey}/${r.id}`,
    pr: prKey,
    id: r.id,
    ...(r.input ?? {}),
    claude: r.claude,
    final: r.final ?? null,
    laya: r.laya ? { label: r.laya.label, confidence: r.laya.confidence } : null,
    ms: r.ms ?? null,
    human: null,
  }));
}

// ---------------------------------------------------------------------------
// metrics
// ---------------------------------------------------------------------------

/** FNV-1a → [0, 1). */
export function hash01(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 2 ** 32;
}

const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);

/** Accuracy, per-class precision/recall, confusion, merge-boundary errors of pred vs human. */
export function evaluate(rows, pred) {
  const scored = rows.map((r) => ({ h: r.human, p: pred(r) })).filter((x) => x.p);
  const confusion = Object.fromEntries(LABELS.map((h) => [h, Object.fromEntries(LABELS.map((p) => [p, 0]))]));
  for (const { h, p } of scored) confusion[h][p]++;
  const perClass = {};
  for (const l of LABELS) {
    const tp = confusion[l][l];
    const predicted = LABELS.reduce((s, h) => s + confusion[h][l], 0);
    const support = LABELS.reduce((s, p) => s + confusion[l][p], 0);
    perClass[l] = { precision: predicted ? r3(tp / predicted) : null, recall: support ? r3(tp / support) : null, support };
  }
  const humanBlocking = scored.filter((x) => isBlocking(x.h)).length;
  const under = scored.filter((x) => isBlocking(x.h) && !isBlocking(x.p)).length;
  const over = scored.filter((x) => !isBlocking(x.h) && isBlocking(x.p)).length;
  return {
    n: scored.length,
    missing: rows.length - scored.length,
    accuracy: scored.length ? r3(scored.filter((x) => x.h === x.p).length / scored.length) : null,
    perClass,
    confusion,
    boundary: { underBlocking: under, underRate: humanBlocking ? r3(under / humanBlocking) : null, overBlocking: over },
  };
}

/** What re-checks at threshold t would have done on rows. */
export function flagStats(rows, t) {
  const flags = rows.filter((r) => r.laya && r.laya.label !== r.claude && r.laya.confidence >= t);
  const prs = new Set(rows.map((r) => r.pr)).size || 1;
  return {
    threshold: t,
    flags: flags.length,
    flagsPerPr: r3(flags.length / prs),
    precision: flags.length ? r3(flags.filter((r) => r.human === r.laya.label).length / flags.length) : null,
    claudeWrongCaught: flags.filter((r) => r.claude !== r.human).length,
    boundaryCatches: flags.filter((r) => isBlocking(r.claude) !== isBlocking(r.human) && isBlocking(r.laya.label) === isBlocking(r.human)).length,
  };
}

/** Same question for the rule baseline: when rules disagree with Claude, how often is the human with the rules? */
export function ruleDisagreement(rows) {
  const d = rows.filter((r) => r.rules !== r.claude);
  return { disagreements: d.length, precision: d.length ? r3(d.filter((r) => r.human === r.rules).length / d.length) : null };
}

/** Laya accuracy per confidence bin. */
export function reliability(rows) {
  const edges = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const bins = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inBin = rows.filter((r) => r.laya && r.laya.confidence >= edges[i] && r.laya.confidence < edges[i + 1]);
    bins.push({ bin: `${edges[i].toFixed(1)}–${Math.min(1, edges[i + 1]).toFixed(1)}`, n: inBin.length,
      accuracy: inBin.length ? r3(inBin.filter((r) => r.laya.label === r.human).length / inBin.length) : null });
  }
  return bins;
}

export const THRESHOLDS = Array.from({ length: 14 }, (_, i) => r3(0.3 + i * 0.05));

/** Lowest threshold with precision ≥ target and flags/PR ≤ max on the calibration rows, or null. */
export function pickThreshold(calRows) {
  for (const t of THRESHOLDS) {
    const s = flagStats(calRows, t);
    if (s.flags && s.precision >= TARGET_PRECISION && s.flagsPerPr <= MAX_FLAGS_PER_PR) return s;
  }
  return null;
}

/** The full report and decision. rows must have human, claude, laya, rules, split. */
export function report(rows, { latencies = [] } = {}) {
  const cal = rows.filter((r) => r.split === 'calibration');
  const held = rows.filter((r) => r.split === 'held-out');
  const sets = { all: rows, calibration: cal, 'held-out': held };
  const out = { sizes: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length])), classifiers: {} };
  for (const [name, pred] of [['claude', (r) => r.claude], ['laya', (r) => r.laya?.label ?? null], ['rules', (r) => r.rules]]) {
    out.classifiers[name] = { 'held-out': evaluate(held, pred), all: evaluate(rows, pred) };
  }
  out.thresholdSweep = THRESHOLDS.map((t) => flagStats(cal, t));
  const chosen = pickThreshold(cal);
  out.threshold = chosen?.threshold ?? null;
  out.heldOut = chosen ? flagStats(held, chosen.threshold) : null;
  out.ruleDisagreementHeldOut = ruleDisagreement(held);
  out.reliability = reliability(rows);
  const unavailable = rows.filter((r) => !r.laya).length;
  out.unavailableRate = rows.length ? r3(unavailable / rows.length) : null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
  out.latencyMs = { n: sorted.length, p50: pct(0.5), p95: pct(0.95) };

  const stops = [];
  if (!chosen) stops.push(`no threshold reaches precision ≥ ${TARGET_PRECISION} with ≤ ${MAX_FLAGS_PER_PR} flag per PR on the calibration split`);
  if (chosen && !(out.heldOut.precision >= TARGET_PRECISION)) stops.push(`held-out flag precision ${out.heldOut.precision} < ${TARGET_PRECISION}`);
  if (chosen && out.ruleDisagreementHeldOut.precision != null && !(out.heldOut.precision > out.ruleDisagreementHeldOut.precision)) {
    stops.push(`Laya flags (${out.heldOut.precision}) are not more precise than the rule baseline (${out.ruleDisagreementHeldOut.precision})`);
  }
  if (chosen && out.heldOut.boundaryCatches === 0) stops.push('no merge-boundary catch on the held-out split');
  if (out.unavailableRate > MAX_UNAVAILABLE) stops.push(`Laya unavailable/invalid on ${Math.round(out.unavailableRate * 100)}% of findings`);
  if (out.latencyMs.p95 != null && out.latencyMs.p95 > MAX_P95_MS) stops.push(`latency p95 ${out.latencyMs.p95} ms > ${MAX_P95_MS} ms`);
  const warn = [];
  if (held.length < 30) warn.push(`held-out set is small (${held.length}); treat the numbers as indicative`);
  if (rows.filter((r) => isBlocking(r.human)).length < 10) warn.push('fewer than 10 Critical/Major reference labels');
  out.warnings = warn;
  out.stops = stops;
  out.decision = stops.length ? 'do not enable recheck (stay in shadow or remove the Laya step)' : `enable recheck with threshold ${chosen.threshold}`;
  return out;
}

function printReport(o, log) {
  const pc = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  log(`rows: all=${o.sizes.all} calibration=${o.sizes.calibration} held-out=${o.sizes['held-out']}`);
  for (const [name, c] of Object.entries(o.classifiers)) {
    const h = c['held-out'];
    log(`${name.padEnd(6)} held-out acc=${pc(h.accuracy)} Critical/Major missed=${pc(h.boundary.underRate)} over-blocking=${h.boundary.overBlocking}`);
  }
  log(`threshold (calibration): ${o.threshold ?? 'none'}`);
  if (o.heldOut) log(`held-out flags=${o.heldOut.flags} per-PR=${o.heldOut.flagsPerPr} precision=${pc(o.heldOut.precision)} claude-wrong-caught=${o.heldOut.claudeWrongCaught} boundary-catches=${o.heldOut.boundaryCatches}`);
  log(`rule baseline disagreements (held-out): ${o.ruleDisagreementHeldOut.disagreements}, precision=${pc(o.ruleDisagreementHeldOut.precision)}`);
  log(`confidence bins: ${o.reliability.map((b) => `${b.bin}:${b.n ? `${pc(b.accuracy)}/${b.n}` : '—'}`).join('  ')}`);
  log(`unavailable=${pc(o.unavailableRate)} latency p50=${o.latencyMs.p50 ?? '—'}ms p95=${o.latencyMs.p95 ?? '—'}ms`);
  for (const w of o.warnings) log(`warning: ${w}`);
  for (const s of o.stops) log(`stop: ${s}`);
  log(`decision: ${o.decision}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--logs', '--out', '--data', '--rules', '--split', '--seed'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '--relabel') a.relabel = true;
    else if (t === '-h' || t === '--help') a.help = true;
    else a._.push(t);
  }
  return a;
}

const USAGE = 'Usage: node laya-eval.mjs collect --logs <dir> [--out dataset.jsonl]\n       node laya-eval.mjs run --data dataset.jsonl [--rules <file>] [--split 0.7] [--seed 1] [--relabel] [--out eval.json]';

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error, env = process.env, fetchImpl = fetch } = {}) {
  const a = parseArgs(argv);
  if (a.help || !a._[0]) { log(USAGE); return a.help ? 0 : 1; }
  try {
    if (a._[0] === 'collect') {
      if (!a.logs) throw new Error('collect needs --logs <dir>');
      const rows = findLogs(path.resolve(a.logs)).flatMap((f) => rowsFromLog(JSON.parse(fs.readFileSync(f, 'utf8')), f));
      const out = path.resolve(a.out ?? 'laya-dataset.jsonl');
      fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
      log(`collected ${rows.length} findings → ${out}. Fill "human" with the reference severity, then run: node laya-eval.mjs run --data ${out}`);
      return 0;
    }
    if (a._[0] !== 'run') throw new Error(`Unknown command "${a._[0]}"`);
    if (!a.data) throw new Error('run needs --data <dataset.jsonl>');
    const all = fs.readFileSync(a.data, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    const rows = [];
    let skipped = 0;
    for (const r of all) {
      const human = normLabel(r.human);
      const claude = normLabel(r.claude);
      if (!human || !claude) { skipped++; continue; }
      rows.push({ ...r, key: r.key ?? `${r.pr ?? 'pr'}/${r.id}`, pr: r.pr ?? 'pr', human, claude,
        laya: r.laya && normLabel(r.laya.label) ? { label: normLabel(r.laya.label), confidence: r.laya.confidence } : null });
    }
    if (!rows.length) throw new Error('no row has both "human" and "claude" severities');
    const seed = String(a.seed ?? 1);
    const split = Number(a.split ?? 0.7);
    for (const r of rows) {
      r.rules = ruleBaseline(r);
      r.split = hash01(`${seed}:${r.key}`) < split ? 'calibration' : 'held-out';
    }
    const latencies = [];
    const todo = rows.filter((r) => a.relabel || !r.laya);
    if (todo.length) {
      const cfg = loadConfig({ env, overrides: { mode: 'shadow' } });
      if (!(await alive(cfg.url, { fetchImpl }))) throw new Error(`${todo.length} rows need a Laya answer but no server answers at ${cfg.url} (start laya-serve)`);
      const question = buildQuestion(extractOverrides(a.rules && fs.existsSync(a.rules) ? fs.readFileSync(a.rules, 'utf8') : ''));
      await mapLimit(todo, 2, async (r) => {
        const t0 = Date.now();
        const ans = await askWithRetry(cfg, buildState(r), question, { fetchImpl });
        latencies.push(Date.now() - t0);
        r.laya = ans ? { label: ans.label, confidence: ans.confidence } : null;
      });
    }
    const o = { skipped, ...report(rows, { latencies }) };
    if (skipped) log(`skipped ${skipped} rows without a human or claude label`);
    printReport(o, log);
    const out = path.resolve(a.out ?? a.data.replace(/\.jsonl$/i, '') + '.eval.json');
    fs.writeFileSync(out, JSON.stringify({ ...o, rows: rows.map(({ key, split: s, claude, human, rules, laya }) => ({ key, split: s, claude, human, rules, laya })) }, null, 2) + '\n');
    log(`report: ${out}`);
    return 0;
  } catch (err) {
    error(`laya-eval: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
