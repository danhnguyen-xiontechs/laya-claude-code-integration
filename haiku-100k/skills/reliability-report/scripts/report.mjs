#!/usr/bin/env node
// reliability-report: mine Claude Code transcripts (read-only), the agent-reliability runtime dataset and
// telemetry; rebuild failure streaks; simulate what Rule B / Rule C would have caught; optionally label
// streaks with TypeSafe Jev. Zero dependencies. Writes incidents.jsonl + report.md outside any repo.
//
//   node report.mjs [--since <YYYY-MM-DD|all>] [--jev] [--jev-n 60] [--jev-all] [--out <dir>]
//                   [--projects <dir>] [--telemetry <dir>] [--dataset <dir>]
//
// OPENROUTER_API_KEY (env) is needed only for --jev; it is never logged or written.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { redact as sharedRedact } from '../../../hooks/reliability/redact.ts';

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const HOME = os.homedir();
const sinceArg = opt('since', null);
const SINCE = sinceArg === 'all' ? 0 : sinceArg ? Date.parse(sinceArg) : Date.now() - 30 * 864e5;
if (Number.isNaN(SINCE)) { console.error(`bad --since "${sinceArg}" (use YYYY-MM-DD or all)`); process.exit(2); }
const ROOT = opt('projects', path.join(HOME, '.claude', 'projects'));
const OUT = opt('out', path.join(HOME, '.claude', 'agent-reliability', 'dataset'));
const DATASET = opt('dataset', path.join(HOME, '.claude', 'agent-reliability', 'dataset'));
const JEV = flag('jev');
const JEV_N = flag('jev-all') ? Infinity : Number(opt('jev-n', 60));

// ---------- redaction ----------
// One policy for everything that leaves the machine, shared with the runtime hooks (hooks/redact.ts,
// the file haiku-100k ships next to this one). Only the reader's own login is masked here first,
// because the runtime cannot know it.
const USER_RE = (() => { try { const u = os.userInfo().username; return u ? new RegExp(u.split('').map((ch) => ch.toUpperCase() === ch.toLowerCase() && !/[0-9]/.test(ch) ? '[' + ch + ']' : ch).join(''), 'gi') : null; } catch { return null; } })();
const redact = (s, n) => sharedRedact(String(s ?? '').replace(USER_RE ?? /(?!)/g, '<user>'), n);
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 10);
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('\n') : '';
const by = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');

