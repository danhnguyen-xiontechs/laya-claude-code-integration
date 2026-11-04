// Offline check of the 0.4 Jev Recovery Advisor against hand labels, before jevAdvisor goes to apply.
// Input: incidents.jsonl from the reliability-report skill (redacted streaks from the transcripts).
// Asks exactly what the runtime asks (advisorRequest / parseAdvice / decideNext from hooks/advisor.ts),
// over the incidents the runtime would ask about: 2+ failed attempts, the last one not a refusal.
//
//   node agent-reliability/scripts/eval-advisor.mjs template [--in <incidents.jsonl>] [--out <dir>]
//     writes <out>/labels.csv to fill: one expected action per incident
//     (ASK_USER, MARK_BLOCKED, STOP_AND_REPORT, ESCALATE_MODEL, RETRY_NEW_STRATEGY or NO_ACTION; blank = skip)
//   node agent-reliability/scripts/eval-advisor.mjs live [--in …] [--out …] [--n 40]
//     asks Jev once per incident (OPENROUTER_API_KEY, costs money), keeps the signals in <out>/signals.jsonl
//   node agent-reliability/scripts/eval-advisor.mjs score [--out …]
//     no calls: the labelled incidents against decideNext at thresholds 0.5–0.8, and how often it stays quiet
// Default --in ~/.claude/agent-reliability/dataset/incidents.jsonl, --out the folder of --in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { advisorRequest, decideNext, parseAdvice, refusalOf, SIGNALS } from '../hooks/advisor.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const IN = opt('in', path.join(os.homedir(), '.claude', 'agent-reliability', 'dataset', 'incidents.jsonl'));
const OUT = opt('out', path.dirname(IN));
const ACTIONS = ['ASK_USER', 'MARK_BLOCKED', 'STOP_AND_REPORT', 'ESCALATE_MODEL', 'RETRY_NEW_STRATEGY', 'NO_ACTION'];
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""').replace(/\s+/g, ' ').slice(0, 300)}"`;

/** The incidents the runtime advisor would be asked about, as the runtime Incident shape (first 2 attempts). */
function eligible() {
  return readJsonl(IN)
    .filter((i) => (i.attempts?.length ?? 0) >= 2 && !refusalOf(true, i.attempts[1].error ?? '') && !/\(agent-reliability/.test(i.attempts[1].error ?? ''))
    .map((i) => {
      const atts = i.attempts.slice(0, 2).map((a) => ({ tool: a.tool, action: a.action, error: a.error ?? '', changes: [], errorKey: a.error ?? '' }));
      return { src: i, inc: { id: i.id, action: atts[0].action, fails: 2, strategies: [], attempts: atts } };
    });
}

function readLabels() {
  const f = path.join(OUT, 'labels.csv');
  if (!fs.existsSync(f)) return new Map();
  const rows = fs.readFileSync(f, 'utf8').split('\n').slice(1).filter(Boolean);
  return new Map(rows.map((r) => r.match(/^"([^"]*)","([^"]*)"/)).filter(Boolean).map((m) => [m[1], m[2].trim().toUpperCase()]).filter(([, l]) => ACTIONS.includes(l)));
}

if (cmd === 'template') {
  const rows = eligible().map(({ src }) => [src.id, '', src.attempts[0].action, src.attempts[1].action, (src.attempts[1].error ?? '').slice(-200), src.recovered === true ? 'yes' : 'no'].map(csvCell).join(','));
  fs.writeFileSync(path.join(OUT, 'labels.csv'), `"incident","expected","first_action","second_action","second_error_tail","next_3_calls_ok"\n${rows.join('\n')}\n`);
  console.log(`labels.csv: ${rows.length} incidents to label in ${OUT} (expected: ${ACTIONS.join(' | ')})`);
} else if (cmd === 'live') {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { console.error('OPENROUTER_API_KEY not set'); process.exit(2); }
  const labels = readLabels();
  const all = eligible();
  const pick = (labels.size ? all.filter((x) => labels.has(x.src.id)) : all).slice(0, Number(opt('n', 40)));
  const out = [];
  for (const { inc } of pick) {
    const body = { model: JEV_MODEL, ...advisorRequest(inc, { subagent: false, strategiesUsed: 0, maxStrategies: 2, stateChangedSinceLast: false }) };
    const t0 = Date.now();
    try {
      const r = await fetch(JEV_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const v = parseAdvice(await r.json());
      out.push('error' in v ? { id: inc.id, error: v.error, status: r.status } : { id: inc.id, failure_kind: v.failureKind.choice, signals: v.signals, ms: Date.now() - t0 });
    } catch (e) { out.push({ id: inc.id, error: String(e?.message ?? e).slice(0, 100) }); }
  }
  fs.writeFileSync(path.join(OUT, 'signals.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`signals.jsonl: ${out.filter((r) => r.signals).length}/${out.length} answered`);
} else if (cmd === 'score') {
  const labels = readLabels();
  const sig = readJsonl(path.join(OUT, 'signals.jsonl')).filter((r) => r.signals);
  const used = sig.filter((r) => labels.has(r.id));
  if (!used.length) { console.log('nothing to score: fill labels.csv, then run live'); process.exit(0); }
  for (const t of [0.5, 0.6, 0.7, 0.8]) {
    const got = used.map((r) => [labels.get(r.id), decideNext(r.signals, t, 1).choice]);
    const ok = got.filter(([e, g]) => e === g).length;
    const quiet = got.filter(([, g]) => g === 'NO_ACTION').length;
    const wrongActs = got.filter(([e, g]) => g !== 'NO_ACTION' && e !== g).length;
    console.log(`t=${t}: ${ok}/${got.length} match, quiet ${quiet}, acted wrongly ${wrongActs}`);
  }
  const mean = (k, lab) => { const xs = used.filter((r) => labels.get(r.id) === lab).map((r) => r.signals[k]); return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : '-'; };
  console.log(`\nmean signal by label:\n${['label', ...SIGNALS].join('\t')}`);
  for (const lab of ACTIONS) console.log([lab, ...SIGNALS.map((k) => mean(k, lab))].join('\t'));
} else {
  console.log('usage: eval-advisor.mjs template|live|score [--in <incidents.jsonl>] [--out <dir>] [--n 40]');
  process.exit(2);
}
