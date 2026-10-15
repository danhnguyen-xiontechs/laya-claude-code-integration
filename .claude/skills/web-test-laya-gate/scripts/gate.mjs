// Plan 3 — write-action gate: a second opinion on which planned steps change data (D365 is shared).
//
// The agent marks each step `writes: true|false` while planning. This script cross-checks every step
// with a keyword rule and (optional) Laya, and never lowers the agent's flag:
//   agent true                                        → write
//   agent false + writesReason, rule or Laya says write → read, listed as "overruled" (tell the user in one line)
//   agent false/missing, rule or Laya says write       → disputed: the agent must re-check it and set
//                                                        writes:true, or writes:false + writesReason, then re-run
//   all agree read                                    → read
// Measured on 24 held-out step texts (idea/web-test/gate): the keyword rule missed 8/12 writes, Laya 1/12
// but flagged 9/12 reads — so Laya is used to widen recall, the agent's own flag keeps the list short.
//
// Per click (--check-action): right before a click or submit, the same write/read question is asked on the
// concrete action (label / role / url of what is about to be clicked). If it looks like a write while the step is
// marked read, the agent stops and confirms (exit 3, like a dispute) instead of clicking.
//
// Usage:
//   node gate.mjs <runDir>            check the plan, write step.gate into results.json, print the ask-list
//   node gate.mjs <runDir> --check-action "<label/role/url about to be clicked>" --step TC01-S02 [--confirm-read "<why>"]
//                                     right before a click/submit; --confirm-read = the agent re-checked: it only reads
//   node gate.mjs <runDir> --audit    after the run: match recorded write requests (api/netlog.jsonl) to steps
// Output ends with one summary line: gate: steps=N write=W disputed=D read=R overruled=O laya=on|off
//   --check-action prints: gate-action=allow|allow-write|confirmed-read|stop step=<id> marked=read|write rule=<bool> p=<Laya write probability|-> laya=on|off
// Exit code: 0 when nothing is disputed, 3 while disputed steps remain or a checked action must not be clicked yet.
// Every plan and action decision is appended to ~/.ess-web-test/gate-log.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, alive, ask } from './laya-lib.mjs';

const runDir = process.argv[2];
const args = process.argv.slice(3);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i + 1]; };
if (!runDir || !fs.existsSync(path.join(runDir, 'results.json'))) {
  console.error('Usage: node gate.mjs <runDir> [--audit | --check-action "<label/role/url>" --step <TC01-S02> [--confirm-read "<why>"]]   (runDir must contain results.json)');
  process.exit(2);
}
const AUDIT = args.includes('--audit');
const ACTION = opt('--check-action');
const GATE_LOG = path.join(process.env.USERPROFILE || process.env.HOME || '', '.ess-web-test', 'gate-log.jsonl');
const resultsPath = path.join(runDir, 'results.json');
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8').replace(/^\uFEFF/, ''));
const steps = results.cases.flatMap((c) => (c.steps || []).map((s) => ({ c, s, id: `${c.id}-S${String(s.n).padStart(2, '0')}` })));

// Frozen before the held-out check — don't tune on new data without re-checking.
const WRITE_RE = /\b(submit|approve|reject|cancel|withdraw|upload|save|delete|remove|add|create|edit|update|send|confirm|apply|complete|finish|delegate|sign|accept|decline|assign|book|enrol|enroll|register|reset|change)\w*/i;
const LOOK_RE = /\b(check|verify|ensure|confirm that|see|observe|inspect|assert)\b[^;]*\b(button|link|option|tab|is (disabled|enabled|hidden|visible|greyed)|greyed|access is denied|denied)\b/i;
const LAYA_Q = { writes: { type: 'choice', instructions: 'What is the main verb of this test step: one that changes data, or one that only looks at data?',
  criteria: { write: 'Changes data: submit, approve, reject, cancel, withdraw, upload, save, delete, add, create, edit, send, confirm, apply, complete.',
    read: 'Only looks: open, view, navigate, inspect, check, verify, switch view, filter, search, download, read.' } } };
const LAYA_P = 0.5;

const save = () => fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n');
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
function log(entry) {
  try {
    fs.mkdirSync(path.dirname(GATE_LOG), { recursive: true });
    fs.appendFileSync(GATE_LOG, JSON.stringify({ t: new Date().toISOString(), run: path.basename(path.resolve(runDir)), ...entry }) + '\n');
  } catch { /* logging never breaks a run */ }
}
/** Keyword rule + Laya on one text: { rule, laya (write probability or null), write }. */
async function classify(cfg, layaOn, text) {
  const rule = WRITE_RE.test(text) && !LOOK_RE.test(text);
  let laya = null;
  if (layaOn) {
    const ans = await ask(cfg, { step_action: text }, LAYA_Q, { maxLen: 256 });
    if (ans) laya = Number((ans.writes.probabilities.write ?? 0).toFixed(2));
  }
  return { rule, laya, write: rule || (laya !== null && laya >= LAYA_P) };
}

if (AUDIT) audit(); else if (ACTION !== undefined) await checkAction(); else await check();

