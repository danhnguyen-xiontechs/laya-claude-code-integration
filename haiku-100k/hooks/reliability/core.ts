// Shipped copy of agent-reliability/hooks/core.ts (scripts/ship-haiku-100k.mjs). Edit the source, not this file.
// agent-reliability core (Case B, from retry-loop-breaker 0.1): pure, deterministic rules. No engine, no Node, no clock:
// the hook passes `now` and the session state in and stores what comes back, so
// tests run the same functions under plain `node --test`.
//
// Only erasable TypeScript here (Node type stripping imports this file in tests).

import type { Mode } from './types.d.ts';
import { redact } from './redact.ts';
export type { Mode };

export type Options = {
  mode: Mode;
  /** Identical failures recorded (same action, same fingerprint, same epoch) before the next repeat is blocked. */
  maxIdenticalFailuresBeforeBlock: number;
  failureRecordTtlMinutes: number;
  maxRecordsPerSession: number;
  jevEnabled: boolean;
  jevTimeoutMs: number;
  /** JEV must pick block_redundant_retry with at least this probability to block. */
  jevMinConfidence: number;
  onJevError: 'allow';
  mainAgentOnly: boolean;
  /** Extra eligible command prefixes, comma separated (e.g. "make check,./gradlew test"). */
  extraEligible: string;
  /** Rule B (identical failure) may deny in enforce mode. */
  ruleB: boolean;
  /** Rule A (recovery budget, escalation, NEEDS_USER) may deny in enforce mode. */
  ruleA: boolean;
  maxRecoveryStrategies: number;
  gitTimeoutMs: number;
  telemetry: boolean;
  /** Telemetry folder; '' = `telemetry/` inside the plugin's own folder. */
  telemetryDir: string;
  /** Phase 0 diagnostics: filtered result fields to diag-<sid>.jsonl. Off unless set. */
  dumpRaw: boolean;
  /** 0.3 Rule C: refused calls (harness / user) are not resent; user denials are never worked around. */
  ruleC: boolean;
  /** 0.3 Jev Recovery Advisor: off | shadow (decide + log) | apply (enforce mode only). */
  jevAdvisor: 'off' | 'shadow' | 'apply';
  /** next_step probability an advisor decision needs to be applied; below it v0.2 behaviour stays. */
  jevAdvisorMinConfidence: number;
  /** Send the last user prompt (redacted, 300 chars) to Jev. */
  includePromptInJev: boolean;
  /** Local sanitized attempt records (attempts-YYYY-MM.jsonl). */
  datasetCapture: boolean;
  /** Dataset folder; '' = ~/.claude/agent-reliability/dataset. */
  datasetDir: string;
};

export const DEFAULTS: Options = {
  mode: 'observe',
  maxIdenticalFailuresBeforeBlock: 2,
  failureRecordTtlMinutes: 30,
  maxRecordsPerSession: 50,
  jevEnabled: false,
  jevTimeoutMs: 4000,
  jevMinConfidence: 0.8,
  onJevError: 'allow',
  mainAgentOnly: true,
  extraEligible: '',
  ruleB: true,
  ruleA: false,
  maxRecoveryStrategies: 2,
  gitTimeoutMs: 1500,
  telemetry: true,
  telemetryDir: '',
  dumpRaw: false,
  ruleC: true,
  jevAdvisor: 'off',
  jevAdvisorMinConfidence: 0.6,
  includePromptInJev: false,
  datasetCapture: true,
  datasetDir: '',
};

import type { AuditEntry, Category, FailureRecord, GuardState } from './types.d.ts';
export type { AuditEntry, Category, FailureRecord, GuardState };

export const emptyState = (): GuardState => ({
  schema: 2, epoch: 0, records: [], flaky: [], passed: [], incidents: [], nextIncident: 1,
  stats: { eligible: 0, wouldBlock: 0, blocked: 0, jevCalls: 0, jevErrors: 0, escalations: 0, failOpen: 0 },
  audit: [],
  refusals: [], nextRefusal: 1, refusalStreak: {}, needsUserKeys: [], jevLog: [],
});

// ---------------------------------------------------------------- eligibility