// ---------- command normalisation (classification only; mirrors Step 1 unwrapCommand) ----------
const CD = /^\s*(?:cd|Set-Location|Push-Location)\s+(?:-(?:Path|LiteralPath)\s+)?("[^"]*"|'[^']*'|[^\s;&]+)\s*(?:&&|;)\s*/i;
const TAIL = /\s*\|\s*(?:tail|head)\b[^|]*$|\s*\|\s*Select-Object\s+-(?:Last|First)\s+\d+\s*$/i;
function unwrap(cmd) {
  let core = String(cmd ?? '').trim(), cd = '', piped = false;
  for (let i = 0; i < 4; i++) {
    const m = CD.exec(core);
    if (m) { cd = m[1].replace(/^["']|["']$/g, '').replace(/\\/g, '/').toLowerCase(); core = core.slice(m[0].length); continue; }
    const t = core.replace(/\s*2>&1\s*$/, '').replace(TAIL, '');
    if (t !== core) { piped = piped || TAIL.test(core); core = t.trim(); continue; }
    break;
  }
  return { core: core.replace(/\s+/g, ' '), cd, piped };
}
const COMPOUND = /[;&|<>`$()\n]/;
const ELIGIBLE = /\b(?:npm|pnpm|yarn)\b(?:\s+--prefix\s+\S+)?\s+(?:run\s+)?(?:test|build|lint|typecheck)\b|node\s+--test|\bpytest\b|\bvitest\b|\bjest\b|dotnet\s+(?:test|build)|go\s+test|cargo\s+(?:test|build|check)|\btsc\b|claude\s+plugin\s+(?:test|validate)/i;
const isShell = (t) => t === 'Bash' || t === 'PowerShell';
const normPath = (p) => String(p ?? '').replace(/\\/g, '/').toLowerCase();
function keyOf(tool, input) {
  if (isShell(tool)) { const u = unwrap(input?.command); return `sh:${u.cd}|${u.core}`; }
  if (tool === 'Edit' || tool === 'Write') return `file:${normPath(input?.file_path)}`;
  if (tool === 'NotebookEdit') return `file:${normPath(input?.notebook_path)}`;
  return `${tool}:${JSON.stringify(input ?? {}).slice(0, 300)}`;
}
const fileKey = (k) => k.startsWith('file:');
const jaccard = (a, b) => { const A = new Set(a.split(/\W+/)), B = new Set(b.split(/\W+/)); let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n || 1); };

// ---------- failure classification ----------
const RE_USER = /doesn't want to proceed|tool use was rejected|Permission to use .* has been denied|denied this tool|auto mode classifier|has been denied/i;
const RE_HARNESS = /requires approval|multiple operations|Compound command|isolated in the worktree|has not been read yet|Contains simple_expansion|modifies environment variables|must read .* before|requested permissions to write/i;
function classify(tool, input, text) {
  const t = text.slice(0, 4000), cmd = String(input?.command ?? '');
  if (RE_USER.test(t)) return 'user_denied';
  if (RE_HARNESS.test(t)) return 'harness_refusal';
  if (/hook|PreToolUse|blocked by|Retry blocked \(agent-reliability|Escalation requested/i.test(t) && !/Exit code/.test(t.slice(0, 20))) return 'hook_denied';
  if (/InputValidationError|Invalid tool parameters|is not a valid|Required parameter/i.test(t)) return 'input_validation';
  if (/String to replace not found|old_string.*not found/i.test(t)) return 'edit_not_found';
  if (/Found \d+ matches of the string to replace/i.test(t)) return 'edit_not_unique';
  if (/modified since read|has been modified/i.test(t)) return 'edit_stale';
  if (/File does not exist|ENOENT|no such file|cannot find the path|not found.*path/i.test(t) && !isShell(tool)) return 'file_not_found';
  if (/exceeds maximum allowed tokens|too large|File content \(.*\) exceeds/i.test(t)) return 'file_too_large';
  if (/timed out|timeout/i.test(t)) return 'timeout';
  if (/Interrupted|interrupted by user/i.test(t)) return 'interrupted';
  if (isShell(tool)) {
    const m = /Exit code (-?\d+)/.exec(t); const code = m ? +m[1] : null;
    if (code === 127 || /command not found|is not recognized as/i.test(t)) return 'bash:command_not_found';
    if (/syntax error|unexpected (token|EOF)|ParserError|unterminated|bad substitution/i.test(t)) return 'bash:shell_syntax';
    if (/^\s*(grep|rg|findstr)\b|\|\s*(grep|rg)\b/.test(cmd) && code === 1 && t.length < 200) return 'bash:grep_no_match';
    if (/MODULE_NOT_FOUND|Cannot find module|ModuleNotFoundError|ImportError/i.test(t)) return 'bash:module_not_found';
    if (/No such file|cannot access|ENOENT|cannot find the path|does not exist/i.test(t)) return 'bash:path_not_found';
    if (/permission denied|EACCES|EPERM|Access is denied/i.test(t)) return 'bash:os_permission';
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|\b429\b|\b50[234]\b|rate.?limit|network/i.test(t)) return 'bash:network';
    if (/(npm|pnpm|yarn) (run )?test|node --test|pytest|jest|vitest|dotnet test|go test|cargo test|claude plugin (test|validate)/.test(cmd)) return 'bash:test_fail';
    if (/tsc|build|typecheck|lint|dotnet build|cargo (build|check)/.test(cmd)) return 'bash:build_fail';
    if (/^\s*git\b/.test(cmd)) return 'bash:git';
    if (/^\s*(node|python|npx|tsx)\b/.test(cmd) && /SyntaxError|TypeError|ReferenceError|Error:/.test(t)) return 'bash:script_error';
    if (/^\s*(az|gh|curl)\b/.test(cmd)) return 'bash:cli_api';
    return code != null ? 'bash:exit_other' : 'bash:no_exit_code';
  }
  if (tool.startsWith('mcp__')) return 'mcp_error';
  return `other:${tool}`;
}
const REAL_FAIL = new Set(['bash:test_fail', 'bash:build_fail', 'bash:script_error']);
const brief = (tool, input) => redact(String(input?.command ?? input?.file_path ?? input?.notebook_path ?? input?.pattern ?? JSON.stringify(input ?? {}))).slice(0, 220);

// ---------- scan transcripts ----------
function listJsonl(root) {
  const out = [], skipped = { unreadable_dir: 0 };
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { skipped.unreadable_dir++; return; }
    for (const e of ents) { const q = path.join(dir, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith('.jsonl')) out.push(q); }
  };
  walk(root);
  return { out, skipped };
}

const corpus = { found: 0, read: 0, skipped: {}, badLines: 0, toolCalls: 0, errors: 0, earliest: null, latest: null };
const skip = (why) => { corpus.skipped[why] = (corpus.skipped[why] ?? 0) + 1; };
const errors = [];      // every tool error
const incidents = [];   // streaks >= 2
const calls = { bCaught: [], cCaught: [], bV02: 0 };

function scanFile(q) {
  const st = fs.statSync(q);
  if (st.mtimeMs < SINCE) return skip('older_than_since');
  let raw; try { raw = fs.readFileSync(q, 'utf8'); } catch { return skip('unreadable'); }
  if (!raw.trim()) return skip('empty');
  const sub = /[\\/]subagents[\\/]/.test(q);
  const session = hash(path.basename(q, '.jsonl') + (sub ? 'sub' : ''));
  const proj = hash(path.basename(sub ? path.dirname(path.dirname(path.dirname(q))) : path.dirname(q)));
  const pending = new Map();
  const seq = []; let sawCall = false;
  const failedKeys = new Map();   // Rule B state: key -> true while failing
  const refusals = [];            // Rule C state: { kind, key, tool }
  const flushStreaks = () => {
    for (let i = 0; i < seq.length;) {
      if (!seq[i].err) { i++; continue; }
      let j = i; while (j < seq.length && seq[j].err) j++;
      if (j - i >= 2) {
        const att = seq.slice(i, j), after = seq.slice(j, j + 6);
        incidents.push({
          id: `${session}-${incidents.length}`, session, project: proj, agent: sub ? 'subagent' : 'main', ts: att[0].ts,
          len: att.length, ended_prompt: j >= seq.length,
          before: seq.slice(Math.max(0, i - 3), i).map((s) => ({ tool: s.tool, action: s.action })),
          attempts: att.map((s) => ({ tool: s.tool, action: s.action, cat: s.cat, error: s.text })),
          after: after.map((s) => ({ tool: s.tool, action: s.action, ok: !s.err })),
          kinds: by(att, (s) => s.cat), caught_b: att.filter((s) => s.bCaught).length, caught_c: att.filter((s) => s.cCaught).length,
          recovered: j < seq.length && after.slice(0, 3).every((s) => !s.err),
        });
      }
      i = j;
    }
    seq.length = 0;
  };
  for (const ln of raw.split('\n')) {
    if (!ln) continue; let j; try { j = JSON.parse(ln); } catch { corpus.badLines++; continue; }
    const c = j.message?.content;
    if (j.timestamp) { if (!corpus.latest || j.timestamp > corpus.latest) corpus.latest = j.timestamp; if (!corpus.earliest || j.timestamp < corpus.earliest) corpus.earliest = j.timestamp; }
    if (j.type === 'user' && !j.isMeta && !(Array.isArray(c) && c.some((x) => x.type === 'tool_result'))) {
      const tx = textOf(c);
      if (tx && (!tx.startsWith('<') || tx.includes('<command-args>'))) {
        // a new prompt supersedes streaks and B/harness state; user_denied persists for the session
        flushStreaks(); failedKeys.clear();
        for (let k = refusals.length - 1; k >= 0; k--) if (refusals[k].kind === 'harness_refusal') refusals.splice(k, 1);
      }
      continue;
    }
    if (j.type === 'assistant' && Array.isArray(c)) for (const x of c) if (x.type === 'tool_use') {
      sawCall = true; corpus.toolCalls++;
      const key = keyOf(x.name, x.input);
      const rec = { tool: x.name, input: x.input, key, ts: j.timestamp, bCaught: false, cCaught: false };
      // Rule B v0.3: repeat of an eligible command that already failed with a real failure
      if (isShell(x.name) && ELIGIBLE.test(unwrap(x.input?.command).core) && failedKeys.get(key)) {
        rec.bCaught = true;
        if (!COMPOUND.test(String(x.input?.command ?? ''))) calls.bV02++;
      }
      // Rule C: equivalent of a live refusal
      for (const r of refusals) {
        const same = r.key === key || (r.kind === 'harness_refusal' && isShell(x.name) && isShell(r.tool) && jaccard(r.key, key) >= 0.8);
        if (same) { rec.cCaught = true; rec.cKind = r.kind; break; }
      }
      pending.set(x.id, rec);
    }
    if (j.type === 'user' && Array.isArray(c)) for (const x of c) if (x.type === 'tool_result') {
      const u = pending.get(x.tool_use_id); if (!u) continue;
      const err = !!x.is_error, text = err ? textOf(x.content) : '';
      const cat = err ? classify(u.tool, u.input, text) : 'ok';
      if (err) {
        corpus.errors++;
        errors.push({ session, agent: sub ? 'subagent' : 'main', tool: u.tool, cat });
        if (cat === 'user_denied' || cat === 'harness_refusal') refusals.push({ kind: cat, key: u.key, tool: u.tool });
        if (REAL_FAIL.has(cat)) failedKeys.set(u.key, true);
      } else {
        failedKeys.delete(u.key);
        // a successful form of the same key clears its harness refusals
        for (let k = refusals.length - 1; k >= 0; k--) if (refusals[k].kind === 'harness_refusal' && refusals[k].key === u.key) refusals.splice(k, 1);
      }
      if (u.bCaught) calls.bCaught.push({ session, key: u.key, ok: !err });
      if (u.cCaught) calls.cCaught.push({ session, key: u.key, kind: u.cKind, ok: !err });
      seq.push({ tool: u.tool, action: brief(u.tool, u.input), err, cat, text: err ? redact(text).slice(0, 400) : '', ts: u.ts, bCaught: u.bCaught, cCaught: u.cCaught });
    }
  }
  flushStreaks();
  if (!sawCall) return skip('no_tool_calls');
  corpus.read++;
}

const { out: files, skipped: dirSkips } = fs.existsSync(ROOT) ? listJsonl(ROOT) : { out: [], skipped: {} };
corpus.found = files.length;
if (!fs.existsSync(ROOT)) console.error(`warning: ${ROOT} not found`);
for (const [k, v] of Object.entries(dirSkips)) if (v) corpus.skipped[k] = v;
for (const q of files) { try { scanFile(q); } catch (e) { skip(`error:${String(e.message).slice(0, 40)}`); } }

// ---------- runtime dataset + telemetry ----------
function readJsonlDir(dir, test, sinceMs) {
  const rows = []; let n = 0;
  if (!dir || !fs.existsSync(dir)) return { rows, files: 0 };
  const walk = (d, depth) => { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const q = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(q, depth + 1);
      else if (e.isFile() && test(e.name)) { n++; try { for (const ln of fs.readFileSync(q, 'utf8').split('\n')) { if (!ln) continue; try { const r = JSON.parse(ln); const t = Date.parse(r.ts ?? r.t ?? ''); if (!t || t >= sinceMs) rows.push(r); } catch { /* skip */ } } } catch { /* skip */ } } } };
  walk(dir, 0);
  return { rows, files: n };
}
const attemptsData = readJsonlDir(DATASET, (n) => /^attempts-\d{4}-\d{2}\.jsonl$/.test(n), SINCE);
// The plugin's default telemetry folder is `telemetry/` in its own root, three levels above this script
// (<plugin>/skills/reliability-report/scripts/), for agent-reliability and for the haiku-100k copy alike.
const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const telemetryCandidates = [opt('telemetry', null), process.env.AGENT_RELIABILITY_TELEMETRY_DIR,
  path.join(PLUGIN_ROOT, 'telemetry'), path.join(PLUGIN_ROOT, '..', 'haiku-100k', 'telemetry'),
  path.join(HOME, '.claude', 'agent-reliability', 'telemetry'),
  path.join(HOME, '.claude', 'plugins', 'data', 'haiku-100k', 'telemetry'),
  path.join(HOME, '.claude', 'plugins', 'data', 'agent-reliability', 'telemetry'),
  path.join(process.cwd(), 'agent-reliability', 'telemetry'), path.join(process.cwd(), 'telemetry')].filter(Boolean);
let telemetry = { rows: [], files: 0, dir: null };
for (const d of telemetryCandidates) { const r = readJsonlDir(d, (n) => n.endsWith('.jsonl') && !/^attempts-/.test(n), SINCE); if (r.files) { telemetry = { ...r, dir: redact(d) }; break; } }

// ---------- Jev (copied from integration-verifier decision-provider.mjs decide(), jev branch only) ----------
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
async function decideJev({ state, questions, timeoutMs = 20000 }) {
  const t0 = Date.now(); const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, error: 'OPENROUTER_API_KEY not set', latencyMs: 0, cost: 0 };
  try {
    const r = await fetch(JEV_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: JEV_MODEL, state, questions }), signal: AbortSignal.timeout(timeoutMs) });
    let json = null; try { json = await r.json(); } catch { /* non-JSON */ }
    const latencyMs = Date.now() - t0;
    if (!r.ok) return { ok: false, error: `http ${r.status} ${String(json?.error?.message ?? '').slice(0, 100)}`, status: r.status, latencyMs, cost: 0 };
    const answers = {};
    for (const [n, a] of Object.entries(json?.answers ?? {})) if (a && typeof a === 'object') answers[n] = { probabilities: a.probabilities ?? {}, ...(typeof a.noul === 'number' ? { noul: a.noul } : {}) };
    return { ok: true, answers, status: r.status, latencyMs, cost: json?.usage?.cost ?? 0, tokens: json?.usage?.input_tokens ?? 0 };
  } catch (e) { return { ok: false, error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.message ?? e).split('\n')[0].slice(0, 100), status: null, latencyMs: Date.now() - t0, cost: 0 }; }
}
const QUESTIONS = {
  failure_kind: { type: 'choice', instructions: 'Look at the last entry of `attempts` (the most recent failed tool call and its error text). What kind of failure is it?', criteria: {
    real_failure: 'The command ran and reported a genuine problem in the code or task: a failing test, a compile/type error, a runtime exception in the user\'s code, a wrong result.',
    informational_nonzero: 'A nonzero exit that is normal and carries the answer: grep/rg/findstr found no match, diff found differences, a check printed what it found.',
    harness_refusal: 'The agent harness refused or blocked the call before or instead of running it: needs approval, compound command not allowed, a hook denied it, wrong tool parameters, file not read yet.',
    user_refusal: 'The user rejected the tool call or said not to proceed.',
    agent_mistake: 'The agent made a mechanical mistake in the call itself: wrong path, wrong shell syntax or quoting for this shell, command not installed, wrong flag, edit string not found.',
    environment_or_external: 'Something outside the code: network, rate limit, timeout, missing credentials, service down, browser/page not ready, OS permission.' } },
  same_approach: { type: 'noul', instructions: 'Across `attempts`, is the agent essentially repeating the same approach (same command or same idea with trivial spelling changes) rather than trying a materially different approach each time?' },
  next_step: { type: 'choice', instructions: 'The agent has failed the consecutive `attempts` listed (after the successful `before` calls). What should a supervisor tell the agent to do next?', criteria: {
    RETRY_NEW_STRATEGY: 'The cause is visible in the errors and fixable by the agent: fix the path, quoting, flag, tool choice or code, then continue. Do not repeat the same call.',
    ESCALATE_MODEL: 'The agent keeps failing on a genuine code or design problem it does not seem to understand; a stronger model should diagnose the root cause.',
    ASK_USER: 'Progress needs a human: the user refused, credentials or permissions or a product decision are needed, or the environment must be fixed by the user.',
    MARK_BLOCKED: 'An external blocker (service down, missing access, broken environment) prevents this step; stop retrying it, continue other parts or report the blocker.',
    STOP_AND_REPORT: 'The failing step is not essential or the failures are unrecoverable; stop automatic recovery and report the task as unresolved with what was tried.' } },
};
// The Jev state, redacted field by field. Attempt limits match the runtime advisor (advisorRequest:
// action 220, error 400). `before` is offline only: the runtime advisor sends no before list, so it
// has no runtime limit and 160 is just a cap for the report's own prompt.
const jevState = (inc) => ({
  before: (inc.before ?? []).map((b) => ({ tool: b.tool, action: redact(b.action, 160) })),
  attempts: inc.attempts.slice(0, 2).map((a) => ({ tool: a.tool, action: redact(a.action, 220), error: redact(a.error, 400) })),
});
const topOf = (p = {}) => Object.entries(p).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
const round3 = (p = {}) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +Number(v).toFixed(3)]));
let jevStats = null;
if (JEV) {
  const pool = [...incidents.filter((i) => i.len >= 3), ...incidents.filter((i) => i.len === 2)].slice(0, JEV_N);
  const results = []; let next = 0;
  const worker = async () => { while (next < pool.length) { const inc = pool[next++];
    // Jev is asked at the 2nd failure, exactly like the runtime advisor: first two attempts only.
    const state = jevState(inc);
    const r = await decideJev({ state, questions: QUESTIONS }); results.push(r);
    if (r.ok) { const [fk, fp] = topOf(r.answers.failure_kind?.probabilities), [ns, np] = topOf(r.answers.next_step?.probabilities);
      inc.jev = { label_source: 'jev', failure_kind: fk, failure_kind_p: +fp.toFixed(3), failure_kind_probs: round3(r.answers.failure_kind?.probabilities), same_approach_noul: r.answers.same_approach?.noul ?? null, next_step: ns, next_step_p: +np.toFixed(3), next_step_probs: round3(r.answers.next_step?.probabilities), latency_ms: r.latencyMs, status: r.status }; }
    else { inc.jev_error = r.error; inc.jev_status = r.status ?? null; }
    process.stderr.write('.'); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  const ok = results.filter((r) => r.ok), lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const statuses = {}; for (const r of results) { const k = String(r.status ?? 'none'); statuses[k] = (statuses[k] ?? 0) + 1; }
  jevStats = { asked: results.length, ok: ok.length, failed: results.length - ok.length, statuses, cost: results.reduce((s, r) => s + (r.cost ?? 0), 0), tokens: ok.reduce((s, r) => s + (r.tokens ?? 0), 0), p50: lat[lat.length >> 1] ?? null, p90: lat[Math.floor(lat.length * 0.9)] ?? null, max: lat[lat.length - 1] ?? null, errors: [...new Set(results.filter((r) => !r.ok).map((r) => r.error))].slice(0, 3) };
  process.stderr.write('\n');
  console.log(`jev: ${jevStats.ok}/${jevStats.asked} ok, p50 ${jevStats.p50}ms, ${jevStats.tokens} input tokens, cost $${jevStats.cost.toFixed(4)}`);
}

// ---------- "was the decision useful?" retrospective heuristic ----------
// For a streak labelled at its 2nd failure: what the agent did afterwards, in the transcript.
function usefulness(inc) {
  const a = inc.attempts, d = inc.jev?.next_step; if (!d) return null;
  const extra = inc.len - 2;                                  // failures after the advice point
  const nextAction = a[2]?.action ?? inc.after[0]?.action;
  const changed = nextAction !== undefined && nextAction !== a[1].action;
  const ended = !inc.ended_prompt && inc.recovered === true;
  if (d === 'RETRY_NEW_STRATEGY') {
    if (inc.len > 4) return 'miss';                           // retry advice, streak went on past 4
    return changed && ended ? 'agreed' : 'neutral';
  }
  return extra > 0 ? 'saved_calls' : 'neutral';               // stop/ask/block/escalate while the agent kept failing
}
const useful = incidents.filter((i) => i.jev).map((i) => ({ i, u: usefulness(i) }));

// ---------- dataset-side Jev decisions (runtime, from Step 2.6) ----------
const dsJev = attemptsData.rows.filter((r) => r.jev_decision);
const dsByInc = by(attemptsData.rows.filter((r) => r.incident_id), (r) => r.incident_id);
const dsEvents = by(attemptsData.rows, (r) => r.event ?? '?');

// ---------- outputs ----------
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'incidents.jsonl'), incidents.map((i) => JSON.stringify(i)).join('\n') + (incidents.length ? '\n' : ''));

const cats = sorted(by(errors, (e) => e.cat));
const nCat = (k) => cats.find(([c]) => c === k)?.[1] ?? 0;
const lenHist = by(incidents, (i) => i.len >= 5 ? '5+' : String(i.len));
const subInc = incidents.filter((i) => i.agent === 'subagent').length;
const caughtB = incidents.filter((i) => i.caught_b), caughtC = incidents.filter((i) => i.caught_c);
const caught = incidents.filter((i) => i.caught_b || i.caught_c);
const missed = incidents.filter((i) => i.len >= 3 && !i.caught_b && !i.caught_c);
const kindOfLast = (i) => i.attempts[i.attempts.length - 1].cat;
const cCat = by(calls.cCaught, (c) => c.kind);
const tele = by(telemetry.rows, (r) => r.event ?? '?');
const teleWould = telemetry.rows.filter((r) => r.action === 'would_block').length;
const table = (rows, head) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
const one = (s) => String(s).replace(/\|/g, '\\|').slice(0, 140);

let md = `# Agent reliability report\n\nGenerated ${new Date().toISOString()} · window: ${sinceArg === 'all' ? 'all history' : `since ${new Date(SINCE).toISOString().slice(0, 10)}`} · all text redacted (home paths, long ids, tokens).\n\n`;
md += `## 1. Corpus\n\n${table([
  ['transcript files found', corpus.found], ['files read', corpus.read],
  ['files skipped', Object.entries(corpus.skipped).map(([k, v]) => `${k}: ${v}`).join(', ') || '0'],
  ['unparsable lines ignored', corpus.badLines], ['activity range', `${(corpus.earliest ?? '-').slice(0, 10)} → ${(corpus.latest ?? '-').slice(0, 10)}`],
  ['tool calls', corpus.toolCalls], ['tool errors', `${corpus.errors} (${pct(corpus.errors, corpus.toolCalls)})`],
  ['main / subagent errors', Object.entries(by(errors, (e) => e.agent)).map(([k, v]) => `${k}: ${v}`).join(', ')],
  ['harness refusals', nCat('harness_refusal')], ['user denials', nCat('user_denied')],
  ['failure streaks (≥2 consecutive errors)', `${incidents.length} (${subInc} in subagents)`],
], ['metric', 'value'])}\n`;
md += `## 2. Error categories\n\n${table(cats.slice(0, 25).map(([k, v]) => [k, v, pct(v, corpus.errors)]), ['category', 'errors', 'share'])}\n`;
md += `## 3. Failure streaks\n\nA streak is ≥2 consecutive failed tool calls with no success between, within one prompt of one agent.\n\n${table(Object.entries(lenHist).sort().map(([k, v]) => [k, v]), ['length', 'streaks'])}\n`;
md += `Commonest category of the last failure in a streak:\n\n${table(sorted(by(incidents, kindOfLast)).slice(0, 12).map(([k, v]) => [k, v]), ['category', 'streaks'])}\n`;
md += `Longest streaks: ${incidents.slice().sort((a, b) => b.len - a.len).slice(0, 5).map((i) => `${i.len} (${i.agent}, ${kindOfLast(i)})`).join('; ') || '-'}\n\n`;
md += `## 4. Would-be catches (simulation over the transcripts)\n\nCalls are replayed in order; a call is "caught" if the rule would have denied it at that moment. Catches are *calls the rule would have refused*, not proof the agent would then have recovered.\n\n${table([
  ['Rule B, v0.2 (exact repeat; compound commands not recognised)', `${calls.bV02} calls`, '-'],
  ['Rule B, v0.3 (after unwrapping cd / 2>&1 / tail)', `${calls.bCaught.length} calls`, `${caughtB.length} streaks`],
  ['Rule C, refusal loops', `${calls.cCaught.length} calls (${Object.entries(cCat).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'})`, `${caughtC.length} streaks`],
  ['Either B or C', '-', `${caught.length} of ${incidents.length} streaks (${pct(caught.length, incidents.length)})`],
  ['Streaks ≥3 caught by neither (loops the rules still miss)', '-', `${missed.length}`],
], ['rule', 'calls denied', 'streaks touched'])}\n`;
md += `Missed streaks ≥3 by last-failure category (where Jev or new rules would have to help):\n\n${table(sorted(by(missed, kindOfLast)).slice(0, 10).map(([k, v]) => [k, v]), ['category', 'streaks'])}\n`;
md += `Examples (redacted):\n\n${missed.slice().sort((a, b) => b.len - a.len).slice(0, 6).map((i) => `- ${i.len}× ${i.agent} ${i.attempts[0].tool}: \`${one(i.attempts[0].action)}\` → ${one(i.attempts[0].error).slice(0, 100)}`).join('\n') || '- none'}\n\n`;

md += `## 5. Jev decision distribution\n\n`;
const jevInc = incidents.filter((i) => i.jev);
if (jevInc.length) {
  const n = jevInc.length, med = (a) => a[a.length >> 1];
  const NEXT = Object.keys(QUESTIONS.next_step.criteria), KINDS = Object.keys(QUESTIONS.failure_kind.criteria);
  md += `Offline labels from this run (\`--jev\`, asked at the 2nd failure, \`label_source: jev\`; labels, not ground truth).\n\n`;
  md += `Asked ${jevStats.asked}, answered ${jevStats.ok}, failed ${jevStats.failed}${jevStats.failed ? ` (${jevStats.errors.join('; ')})` : ''}. HTTP status: ${Object.entries(jevStats.statuses).map(([k, v]) => `${k}: ${v}`).join(', ')}. Latency p50 ${jevStats.p50} ms, p90 ${jevStats.p90} ms, max ${jevStats.max} ms. Input tokens ${jevStats.tokens}. Cost $${jevStats.cost.toFixed(4)}.\n\n`;
  // "chosen" = highest-probability option per streak; "mean" = average probability of that option across labelled streaks.
  const probRows = (keys, probKey, pickKey) => keys.map((k) => {
    const chosen = jevInc.filter((i) => i.jev[pickKey] === k).length;
    const mean = jevInc.reduce((s, i) => s + (i.jev[probKey]?.[k] ?? 0), 0) / n;
    return [k, chosen, pct(chosen, n), mean.toFixed(3)];
  });
  md += `next_step, all five options:\n\n${table(probRows(NEXT, 'next_step_probs', 'next_step'), ['next_step', 'chosen', 'share', 'mean probability'])}\n`;
  md += `failure_kind, all six options:\n\n${table(probRows(KINDS, 'failure_kind_probs', 'failure_kind'), ['failure_kind', 'chosen', 'share', 'mean probability'])}\n`;
  const noul = jevInc.map((i) => i.jev.same_approach_noul).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  md += `same_approach (noul, raw value as returned, ${noul.length} answered): ${noul.length ? `min ${noul[0]}, median ${med(noul)}, max ${noul[noul.length - 1]}` : 'none returned'}. No threshold is applied here.\n\n`;
  const topFk = jevInc.map((i) => i.jev.failure_kind_p).sort((a, b) => a - b), topNs = jevInc.map((i) => i.jev.next_step_p).sort((a, b) => a - b);
  md += `Confidence (top probability per streak): failure_kind min ${topFk[0]}, median ${med(topFk)}; next_step min ${topNs[0]}, median ${med(topNs)}.\n\n`;
  md += `failure_kind × next_step (streaks, by chosen label):\n\n${table(KINDS.map((fk) => [fk, ...NEXT.map((ns) => jevInc.filter((i) => i.jev.failure_kind === fk && i.jev.next_step === ns).length)]), ['failure_kind', ...NEXT])}\n`;
  const flagged = jevInc.filter((i) => i.jev.next_step === 'ASK_USER' || i.jev.next_step === 'MARK_BLOCKED');
  md += `ASK_USER / MARK_BLOCKED: ${flagged.length} of ${n} streaks. What the transcript shows after the advice point is in section 6 (retrospective heuristic).\n\n`;
  md += flagged.slice(0, 15).map((i) => `- ${i.jev.next_step} (p=${i.jev.next_step_p}, ${i.jev.failure_kind}) · first call: \`${one(i.attempts[0].action)}\` → ${one(i.attempts[0].error).slice(0, 100)} · further failed calls: ${i.len - 2} · next 3 calls all succeeded: ${i.recovered === true ? 'yes' : 'no'}`).join('\n') || '- none';
  md += flagged.length > 15 ? `\n- … ${flagged.length - 15} more in incidents.jsonl\n\n` : '\n\n';
} else md += `No offline labels in this run (add \`--jev\`; needs OPENROUTER_API_KEY, sends redacted attempts to TypeSafe Jev via OpenRouter and costs money).\n\n`;
if (dsJev.length) md += `Runtime decisions recorded by the plugin (\`attempts-*.jsonl\`, ${dsJev.length} rows):\n\n${table(sorted(by(dsJev, (r) => r.jev_decision)).map(([k, v]) => [k, v]), ['jev_decision', 'rows'])}\n`;
else md += `Runtime dataset: ${attemptsData.files ? `${attemptsData.files} file(s), no Jev decisions yet` : 'no attempts-*.jsonl found yet (written once the plugin runs with datasetCapture on)'}.\n\n`;
if (attemptsData.rows.length) md += `Runtime dataset events: ${Object.entries(dsEvents).map(([k, v]) => `${k}: ${v}`).join(', ')} across ${Object.keys(dsByInc).length} incidents.\n\n`;

md += `## 6. Was the decision useful? (retrospective heuristic, not ground truth)\n\n> Read from the transcript after each labelled streak. A retry followed by a different action and recovery shows the two events are close in time, **not** that the decision caused the recovery. These counts help review decisions; they do not prove them right or wrong.\n\n`;
if (useful.length) {
  const uc = by(useful, (x) => x.u);
  const savedCalls = useful.filter((x) => x.u === 'saved_calls').reduce((s, x) => s + (x.i.len - 2), 0);
  md += table([
    ['agreed', uc.agreed ?? 0, 'RETRY_NEW_STRATEGY, next action differed, streak ended in success'],
    ['saved_calls', uc.saved_calls ?? 0, `non-retry advice, agent kept failing: ${savedCalls} further failed calls would have been avoided`],
    ['miss', uc.miss ?? 0, 'RETRY_NEW_STRATEGY but the streak ran past 4 failures'],
    ['neutral', uc.neutral ?? 0, 'no clear signal either way'],
  ], ['reading', 'streaks', 'rule']) + '\n';
  md += `Misses to review:\n\n${useful.filter((x) => x.u === 'miss').slice(0, 6).map((x) => `- len ${x.i.len} ${x.i.agent}: \`${one(x.i.attempts[0].action)}\``).join('\n') || '- none'}\n\n`;
  const nextDiffers = (i) => { const nx = i.attempts[2]?.action ?? i.after[0]?.action; return nx !== undefined && nx !== i.attempts[1].action; };
  const jevNs = Object.keys(QUESTIONS.next_step.criteria);
  md += `Decision vs what happened next, per recommended action (counts only, same heuristic):\n\n${table(jevNs.map((ns) => {
    const rs = jevInc.filter((i) => i.jev.next_step === ns);
    return [ns, rs.length, rs.reduce((s, i) => s + (i.len - 2), 0), rs.filter(nextDiffers).length, rs.filter((i) => i.recovered === true).length];
  }), ['next_step', 'streaks', 'further failed calls', 'next call differed', 'next 3 calls all succeeded'])}\n`;
} else md += `Needs \`--jev\` labels to compute.\n\n`;

md += `## 7. Telemetry\n\n`;
if (telemetry.files) md += `Folder ${telemetry.dir}: ${telemetry.files} file(s), ${telemetry.rows.length} events. ${Object.entries(tele).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join(', ')}. \`would_block\` actions: ${teleWould}. \`jev_advice\`: ${tele.jev_advice ?? 0}.\n`;
else md += `No telemetry folder found (looked in: ${telemetryCandidates.map(redact).join('; ')}). Pass \`--telemetry <dir>\` if it lives elsewhere.\n`;
fs.writeFileSync(path.join(OUT, 'report.md'), md);

console.log(JSON.stringify({
  window: sinceArg ?? '30d', files_found: corpus.found, files_read: corpus.read, files_skipped: corpus.skipped, bad_lines: corpus.badLines,
  tool_calls: corpus.toolCalls, errors: corpus.errors, harness_refusals: nCat('harness_refusal'), user_denials: nCat('user_denied'),
  streaks: incidents.length, streaks_subagent: subInc, caught_b: caughtB.length, caught_c: caughtC.length, missed_ge3: missed.length,
  calls_denied_b_v03: calls.bCaught.length, calls_denied_b_v02: calls.bV02, calls_denied_c: calls.cCaught.length,
  attempts_rows: attemptsData.rows.length, telemetry_events: telemetry.rows.length, out: redact(OUT),
}, null, 1));
