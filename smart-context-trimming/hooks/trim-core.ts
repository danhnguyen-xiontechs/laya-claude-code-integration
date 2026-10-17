// smart-context-trimming core: pure functions, no engine calls.
//
// Bash test/build output → diagnostic candidates (original line ranges) →
// a keep-set chosen by deterministic rules, optionally widened by one TypeSafe
// Jev decision → a compact text built ONLY from original lines.
//
// Jev never writes text: it answers a strategy choice and one yes/no per
// OPTIONAL candidate. Mandatory candidates (errors, failed tests, exception
// heads + first frames, fatal lines, summaries, exit status) are always kept,
// whatever Jev says, so a bad decision can only make the output longer.
//
// Only erasable TypeScript: scripts/bench.ts and tests/*.spec.ts import this
// file under Node's type stripping, so bench, tests and the mod run one copy.

export type Mode = 'observe' | 'enforce' | 'off';

export type Options = {
  mode: Mode;
  minLines: number;
  minBytes: number;
  headLines: number;
  tailLines: number;
  maxJevInputBytes: number;
  maxJevLatencyMs: number;
  minJevConfidence: number;
  useJev: boolean;
  rawOutputTtlHours: number;
};

export const DEFAULTS: Options = {
  mode: 'observe',
  minLines: 250,
  minBytes: 20_000,
  headLines: 5,
  tailLines: 15,
  maxJevInputBytes: 12_000,
  maxJevLatencyMs: 8_000,
  minJevConfidence: 0.6,
  useJev: true,
  rawOutputTtlHours: 24,
};

export const MARK = '[smart-trim]';

// ---------- command classification ----------

export type Category = 'dotnet_test' | 'dotnet_build' | 'js_test' | 'js_build' | 'py_test' | 'other_test' | 'other_build';

const ALLOW: [Category, RegExp][] = [
  ['dotnet_test', /\bdotnet\s+test\b/],
  ['dotnet_build', /\b(dotnet\s+(build|publish|msbuild)|msbuild)\b/],
  ['js_test', /\b((npm|pnpm|yarn|bun)\s+(run\s+)?test\b|npx\s+(jest|vitest|mocha|playwright)\b|\b(jest|vitest|mocha)\b|node\s+--test\b)/],
  ['js_build', /\b((npm|pnpm|yarn|bun)\s+run\s+(build|lint|typecheck)\b|\btsc\b|npx\s+tsc\b|\b(vite|webpack|eslint)\s)/],
  ['py_test', /\b(pytest|python\s+-m\s+(pytest|unittest))\b/],
  ['other_test', /\b(cargo\s+test|go\s+test|mvn\s+(test|verify)|gradle\w*\s+test)\b/],
  ['other_build', /\b(cargo\s+build|go\s+build|mvn\s+(package|compile)|gradle\w*\s+build|make\b)/],
];

/** The user already limited the output, or it is output that must stay exact. */
const EXCLUDE = /\|\s*(head|tail|grep|rg|findstr|Select-String|Select-Object|jq|wc|less|more)\b|>\s*\S|\bgit\s+(diff|show|log)\b|--no-trim\b|SMART_TRIM_SKIP/;

export function classify(command: string): Category | null {
  if (EXCLUDE.test(command)) return null;
  for (const [cat, re] of ALLOW) if (re.test(command)) return cat;
  return null;
}

// ---------- candidates ----------

export type Kind = 'compiler_error' | 'failed_test' | 'exception' | 'fatal' | 'summary' | 'exit_status' | 'warning' | 'stack_tail';

export type Candidate = {
  id: string;
  kind: Kind;
  /** 1-based, inclusive. */
  line_start: number;
  line_end: number;
  mandatory: boolean;
  /** Repeats of the same warning folded into this one (warnings only). */
  repeats?: number;
};