const RUNNERS: [RegExp, Category][] = [
  [/^(npm|pnpm|yarn|bun) (run )?test\b/, 'test_run'],
  [/^(npm|pnpm|yarn|bun) run (build|typecheck|type-check|lint|check)\b/, 'build'],
  [/^npx (tsc|jest|vitest|mocha|playwright test)\b/, 'test_run'],
  [/^(tsc|jest|vitest|mocha|pytest)\b/, 'test_run'],
  [/^python3? -m (pytest|unittest)\b/, 'test_run'],
  [/^node --test\b/, 'test_run'],
  [/^dotnet test\b/, 'test_run'],
  [/^dotnet build\b/, 'build'],
  [/^go test\b/, 'test_run'],
  [/^go (build|vet)\b/, 'build'],
  [/^cargo test\b/, 'test_run'],
  [/^cargo (build|check|clippy)\b/, 'build'],
  [/^(mvn|\.\/mvnw) (test|verify)\b/, 'test_run'],
  [/^(gradle|\.\/gradlew) test\b/, 'test_run'],
  [/^claude plugin (test|validate)\b/, 'test_run'],
  // 0.3, runner spellings seen in the transcript history
  [/^(npm|pnpm) (--prefix|-C) \S+ (run )?test\b/, 'test_run'],
  [/^(npm|pnpm) (--prefix|-C) \S+ run (build|typecheck|type-check|lint|check)\b/, 'build'],
  [/^yarn --cwd \S+ (run )?test\b/, 'test_run'],
  [/^py(thon)?(3|\.exe)? -m (pytest|unittest)\b/, 'test_run'],
  [/^\S*\/python(3|\.exe)? -m (pytest|unittest)\b/, 'test_run'],
  [/^uv run (pytest|python -m pytest)\b/, 'test_run'],
];

/** Shell syntax the guard will not reason about: pipes, chains, redirects, substitutions, env prefixes, background. */
const COMPOUND = /[|;&<>`]|\$\(|^\s*\w+=/;

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\\/g, '/').replace(/\s+/g, ' ').replace(/^\.\/node_modules\/\.bin\//, '');
}

export type Unwrapped = { core: string; cdPath: string | null; piped: boolean };

const CD_PREFIX = /^\s*(?:cd(?:\s+\/d)?|Set-Location|Push-Location|sl|pushd)\s+(?:-(?:Literal)?Path\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)\s*/i;
const TAIL_PIPE = /\s*\|\s*(?:tail|head|Select-Object|select)\b[^|;&<>`]*$/i;
const MERGE_ERR = /\s*2>&1\s*$/;

/**
 * The command as the guard classifies it: a leading `cd <dir> &&` / `Set-Location <dir>;`, a trailing
 * `2>&1` and a trailing `| tail|head|Select-Object …` are stripped. Classification and keys only:
 * the command that runs is never changed. `piped`: the exit code is the pipe's, not the runner's.
 */
