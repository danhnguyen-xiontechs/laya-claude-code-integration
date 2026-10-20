// haiku-pace pure helpers: which effort a Haiku model request (turn.step) gets, and which Bash
// calls are stopped before they run. register.ts holds everything that takes the engine handle ($).
//
// Why (session 830cca7b, 2026-10-20): ~70% of a Haiku turn was model time, mostly hidden thinking;
// single steps spent 27–40 s and 6–9k output tokens to emit one Grep/Read. And one foreground
// `timeout 300000 claude plugin test .` (GNU timeout counts seconds) cost 321 s.
import { exitCodeOf, parseAnswers, testSummaryOf, type ChoiceAnswer } from '../reliability/core.ts';
import { redact } from '../reliability/redact.ts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PaceMode = 'apply' | 'shadow' | 'off';
export type StepClass = 'easy' | 'normal' | 'pivot';

/** One tool call of the previous step, as the next step's effort is decided from it. */
export type StepCall = { tool: string; action: string; readOnly: boolean; failed: boolean; error: string; editedLines: number };

export type PaceOptions = { mode: PaceMode; jev: boolean; jevBudget: number; jevTimeoutMs: number; jevMinConfidence: number; bigEditLines: number; telemetry: boolean; telemetryDir: string };

export function readPaceOptions(raw: Readonly<Record<string, unknown>> = {}): PaceOptions {
  const num = (k: string, d: number) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : d);
  return {
    mode: raw.paceMode === 'shadow' || raw.paceMode === 'off' ? raw.paceMode : 'apply',
    jev: raw.paceJev !== false,
    jevBudget: Math.max(0, Math.round(num('paceJevBudget', 40))),
    jevTimeoutMs: Math.max(200, num('paceJevTimeoutMs', 1500)),
    jevMinConfidence: num('paceJevMinConfidence', 0.6),
    bigEditLines: Math.max(1, Math.round(num('paceBigEditLines', 30))),
    telemetry: raw.telemetry !== false,
    telemetryDir: typeof raw.telemetryDir === 'string' ? raw.telemetryDir.trim() : '',
  };
}

/** env HAIKU_PACE=off|shadow|apply wins over the session's /haiku-pace, which wins over userConfig. */
export function resolvePaceMode(env: string | undefined, session: PaceMode | undefined, config: PaceMode): PaceMode {
  const e = (env ?? '').trim().toLowerCase();
  if (e === 'off' || e === 'shadow' || e === 'apply') return e;
  return session ?? config;
}

/**
 * The long-command guard is its own switch. HAIKU_PACE=off is the kill switch for the whole mod.
 * Otherwise it denies in apply and off (adaptation off, guard still on) and only logs in shadow.
 */
export function guardStateOf(env: string | undefined, mode: PaceMode): 'deny' | 'log' | 'killed' {
  if ((env ?? '').trim().toLowerCase() === 'off') return 'killed';
  return mode === 'shadow' ? 'log' : 'deny';
}

const RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };
export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && v in RANK;

// ---------------------------------------------------------------- reading a tool call

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'WebFetch', 'WebSearch']);
const READ_BASH = /^\s*(?:cd|cat|head|tail|sed\s+-n|grep|rg|ls|find|wc|cut|sort|uniq|diff|stat|file|which|where|pwd|echo|jq|tree|git\s+(?:-C\s+\S+\s+)?(?:status|diff|log|show|branch|rev-parse|ls-files|blame))\b/;
const WRITES = /(?:^|[^>&0-9])>>?(?!\s*&)|\btee\b|\bsed\s+-i\b|\brm\b|\bmv\b|\bcp\b|\bmkdir\b|\bnpm\s+(?:i|install|ci)\b|\bgit\s+(?:commit|add|apply|checkout|reset|merge|rebase|push|stash)\b/;