const RE = {
  compilerError: /(\berror\s+[A-Z]{2,}\d{2,}\s*:|\berror\s+TS\d+:|:\s*error\s*:|^\s*error(\[E\d+\])?:|\bSyntaxError\b|\bCS\d{4}\b.*\berror\b)/i,
  failedTest: /^\s*(Failed\s+\S|FAIL\b|✕|✖|×|✗|not ok\b|--- FAIL:|\[FAIL\]|FAILED\s+\S|\d+\)\s.+:$)/,
  failedTestDetail: /^\s*(Error Message|Expected|Actual|Assert|AssertionError|Stack Trace|Received|at |\+|-|E\s{2,}|>\s)/,
  exceptionHead: /\b([A-Z]\w*\.)*[A-Z]\w*(Exception|Error)\b(:|$)|^Traceback \(most recent call last\)|^panic:|Unhandled exception/,
  frame: /^\s+(at\s|File\s"|--- End of|in\s.*:line\s\d+)|^\s{4,}\S.*\(.*:\d+(:\d+)?\)$/,
  fatal: /\b(fatal|FATAL|Build FAILED|BUILD FAILURE|npm ERR!|ERR_|Segmentation fault|OutOfMemory|killed)\b/,
  summary: /(Total tests:|Passed!|Failed!|^\s*Tests?:\s+\d|Test Suites?:|\b\d+\s+(passing|failing|passed|failed|pending|skipped)\b|Build succeeded|\bWarning\(s\)|\bError\(s\)|Time Elapsed|^=+ .*(passed|failed|error).* =+$|^(ok|FAIL)\s+\S+\s+[\d.]+s$|^# (tests|pass|fail)\s+\d|^ℹ (tests|pass|fail)\s+\d)/i,
  exitStatus: /^(Error: )?Exit code \d+/,
  warning: /\bwarn(ing)?\b/i,
};

const FIRST_FRAMES = 6;
const FAILED_DETAIL_MAX = 12;

/** Warning signature: message with paths, numbers and positions stripped. */
function warnSig(line: string): string {
  return line.replace(/[A-Za-z]:\\[^\s:(]+|\/[^\s:(]+/g, '<p>').replace(/\(\d+,\d+\)|:\d+(:\d+)?/g, '').replace(/\d+/g, '#').trim().slice(0, 160);
}

export function extractCandidates(lines: readonly string[]): Candidate[] {
  const out: Candidate[] = [];
  const warnGroups = new Map<string, Candidate>();
  let n = 0;
  const add = (kind: Kind, s: number, e: number, mandatory: boolean): Candidate => {
    const c: Candidate = { id: `c${++n}`, kind, line_start: s + 1, line_end: e + 1, mandatory };
    out.push(c);
    return c;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (!l.trim()) continue;
    if (RE.exitStatus.test(l)) { add('exit_status', i, i, true); continue; }
    if (RE.exceptionHead.test(l) && !RE.frame.test(l) && !RE.summary.test(l)) {
      let j = i;
      while (j + 1 < lines.length && RE.frame.test(lines[j + 1] ?? '')) j++;
      const headEnd = Math.min(j, i + FIRST_FRAMES);
      add('exception', i, headEnd, true);
      if (j > headEnd) add('stack_tail', headEnd + 1, j, false);
      i = j;
      continue;
    }
    if (RE.compilerError.test(l)) { add('compiler_error', i, i, true); continue; }
    if (RE.failedTest.test(l) && !RE.summary.test(l)) {
      let j = i;
      while (j + 1 < lines.length && j - i < FAILED_DETAIL_MAX && (lines[j + 1] ?? '').trim() && (RE.failedTestDetail.test(lines[j + 1] ?? '') || /^\s{2,}\S/.test(lines[j + 1] ?? '')) && !RE.failedTest.test(lines[j + 1] ?? '')) j++;
      add('failed_test', i, j, true);
      i = j;
      continue;
    }
    if (RE.fatal.test(l)) { add('fatal', i, i, true); continue; }
    if (RE.summary.test(l)) { add('summary', i, i, true); continue; }
    if (RE.warning.test(l)) {
      const sig = warnSig(l);
      const g = warnGroups.get(sig);
      if (g) g.repeats = (g.repeats ?? 1) + 1;
      else warnGroups.set(sig, Object.assign(add('warning', i, i, false), { repeats: 1 }));
    }
  }
  return dedupeFailures(lines, out);
}

/** Test name of a failure head line, without marker and duration: "✖ get #3 (0.2ms)" → "get #3". */
function failName(line: string): string {
  return line.replace(/^\s*(✖|✕|×|✗|not ok\s+\d*|FAIL|Failed|FAILED|--- FAIL:|\[FAIL\])\s*/, '').replace(/\s*\([\d.]+\s*m?s\)\s*$/, '').trim();
}
/** What a failure block says (head line excluded), with only line:column positions and durations stripped: different values stay different. */
function failSig(lines: readonly string[], c: Candidate): string {
  return lines.slice(c.line_start, c.line_end).map((l) => l.replace(/:\d+(:\d+)?\b/g, '').replace(/\([\d.]+\s*m?s\)/g, '').trim()).join('\n');
}
const DUP_FULL = 2;

/**
 * Many tests failing for one reason (a shared exception, a broken helper) repeat the same detail block.
 * The first DUP_FULL blocks with a given detail stay whole; later ones keep only their head line (the test
 * name stays visible) and the first block counts them. A one-line failure whose test name reappears later
 * as the head of a detailed block (node --test lists each failure twice) is dropped as a duplicate.
 */
function dedupeFailures(lines: readonly string[], cands: Candidate[]): Candidate[] {
  const blocks = cands.filter((c) => c.kind === 'failed_test');
  const detailed = new Set(blocks.filter((c) => c.line_end > c.line_start).map((c) => failName(lines[c.line_start - 1] ?? '')));
  const seen = new Map<string, Candidate[]>();
  const drop = new Set<Candidate>();
  for (const c of blocks) {
    if (c.line_end === c.line_start) {
      if (detailed.has(failName(lines[c.line_start - 1] ?? ''))) drop.add(c);
      continue;
    }
    const sig = failSig(lines, c);
    if (!sig.trim()) continue;
    const group = seen.get(sig) ?? [];
    if (group.length >= DUP_FULL) {
      c.line_end = c.line_start;
      group[0]!.repeats = (group[0]!.repeats ?? 1) + 1;
    } else group.push(c);
    seen.set(sig, group);
  }
  return cands.filter((c) => !drop.has(c));
}

// ---------- the decision ----------

export type Plan = {
  /** pass: return the tool result untouched. trim: build compact text. */
  action: 'pass' | 'trim';
  reason: string;
  category: Category | null;
  candidates: Candidate[];
  /** Ids kept (mandatory + selected optional). */
  keep: string[];
  /** Optional candidates Jev is asked about (empty → no Jev call needed). */
  ask: Candidate[];
};

export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Rules only. `ask` lists what a Jev call could still change. */
export function planTrim(command: string, text: string, opt: Options): Plan {
  const category = classify(command);
  const base = { category, candidates: [] as Candidate[], keep: [] as string[], ask: [] as Candidate[] };
  if (!category) return { ...base, action: 'pass', reason: 'unmatched_command' };
  const lines = splitLines(text);
  if (lines.length < opt.minLines && byteLen(text) < opt.minBytes) return { ...base, action: 'pass', reason: 'below_threshold' };
  const candidates = extractCandidates(lines);
  const mandatory = candidates.filter((c) => c.mandatory);
  const optional = candidates.filter((c) => !c.mandatory);
  // Nothing recognisable at all: we cannot prove what matters → keep everything.
  if (!mandatory.some((c) => c.kind !== 'exit_status')) return { ...base, candidates, action: 'pass', reason: 'no_recognized_diagnostics' };
  // Rule default for optional: keep the 3 most-repeated warning groups, drop stack tails.
  const warn = optional.filter((c) => c.kind === 'warning').sort((a, b) => (b.repeats ?? 1) - (a.repeats ?? 1)).slice(0, 3);
  const keep = [...mandatory, ...warn].map((c) => c.id);
  const ask = optional.slice(0, 12);
  return { action: 'trim', reason: 'rule', category, candidates, keep, ask };
}

// ---------- redaction ----------

const SECRETS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bsk-or-v1-[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s;,&]+)/gi,
  /\b(AccountKey|SharedAccessKey|Password)=[^;"\s]+/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

export function redact(s: string): string {
  let r = s;
  for (const re of SECRETS) r = r.replace(re, (m) => {
    const eq = m.search(/[=:]\s*|\s/);
    return eq > 0 && eq < 24 && /^[A-Za-z_-]+/.test(m) && !/^(sk|pk|rk|gh|AKIA|eyJ)/.test(m) ? `${m.slice(0, eq + 1)}[REDACTED]` : '[REDACTED]';
  });
  return r;
}

// ---------- Jev contract ----------

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = 'typesafe/jev-1.13';
export const STRATEGIES = ['errors_only', 'errors_and_stack', 'errors_and_warnings', 'keep_full_output'] as const;
export type Strategy = (typeof STRATEGIES)[number];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The decisions request: bounded, redacted candidates only, never the full log. */
export function buildJevRequest(plan: Plan, lines: readonly string[], exitInfo: string, maxBytes: number, model = JEV_MODEL) {
  const textOf = (c: Candidate, n: number) => redact(clip(lines.slice(c.line_start - 1, c.line_end).join('\n'), n));
  const mandatory = plan.candidates.filter((c) => c.mandatory).slice(0, 10);
  let per = 600;
  const mk = () => ({
    schema_version: '1.0',
    command_category: plan.category,
    exit_status: exitInfo,
    output_stats: { line_count: lines.length },
    always_kept: mandatory.map((c) => ({ kind: c.kind, lines: `${c.line_start}-${c.line_end}`, text: textOf(c, 240) })),
    candidates: plan.ask.map((c, i) => ({ index: i, kind: c.kind, lines: `${c.line_start}-${c.line_end}`, repeats: c.repeats ?? 1, text: textOf(c, per) })),
  });
  let state = mk();
  while (byteLen(JSON.stringify(state)) > maxBytes && per > 80) { per = Math.floor(per / 2); state = mk(); }
  const questions: Record<string, unknown> = {
    strategy: {
      type: 'choice',
      instructions: 'A developer must fix this failing or noisy test/build run. `always_kept` is already shown to them. Which trimming strategy keeps the smallest evidence set that is still sufficient to diagnose the problem?',
      criteria: {
        errors_only: 'The always_kept lines (errors, failed tests, first stack frames, summary) are enough.',
        errors_and_stack: 'Deeper stack frames (stack_tail candidates) are also needed.',
        errors_and_warnings: 'Some warnings are related to the failure and are needed.',
        keep_full_output: 'The output cannot be safely trimmed; the full log is needed.',
      },
    },
  };
  plan.ask.forEach((c, i) => {
    questions[`need_${i}`] = { type: 'noul', instructions: `Is \`candidates[${i}]\` (${c.kind}) needed, beyond always_kept, to diagnose the failure?` };
  });
  return { model, state, questions };
}

export type JevDecision = { strategy: Strategy; confidence: number; selected: number[] };

/** Strict validation of the decisions response. Any doubt → null (caller falls back). */
export function parseJevResponse(raw: string, askCount: number): { ok: true; decision: JevDecision } | { ok: false; error: string } {
  let json: any;
  try { json = JSON.parse(raw); } catch { return { ok: false, error: 'invalid_json' }; }
  const a = json?.answers;
  if (!a || typeof a !== 'object') return { ok: false, error: 'no_answers' };
  const s = a.strategy;
  const probs = s?.probabilities;
  if (!probs || typeof probs !== 'object') return { ok: false, error: 'no_strategy' };
  let best: Strategy | null = null, p = -1;
  for (const [k, v] of Object.entries(probs)) {
    if (!(STRATEGIES as readonly string[]).includes(k)) return { ok: false, error: `unknown_strategy:${clip(k, 30)}` };
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) return { ok: false, error: 'bad_probability' };
    if (v > p) { p = v; best = k as Strategy; }
  }
  if (typeof s.choice === 'string' && s.choice !== best && (STRATEGIES as readonly string[]).includes(s.choice)) best = s.choice as Strategy;
  if (!best) return { ok: false, error: 'no_strategy' };
  p = typeof probs[best] === 'number' ? probs[best] : p;
  const selected: number[] = [];
  for (let i = 0; i < askCount; i++) {
    const q = a[`need_${i}`];
    if (!q) return { ok: false, error: `missing_need_${i}` };
    const y = typeof q.noul === 'number' ? q.noul : q.probabilities?.yes ?? q.probabilities?.Yes;
    if (typeof y !== 'number' || !(y >= 0 && y <= 1)) return { ok: false, error: `bad_need_${i}` };
    if (y >= 0.5) selected.push(i);
  }
  for (const k of Object.keys(a)) if (k !== 'strategy' && !/^need_\d+$/.test(k)) return { ok: false, error: 'unexpected_answer' };
  for (const k of Object.keys(a)) if (/^need_\d+$/.test(k) && Number(k.slice(5)) >= askCount) return { ok: false, error: 'index_out_of_range' };
  return { ok: true, decision: { strategy: best, confidence: Number(p.toFixed(4)), selected } };
}

/** Applies a validated decision on top of the rule plan. Mandatory ids can never be dropped. */
export function applyJev(plan: Plan, d: JevDecision, minConfidence: number): Plan {
  if (d.confidence < minConfidence) return { ...plan, reason: 'jev_low_confidence' };
  if (d.strategy === 'keep_full_output') return { ...plan, action: 'pass', reason: 'jev_keep_full' };
  const keep = new Set(plan.candidates.filter((c) => c.mandatory).map((c) => c.id));
  for (const i of d.selected) { const c = plan.ask[i]; if (c) keep.add(c.id); }
  if (d.strategy === 'errors_and_stack') for (const c of plan.ask) if (c.kind === 'stack_tail') keep.add(c.id);
  if (d.strategy === 'errors_and_warnings') for (const c of plan.ask) if (c.kind === 'warning') keep.add(c.id);
  return { ...plan, keep: [...keep], reason: `jev:${d.strategy}` };
}

// ---------- building the compact text ----------

export type Built = { text: string; linesIn: number; linesOut: number; bytesIn: number; bytesOut: number };

export function buildCompact(text: string, plan: Plan, opt: Options, rawPath: string | null, statusLine: string): Built {
  const lines = splitLines(text);
  const keepSet = new Set<number>();
  for (let i = 0; i < Math.min(opt.headLines, lines.length); i++) keepSet.add(i);
  for (let i = Math.max(0, lines.length - opt.tailLines); i < lines.length; i++) keepSet.add(i);
  const byId = new Map(plan.candidates.map((c) => [c.id, c]));
  const kindAt = new Map<number, string>();
  for (const id of plan.keep) {
    const c = byId.get(id);
    if (!c) continue;
    for (let i = c.line_start - 1; i <= c.line_end - 1; i++) { keepSet.add(i); if (!kindAt.has(i)) kindAt.set(i, c.kind + (c.repeats && c.repeats > 1 ? ` ×${c.repeats}` : '')); }
  }
  const idx = [...keepSet].sort((a, b) => a - b);
  const body: string[] = [];
  let prev = -1;
  for (const i of idx) {
    if (i !== prev + 1) body.push(`${MARK} … ${i - prev - 1} line(s) omitted (${prev + 2}-${i}) …`);
    const k = kindAt.get(i);
    if (k && kindAt.get(i - 1) !== k) body.push(`${MARK} --- line ${i + 1}: ${k} ---`);
    body.push(lines[i] ?? '');
    prev = i;
  }
  if (prev < lines.length - 1) body.push(`${MARK} … ${lines.length - 1 - prev} line(s) omitted …`);
  const header = [
    `${MARK} Output trimmed by the smart-context-trimming mod: ${lines.length} → ${idx.length} original lines kept verbatim (${plan.reason}).`,
    `${MARK} ${statusLine}`,
    rawPath ? `${MARK} Full raw output: ${rawPath} (Read it if you need an omitted section).` : `${MARK} Raw output could not be saved; re-run with --no-trim for the full log.`,
  ];
  const footer = `${MARK} end of trimmed output. Turn trimming off with /smart-trim off.`;
  const out = [...header, ...body, footer].join('\n');
  return { text: out, linesIn: lines.length, linesOut: idx.length, bytesIn: byteLen(text), bytesOut: byteLen(out) };
}

// ---------- the Jev call (transport injected) ----------

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: string }>;
export type Sleeper = (ms: number) => Promise<void>;

export type JevOutcome = { ok: true; decision: JevDecision; latencyMs: number } | { ok: false; error: string; latencyMs: number };

/** One decisions call with a hard timeout; never throws. No retry: a failure costs one fallback, not a stall. */
export async function callJev(req: unknown, askCount: number, key: string | undefined, fetcher: Fetcher, sleep: Sleeper, timeoutMs: number, now: () => number): Promise<JevOutcome> {
  const t0 = now();
  if (!key) return { ok: false, error: 'no_key', latencyMs: 0 };
  try {
    const r = await Promise.race([
      fetcher(JEV_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(req) }),
      sleep(timeoutMs).then(() => 'timeout' as const),
    ]);
    const latencyMs = now() - t0;
    if (r === 'timeout') return { ok: false, error: 'timeout', latencyMs };
    if (!r.ok) return { ok: false, error: `http_${r.status}`, latencyMs };
    const p = parseJevResponse(r.text, askCount);
    return p.ok ? { ok: true, decision: p.decision, latencyMs } : { ok: false, error: p.error, latencyMs };
  } catch (err) {
    return { ok: false, error: `transport:${clip(String((err as Error)?.message ?? err).split('\n')[0] ?? '', 60)}`, latencyMs: now() - t0 };
  }
}