export function unwrapCommand(command: string): Unwrapped {
  let c = String(command ?? '').trim();
  let cdPath: string | null = null;
  let piped = false;
  for (let i = 0; i < 2; i++) {
    const m = CD_PREFIX.exec(c);
    if (!m) break;
    cdPath = (m[1] ?? '').replace(/^["']|["']$/g, '').replace(/\\/g, '/');
    c = c.slice(m[0].length);
  }
  for (let i = 0; i < 4; i++) {
    const before = c;
    c = c.replace(TAIL_PIPE, () => { piped = true; return ''; }).replace(MERGE_ERR, '');
    if (c === before) break;
  }
  return { core: normalizeCommand(c), cdPath, piped };
}

/**
 * A runner's own summary line, for a piped run whose exit code is the pipe's. 'fail' and 'pass'
 * only on an explicit summary; null = no evidence (the run is then AMBIGUOUS).
 */
export function testSummaryOf(text: string): 'fail' | 'pass' | null {
  const t = String(text ?? '').slice(-20_000);
  const fail =
    /ℹ fail [1-9]/.test(t) || /^✖ failing tests:/m.test(t) // node --test (the ℹ summary comes before the details a `tail` keeps)
    || /\bTests?:?\s+[1-9]\d* failed/i.test(t) // jest, vitest
    || /=+ .*\b[1-9]\d* (failed|errors?)\b.* in [\d.]+s/.test(t) // pytest
    || /\bFailed!\s+-\s+Failed:\s+[1-9]/.test(t) // dotnet test
    || /^FAIL\b/m.test(t) // go test, jest file line
    || /test result: FAILED/.test(t) // cargo
    || /\berror TS\d{4}\b/.test(t) // tsc
    || /\bBuild FAILED\b/.test(t);
  if (fail) return 'fail';
  const pass =
    /ℹ fail 0\b/.test(t)
    || /\bTests?:?\s+\d+ passed/i.test(t)
    || /=+ \d+ passed\b.* in [\d.]+s/.test(t)
    || /\bPassed!\s+-\s+Failed:\s+0\b/.test(t)
    || /test result: ok\./.test(t)
    || /^ok\s+\S+/m.test(t);
  return pass ? 'pass' : null;
}

/** The category of an eligible validation command, or null (then the guard does nothing). */
export function classify(command: string, extraEligible = ''): Category | null {
  if (typeof command !== 'string') return null;
  const u = unwrapCommand(command);
  if (COMPOUND.test(u.core)) return null;
  const c = u.core;
  for (const [re, cat] of RUNNERS) if (re.test(c)) return cat;
  for (const p of extraEligible.split(',').map((s) => s.trim()).filter(Boolean)) if (c === p || c.startsWith(`${p} `)) return 'test_run';
  return null;
}

// ---------------------------------------------------------------- state change

const READ_ONLY_BASH = /^(ls|cat|head|tail|grep|rg|find|pwd|echo|wc|git (status|log|diff|show|branch)|which|type)\b/;
const MUTATING_BASH = /(\bsed -i\b|\brm\b|\bmv\b|\bcp\b|\btouch\b|\bmkdir\b|\bnpm (i|install|ci)\b|\bpnpm (i|install)\b|\byarn add\b|\bpip install\b|\bdotnet (restore|add)\b|\bgit (checkout|switch|reset|apply|stash|pull|merge|rebase|restore|cherry-pick)\b|\bpatch\b|>)/;

/**
 * Whether a finished non-validation Bash call may have changed relevant state.
 * Unknown → true (the guard then allows the next attempt rather than block wrongly).
 */
export function bashMayMutate(command: string, isReadOnly: boolean): boolean {
  if (isReadOnly) return false;
  const c = normalizeCommand(command);
  if (MUTATING_BASH.test(c)) return true;
  if (!COMPOUND.test(c) && READ_ONLY_BASH.test(c)) return false;
  return true;
}

/** The user explicitly asked for a retry: counts as new information. */
export const RETRY_REQUEST = /\b(re-?run|retry|try (it )?again|run (it |that |the tests? )?again)\b|chạy lại|thử lại/i;

// ---------------------------------------------------------------- failures

const TRANSIENT = /(ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|rate.?limit|\b429\b|\b50[234]\b|service unavailable|bad gateway|could not resolve host|network (error|is unreachable)|TLS handshake|connection (reset|refused|timed out)|temporarily unavailable|NU1301|Unable to load the service index)/i;

export const isTransient = (text: string): boolean => TRANSIENT.test(text);

export const exitCodeOf = (text: string): number | null => {
  const m = /exit code:? (-?\d+)/i.exec(text);
  return m ? Number(m[1]) : null;
};

const SIGNAL = /(error|fail|failed|failing|assert|expected|received|actual|exception|panic|cannot|not found|undefined|✗|✖|×|FAIL\b|TS\d{4}|CS\d{4}|E\d{4})/i;

/** One diagnostic line with volatile parts (times, durations, temp paths, hex, ids) masked. */
export function normalizeLine(line: string): string {
  return line
    .replace(/\\/g, '/')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<ts>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(\.\d+)?\b/g, '<ts>')
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|seconds|m)\b/g, '<dur>')
    .replace(/(\/tmp|\/var\/folders|[A-Za-z]:\/Users\/[^/]+\/AppData\/Local\/Temp)\/[^\s:'")]+/gi, '<tmp>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\bpid \d+\b/gi, 'pid <n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit, hex. Sync and dependency-free (no crypto in the mod environment needed). */
export function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Bounded fingerprint + summary of a failed run's output. */
export function fingerprint(text: string): { fp: string; summary: string } {
  const lines = String(text ?? '').split(/\r?\n/).slice(-400).map(normalizeLine).filter((l) => l && SIGNAL.test(l));
  const uniq = [...new Set(lines)].slice(0, 40);
  const basis = uniq.length ? uniq.join('\n') : normalizeLine(String(text ?? '').slice(-500));
  return { fp: `err-${fnv(basis)}`, summary: (uniq[0] ?? basis).slice(0, 160) };
}

// ---------------------------------------------------------------- decisions

export type PreDecision =
  | { kind: 'pass'; reason: string }
  | { kind: 'block'; reason: string; record: FailureRecord }
  | { kind: 'ambiguous'; reason: string; record: FailureRecord };

const keyOf = (workspace: string, action: string) => `${workspace}::${action}`;
const tokens = (s: string) => new Set(s.split(' '));

/** Jaccard over tokens of two commands. */
export function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const runnerOf = (action: string) => action.split(' ').slice(0, 2).join(' ');

export function prune(state: GuardState, now: number, o: Options): GuardState {
  const ttl = o.failureRecordTtlMinutes * 60_000;
  const records = state.records.filter((r) => now - r.timestamp <= ttl).slice(-o.maxRecordsPerSession);
  return { ...state, records, audit: state.audit.slice(-50), passed: state.passed.slice(-100), flaky: state.flaky.slice(-100) };
}

/** The rule order of the plan (§8), before the call runs. */
export function decideBefore(state: GuardState, workspace: string, command: string, now: number, o: Options): PreDecision {
  const action = normalizeCommand(command);
  const key = keyOf(workspace, action);
  const ttl = o.failureRecordTtlMinutes * 60_000;
  const live = state.records.filter((r) => r.workspace === workspace && now - r.timestamp <= ttl);
  const exact = live.find((r) => r.key === key);
  if (exact) {
    if (exact.state_epoch !== state.epoch) return { kind: 'pass', reason: 'state_changed_since_failure' };
    if (exact.transient) return { kind: 'pass', reason: 'transient_failure' };
    if (state.flaky.includes(key)) return { kind: 'pass', reason: 'flaky_action' };
    if (exact.repeat_count >= o.maxIdenticalFailuresBeforeBlock) return { kind: 'block', reason: 'same_action_same_failure_no_state_change', record: exact };
    return { kind: 'pass', reason: 'below_threshold' };
  }
  // Near-duplicate: same runner, same epoch, persistent failure, similar but not identical command.
  const near = live
    .filter((r) => r.state_epoch === state.epoch && !r.transient && runnerOf(r.normalized_action) === runnerOf(action)
      && r.repeat_count >= o.maxIdenticalFailuresBeforeBlock)
    .map((r) => ({ r, s: similarity(r.normalized_action, action) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s)[0];
  if (near) return { kind: 'ambiguous', reason: `near_duplicate(${near.s.toFixed(2)})`, record: near.r };
  return { kind: 'pass', reason: 'no_matching_failure' };
}

export type Outcome =
  | { kind: 'failed'; text: string }
  | { kind: 'passed' }
  | { kind: 'ignored'; reason: string }; // deny, interrupt, background, permission: not evidence

/** Records what the run showed; returns the new state. */
export function recordAfter(state: GuardState, workspace: string, command: string, category: Category, outcome: Outcome, now: number, o: Options): GuardState {
  const action = normalizeCommand(command);
  const key = keyOf(workspace, action);
  const prior = state.records.find((r) => r.key === key);
  if (outcome.kind === 'ignored') return state;
  if (outcome.kind === 'passed') {
    const flaky = prior && prior.state_epoch === state.epoch && !state.flaky.includes(key) ? [...state.flaky, key] : state.flaky;
    return { ...state, flaky, passed: state.passed.includes(key) ? state.passed : [...state.passed, key], records: state.records.filter((r) => r.key !== key) };
  }
  const { fp, summary } = fingerprint(outcome.text);
  const transient = isTransient(outcome.text);
  // pass → fail at the same epoch with no record in between: flaky.
  const flaky = !prior && state.passed.includes(key) && !state.flaky.includes(key) ? [...state.flaky, key] : state.flaky;
  const same = prior && prior.error_fingerprint === fp && prior.state_epoch === state.epoch;
  const rec: FailureRecord = {
    schema_version: '1.0', key, workspace, tool_category: category, normalized_action: action,
    exit_code: exitCodeOf(outcome.text), error_fingerprint: fp, error_summary: summary, transient,
    state_epoch: state.epoch, timestamp: now, repeat_count: same ? prior.repeat_count + 1 : 1,
  };
  const records = [...state.records.filter((r) => r.key !== key), rec].slice(-o.maxRecordsPerSession);
  return { ...state, flaky, records };
}

export function denialText(r: FailureRecord, viaJev = false): string {
  return `Retry blocked (agent-reliability): \`${r.normalized_action}\` already failed ${r.repeat_count}× with the same error `
    + `(${r.error_fingerprint}: "${r.error_summary}") and no file edit or other state change was detected since`
    + `${viaJev ? ' (a near-duplicate of that command, judged redundant)' : ''}. `
    + 'Inspect the failure, change the implementation, or run a different diagnostic before repeating it. '
    + 'If you are sure a rerun will tell something new, say why, or the user can run /reliability reset.';
}

// ---------------------------------------------------------------- JEV contract

export const JEV_DECISIONS = ['allow_retry', 'block_redundant_retry', 'uncertain_allow'] as const;
export type JevDecision = (typeof JEV_DECISIONS)[number];

/** The near-duplicate question. Every free-text field goes through the shared redaction policy. */
export function jevRequest(record: FailureRecord, command: string, epochChanged: boolean) {
  return {
    state: {
      schema_version: '1.0',
      task_category: 'fix_failing_tests',
      previous_attempts: [{
        action: redact(record.normalized_action, 220),
        result: redact(record.error_summary, 400),
        error_fingerprint: record.error_fingerprint,
        failed_times: record.repeat_count,
        state_changed_after_failure: epochChanged,
      }],
      proposed_action: redact(normalizeCommand(command), 220),
      new_diagnostic_evidence: false,
      transient_failure_signals: record.transient ? ['transient'] : [],
    },
    questions: {
      decision: {
        type: 'choice',
        instructions: 'Will `proposed_action` likely produce new information compared with `previous_attempts`, or is it a redundant retry of the same failing check (same target, same failure, nothing changed)? A different test, file, project or filter is new information.',
        criteria: {
          allow_retry: 'The proposed action targets something different (another test, project, filter or option that changes what runs) and will likely give new information.',
          block_redundant_retry: 'The proposed action runs the same failing check again in a trivially different spelling, so it will fail the same way and add nothing.',
          uncertain_allow: 'It is unclear whether the proposed action would give new information.',
        },
      },
    },
  };
}

export type JevVerdict = { decision: JevDecision; confidence: number } | { error: string };

export type ChoiceAnswer = { choice: string; p: number; probabilities: Record<string, number> };

/**
 * Strict validation of one decisions response: `spec` names each question and its fixed enum
 * (choice) or 'noul'. Any missing, off-enum or out-of-range answer is an error, never a guess.
 */
export function parseAnswers(json: unknown, spec: Record<string, readonly string[] | 'noul'>): { answers: Record<string, ChoiceAnswer | number> } | { error: string } {
  const all = (json as { answers?: Record<string, { choice?: unknown; noul?: unknown; probabilities?: Record<string, unknown> }> })?.answers;
  if (!all || typeof all !== 'object') return { error: 'invalid: no answers' };
  const answers: Record<string, ChoiceAnswer | number> = {};
  for (const [name, kind] of Object.entries(spec)) {
    const a = all[name];
    if (!a || typeof a !== 'object') return { error: `invalid: no ${name} answer` };
    if (kind === 'noul') {
      if (typeof a.noul !== 'number' || !(a.noul >= 0 && a.noul <= 1)) return { error: `invalid: ${name} noul` };
      answers[name] = a.noul;
      continue;
    }
    const raw = a.probabilities ?? {};
    const probabilities: Record<string, number> = {};
    let best: string | null = null, p = -1;
    for (const d of kind) { const v = raw[d]; if (typeof v === 'number') { probabilities[d] = v; if (v > p) { p = v; best = d; } } }
    const choice = typeof a.choice === 'string' ? a.choice : best;
    if (!choice || !kind.includes(choice)) return { error: `invalid: ${name} choice ${String(choice)}` };
    const conf = typeof probabilities[choice] === 'number' ? (probabilities[choice] as number) : p;
    if (!(conf >= 0 && conf <= 1)) return { error: `invalid: ${name} confidence` };
    answers[name] = { choice, p: conf, probabilities };
  }
  return { answers };
}

/** Strict validation of a decisions response: fixed enum, numeric probabilities. */
export function parseJev(json: unknown): JevVerdict {
  const r = parseAnswers(json, { decision: JEV_DECISIONS });
  if ('error' in r) return { error: r.error.replace('decision ', '') };
  const a = r.answers.decision as ChoiceAnswer;
  return { decision: a.choice as JevDecision, confidence: a.p };
}

/** Block only on a confident block_redundant_retry; everything else (errors included) allows. */
export const jevBlocks = (v: JevVerdict, o: Options): boolean =>
  !('error' in v) && v.decision === 'block_redundant_retry' && v.confidence >= o.jevMinConfidence;

export function readOptions(raw: Readonly<Record<string, unknown>> = {}): Options {
  const num = (k: keyof Options, d: number) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : d);
  return {
    mode: raw.mode === 'enforce' ? 'enforce' : raw.mode === 'off' ? 'off' : 'observe',
    maxIdenticalFailuresBeforeBlock: Math.max(1, Math.round(num('maxIdenticalFailuresBeforeBlock', DEFAULTS.maxIdenticalFailuresBeforeBlock))),
    failureRecordTtlMinutes: num('failureRecordTtlMinutes', DEFAULTS.failureRecordTtlMinutes),
    maxRecordsPerSession: num('maxRecordsPerSession', DEFAULTS.maxRecordsPerSession),
    jevEnabled: raw.jevEnabled === true,
    jevTimeoutMs: num('jevTimeoutMs', DEFAULTS.jevTimeoutMs),
    jevMinConfidence: num('jevMinConfidence', DEFAULTS.jevMinConfidence),
    onJevError: 'allow',
    mainAgentOnly: raw.mainAgentOnly === undefined ? true : raw.mainAgentOnly === true,
    extraEligible: typeof raw.extraEligible === 'string' ? raw.extraEligible : '',
    ruleB: raw.ruleB !== false,
    ruleA: raw.ruleA === true,
    maxRecoveryStrategies: Math.max(1, Math.round(num('maxRecoveryStrategies', DEFAULTS.maxRecoveryStrategies))),
    gitTimeoutMs: Math.max(100, num('gitTimeoutMs', DEFAULTS.gitTimeoutMs)),
    telemetry: raw.telemetry !== false,
    telemetryDir: typeof raw.telemetryDir === 'string' ? raw.telemetryDir.trim() : '',
    dumpRaw: raw.dumpRaw === true,
    ruleC: raw.ruleC !== false,
    jevAdvisor: raw.jevAdvisor === 'shadow' || raw.jevAdvisor === 'apply' ? raw.jevAdvisor : 'off',
    jevAdvisorMinConfidence: num('jevAdvisorMinConfidence', DEFAULTS.jevAdvisorMinConfidence),
    includePromptInJev: raw.includePromptInJev === true,
    datasetCapture: raw.datasetCapture !== false,
    datasetDir: typeof raw.datasetDir === 'string' ? raw.datasetDir.trim() : '',
  };
}

/**
 * Effective mode (plan rule 4): env AGENT_RELIABILITY=off always wins; then the
 * session's /reliability setting; then env observe|enforce; then userConfig; then observe.
 */
export function resolveMode(env: string | undefined, session: Mode | undefined, config: Mode): { mode: Mode; source: string } {
  const e = (env ?? '').trim().toLowerCase();
  if (e === 'off') return { mode: 'off', source: 'env AGENT_RELIABILITY=off (kill switch)' };
  if (session) return { mode: session, source: '/reliability (this session)' };
  if (e === 'observe' || e === 'enforce') return { mode: e, source: `env AGENT_RELIABILITY=${e}` };
  return { mode: config, source: 'userConfig mode' };
}

/** State read from $.state: anything not schema 2 is dropped (no stale import). */
export function upgradeState(v: unknown): GuardState {
  const s = v as Partial<GuardState> | undefined;
  if (!s || s.schema !== 2 || !Array.isArray(s.records) || typeof s.epoch !== 'number' || !Array.isArray(s.incidents)) return emptyState();
  // 0.2 → 0.3: same schema, new fields filled in.
  const e = emptyState();
  return {
    ...(s as GuardState),
    refusals: Array.isArray(s.refusals) ? s.refusals : e.refusals,
    nextRefusal: typeof s.nextRefusal === 'number' ? s.nextRefusal : e.nextRefusal,
    refusalStreak: s.refusalStreak && typeof s.refusalStreak === 'object' ? s.refusalStreak : e.refusalStreak,
    needsUserKeys: Array.isArray(s.needsUserKeys) ? s.needsUserKeys : e.needsUserKeys,
    jevLog: Array.isArray(s.jevLog) ? s.jevLog : e.jevLog,
  };
}