/** Read-only by the engine's word, by tool, or for Bash a plain inspection command with no write in it. */
export function isReadOnlyCall(tool: string, command: string | undefined, engineReadOnly: boolean): boolean {
  if (engineReadOnly || READ_TOOLS.has(tool)) return true;
  if ((tool === 'Bash' || tool === 'PowerShell') && command) {
    return command.split(/\s*(?:&&|\|\||;|\|)\s*/).every((part) => !part || (READ_BASH.test(part) && !WRITES.test(part)));
  }
  return false;
}

const CUT_NOTE = /\[haiku-100k: \d+ chars cut/;

/** Failed: a refusal or error result, a nonzero exit, or a failing test summary. haiku-100k's own size cut is not a failure. */
export function failureOf(ran: { deny?: string; isError?: boolean; text?: string }): { failed: boolean; error: string } {
  const text = typeof ran.deny === 'string' ? ran.deny : typeof ran.text === 'string' ? ran.text : '';
  const cutOnly = typeof ran.deny === 'string' && CUT_NOTE.test(ran.deny) && !((exitCodeOf(text) ?? 0) > 0);
  if (cutOnly) return { failed: false, error: '' };
  const code = exitCodeOf(text);
  const failed = ran.deny !== undefined || ran.isError === true || (code !== null && code > 0) || testSummaryOf(text) === 'fail';
  return { failed, error: failed ? text.slice(0, 400) : '' };
}

/** Lines an Edit / Write / NotebookEdit call puts in. */
export function editedLinesOf(tool: string, input: Record<string, unknown>): number {
  const s = tool === 'Write' ? input.content : tool === 'Edit' ? input.new_string : tool === 'NotebookEdit' ? input.new_source : undefined;
  return typeof s === 'string' ? s.split('\n').length : 0;
}

/** A short, redacted label of the call, for Jev and telemetry. */
export function actionOf(tool: string, input: Record<string, unknown>): string {
  const v = input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.description ?? '';
  return redact(`${tool} ${typeof v === 'string' ? v : ''}`, 160);
}

// ---------------------------------------------------------------- choosing the effort

/**
 * easy  — every call of the previous step read something and succeeded: the next step mostly
 *         picks the next read or edit, little to think through.
 * pivot — step 0 of a turn (planning), a failed call, or a big edit (the next step verifies it).
 * normal — anything else: the session's effort stands.
 */
export function classifyStep(index: number, calls: readonly StepCall[], bigEditLines: number): { cls: StepClass; reason: string } {
  if (index === 0) return { cls: 'pivot', reason: 'turn_start' };
  if (calls.some((c) => c.failed)) return { cls: 'pivot', reason: 'failure' };
  if (calls.some((c) => c.editedLines >= bigEditLines)) return { cls: 'pivot', reason: 'big_edit' };
  if (calls.length > 0 && calls.every((c) => c.readOnly)) return { cls: 'easy', reason: 'read_only' };
  return { cls: 'normal', reason: calls.length ? 'mixed' : 'no_calls' };
}

/** The effort a pivot gets when Jev is not asked or not sure: at least high, never below the session's. */
export const pivotFallback = (current: Effort): Effort => (RANK[current] >= RANK.high ? current : 'high');

/**
 * The effort to send. Never touches a session or caller that asked for xhigh/max (an explicit
 * choice to think hard); easy lowers to low; a pivot takes Jev's level when sure, else the fallback.
 */
export function chooseEffort(cls: StepClass, current: Effort, jev: ChoiceAnswer | null, minP: number): { effort: Effort; source: string } {
  if (RANK[current] >= RANK.xhigh) return { effort: current, source: 'explicit_high' };
  if (cls === 'easy') return { effort: 'low', source: 'rule' };
  if (cls === 'pivot') {
    if (jev && jev.p >= minP && isEffort(jev.choice)) return { effort: jev.choice, source: 'jev' };
    return { effort: pivotFallback(current), source: jev ? 'jev_low_confidence' : 'fallback' };
  }
  return { effort: current, source: 'unchanged' };
}

// ---------------------------------------------------------------- Jev on pivot steps

export const EFFORTS = ['low', 'medium', 'high'] as const;

/** One decisions request: how much reasoning the next step needs, from the redacted previous calls only. */
export function paceRequest(p: { subagent: boolean; index: number; reason: string; calls: readonly StepCall[] }) {
  return {
    state: {
      agent: p.subagent ? 'subagent' : 'main agent',
      step_in_turn: p.index,
      why_asked: p.reason,
      previous_tool_calls: p.calls.slice(-4).map((c) => ({
        tool: c.tool, action: redact(c.action, 160), outcome: c.failed ? 'failed' : 'ok',
        ...(c.failed ? { error: redact(c.error, 240) } : {}), ...(c.editedLines ? { lines_written: c.editedLines } : {}),
      })),
    },
    questions: {
      effort: {
        type: 'choice',
        instructions: 'A coding agent is about to take its next step after the tool calls in `previous_tool_calls` (empty at the start of a turn). How much reasoning does that next step need to be done well?',
        criteria: {
          low: 'Routine: the next move is obvious from the results (read the next file, run the obvious command, make an edit already decided, a mechanical slip with a plain fix such as a wrong path or flag).',
          medium: 'Some judgment: choose between a few approaches, interpret a test or compiler error whose cause is visible, or check that a change did what was intended.',
          high: 'Hard: plan a multi-step task at the start of a turn, diagnose a failure whose cause is not visible, or reason about a design or a large change before verifying it.',
        },
      },
    },
  };
}

export function parsePace(json: unknown): ChoiceAnswer | { error: string } {
  const r = parseAnswers(json, { effort: EFFORTS });
  return 'error' in r ? r : (r.answers.effort as ChoiceAnswer);
}

// ---------------------------------------------------------------- long-command guard

/** Commands that take minutes: run them in the background so the turn is not held. */
export const LONG_COMMANDS = /\bclaude\s+(?:plugin\s+(?:test|eval)\b|-p\b|--print\b)/;

/** `python -` reading a heredoc: hung twice in Git Bash here (321 s in session 830cca7b). */
export const STDIN_PYTHON = /\bpython3?(?:\.exe)?\s+-(?=\s|$)[^\n]*<</;

/**
 * GNU `timeout` as a command word: at the start of a line or after a shell separator (; && || | ( ),
 * then options, then a bare integer of seconds. Not `echo timeout 300`, not `npm run timeout 300`,
 * not a path such as `timeout/x`. Windows `timeout /t 300` has a `/` flag and never matches.
 * This guard only runs on the Bash tool (Git Bash here), so the GNU reading is the right one.
 */
export const GNU_TIMEOUT = /(?:^|[;&|(]\s*)timeout\s+(?:-[a-zA-Z-]+(?:[ =]\S+)?\s+)*(\d+)(?![\w./])/gm;

/** A deny text for a Bash call that would hold the turn for a long time, else null. */
export function guardCommand(command: string, background: boolean): string | null {
  for (const m of command.matchAll(GNU_TIMEOUT)) {
    const n = Number(m[1]);
    if (n >= 3600)
      return `[haiku-pace] \`timeout ${n}\` is ${n} seconds (≈ ${(n / 3600).toFixed(1)} h): GNU timeout counts seconds, not milliseconds. Use e.g. \`timeout ${Math.max(1, Math.round(n / 1000))}\`, or run_in_background for a long job.`;
  }
  if (STDIN_PYTHON.test(command))
    return '[haiku-pace] `python -` fed by a heredoc has hung this shell (Git Bash on Windows, 2026-10-20, twice): write the script to a file in the scratchpad and run `python <file>` (or `node <file>`).';
  if (!background && LONG_COMMANDS.test(command))
    return '[haiku-pace] this command runs a whole Claude session and takes minutes: rerun it with run_in_background: true (output to a file) and keep working; you are notified when it ends.';
  return null;
}