/** Full pipeline: rules, then (when useful) Jev, then the compact text. */
export async function decideAndBuild(args: {
  command: string; text: string; opt: Options; statusLine: string; rawPath: string | null;
  jev?: { key: string | undefined; fetcher: Fetcher; sleep: Sleeper; now: () => number } | null;
}): Promise<{ plan: Plan; built: Built | null; jev: { called: boolean; error?: string; latencyMs?: number; strategy?: string; confidence?: number } }> {
  const { command, text, opt, statusLine, rawPath, jev } = args;
  let plan = planTrim(command, text, opt);
  const meta: { called: boolean; error?: string; latencyMs?: number; strategy?: string; confidence?: number } = { called: false };
  if (plan.action === 'trim' && plan.ask.length > 0 && opt.useJev && jev) {
    meta.called = true;
    const lines = splitLines(text);
    const req = buildJevRequest(plan, lines, statusLine, opt.maxJevInputBytes);
    const out = await callJev(req, plan.ask.length, jev.key, jev.fetcher, jev.sleep, opt.maxJevLatencyMs, jev.now);
    meta.latencyMs = out.latencyMs;
    if (out.ok) {
      meta.strategy = out.decision.strategy; meta.confidence = out.decision.confidence;
      plan = applyJev(plan, out.decision, opt.minJevConfidence);
    } else {
      meta.error = out.error;
      plan = { ...plan, reason: `rule_fallback:${out.error}` };
    }
  }
  if (plan.action === 'pass') return { plan, built: null, jev: meta };
  const built = buildCompact(text, plan, opt, rawPath, statusLine);
  // Never return something that is not smaller.
  if (built.bytesOut >= built.bytesIn) return { plan: { ...plan, action: 'pass', reason: 'no_gain' }, built: null, jev: meta };
  return { plan, built, jev: meta };
}