async function check() {
  const cfg = loadConfig();
  const layaOn = cfg.enabled !== false && (await alive(cfg.url));
  const counts = { write: 0, disputed: 0, read: 0 };
  const listed = [];
  const overruled = [];
  for (const { s, id } of steps) {
    const text = `${s.action || ''}`.trim();
    const { rule, laya } = await classify(cfg, layaOn, text);
    const layaWrite = laya !== null && laya >= LAYA_P;
    let verdict, why;
    if (s.writes === true) { verdict = 'write'; why = 'agent'; }
    else if ((rule || layaWrite) && s.writes === false && s.writesReason) {
      verdict = 'read'; why = `agent overruled (${[rule && 'keyword', layaWrite && `laya ${laya}`].filter(Boolean).join(', ')}): ${s.writesReason}`;
      overruled.push({ id, text, why });
    } else if (rule || layaWrite) {
      verdict = 'disputed';
      why = [rule && 'keyword', layaWrite && `laya ${laya}`, s.writes === undefined ? 'agent did not mark' : 'agent said read'].filter(Boolean).join(', ');
    } else { verdict = 'read'; why = 'all agree'; }
    s.gate = { writes: verdict, rule, laya, agent: s.writes ?? null, why, ...(s.gate?.actions ? { actions: s.gate.actions } : {}) };
    log({ kind: 'plan', step: id, text, rule, laya, agent: s.writes ?? null, verdict });
    counts[verdict]++;
    if (verdict !== 'read') listed.push({ id, verdict, why, text });
  }
  save();
  if (listed.length) {
    console.log(`${pad('step', 9)} ${pad('gate', 9)} ${pad('why', 38)} action`);
    for (const r of listed) console.log(`${pad(r.id, 9)} ${pad(r.verdict, 9)} ${pad(r.why, 38)} ${r.text}`);
  }
  for (const r of overruled) console.log(`overruled ${r.id}: "${r.text}" — ${r.why}`);
  console.log(`gate: steps=${steps.length} write=${counts.write} disputed=${counts.disputed} read=${counts.read} overruled=${overruled.length} laya=${layaOn ? 'on' : 'off'}`);
  if (counts.disputed) process.exitCode = 3;
}

// Right before a click/submit: does this concrete action write, and is its step cleared for writing?
async function checkAction() {
  const text = String(ACTION).trim();
  const m = /^(.+)-S(\d+)$/i.exec(String(opt('--step') ?? '').trim());
  const hit = m && steps.find(({ c, s }) => c.id.toLowerCase() === m[1].toLowerCase() && Number(s.n) === Number(m[2]));
  if (!text || !hit) {
    console.error(`Usage: node gate.mjs <runDir> --check-action "<label/role/url>" --step <TC01-S02> [--confirm-read "<why>"]` +
      (m && !hit ? `\nno step ${opt('--step')} in ${resultsPath}` : ''));
    process.exitCode = 2;
    return;
  }
  const { s, id } = hit;
  const confirmRead = opt('--confirm-read');
  const cfg = loadConfig();
  const layaOn = cfg.enabled !== false && (await alive(cfg.url));
  const { rule, laya, write } = await classify(cfg, layaOn, text);
  const marked = s.writes === true || s.gate?.writes === 'write' ? 'write' : 'read';
  let verdict;
  if (marked === 'write') verdict = 'allow-write'; // the user already OKed this step's writes (Step 2)
  else if (!write) verdict = 'allow';
  else if (confirmRead) verdict = 'confirmed-read';
  else verdict = 'stop';
  s.gate ??= {};
  s.gate.actions = [...(s.gate.actions || []), { t: new Date().toISOString(), action: text, rule, laya, verdict, ...(confirmRead ? { reason: confirmRead } : {}) }];
  save();
  log({ kind: 'action', step: id, text, rule, laya, marked, verdict, ...(confirmRead ? { reason: confirmRead } : {}) });
  console.log(`gate-action=${verdict} step=${id} marked=${marked} rule=${rule} p=${laya ?? '-'} laya=${layaOn ? 'on' : 'off'}`);
  if (verdict === 'stop') {
    console.log(`STOP: "${text}" looks like a write but ${id} is marked read. Do not click yet. If it writes: set writes:true, ` +
      're-run gate.mjs and get the user\'s OK first. If it only reads: re-run this check with --confirm-read "<why>".');
    process.exitCode = 3;
  }
}

function audit() {
  const logPath = path.join(runDir, 'api', 'netlog.jsonl');
  if (!fs.existsSync(logPath)) { console.log('audit: no api/netlog.jsonl (netlog.mjs start was not run) — cannot verify the gate'); return; }
  const reqs = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.method && r.method !== 'GET' && r.method !== 'OPTIONS');
  const timed = steps.filter(({ s }) => s.at).map((x) => ({ ...x, t: Date.parse(x.s.at) })).sort((a, b) => a.t - b.t);
  const findings = [];
  for (const r of reqs) {
    const t = Date.parse(r.t);
    const owner = [...timed].reverse().find((x) => x.t <= t);
    const gw = owner?.s.gate?.writes;
    const line = `${r.method} ${r.path} → ${r.status ?? '?'}`;
    if (!owner) findings.push(`Write request outside any timed step: ${line} at ${r.t}`);
    else if (gw === 'read' || gw === undefined) findings.push(`Gate missed a write: ${owner.id} ("${owner.s.action}") sent ${line}`);
  }
  console.log(`audit: write-requests=${reqs.length} timed-steps=${timed.length}/${steps.length} findings=${findings.length}`);
  for (const f of findings) console.log(`  ${f}`);
  if (findings.length) {
    results.observations = [...(results.observations || []), ...findings.map((f) => `[gate audit] ${f}`)];
    save();
  }
}
