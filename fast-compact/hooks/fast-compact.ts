// fast-compact: deterministic verbatim compaction, opt-in per /compact.
//
// No model is called. Old tool outputs and bulky tool inputs are trimmed by fixed
// rules per tool; every message, every tool call and all user/assistant text stay
// in place. The hook is inert unless the fast-compact skill armed it: an arm file
// (~/.claude/fast-compact/arm.json, valid ARM_TTL_MS, used once) switches the next
// manual /compact to these rules; auto-compaction always keeps the built-in summary.
//
// The rules were picked offline on four real sessions against hindsight labels:
// all 38 still-needed calls kept, 47–58% fewer characters (see README.md).
//
// Only erasable TypeScript here: scripts/preview.ts imports this file under
// Node's type stripping, so the preview and the hook run the same rules.
import type { On, PluginOptions, Register, SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code';

export type Options = {
  /** Newest messages never touched (the first message is always kept too). */
  preserveRecentMessages: number;
  /** Below this character reduction the built-in summary runs instead. */
  minReductionRatio: number;
};

export const DEFAULTS: Options = { preserveRecentMessages: 6, minReductionRatio: 0.25 };

export const ARM_TTL_MS = 15 * 60_000;
const LOG_LINES = 200;
/** Marks text this plugin already cut, so a second compaction leaves it alone. */
export const MARK = '[fast-compact:';

const EDIT = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
const READ = /^Read$/;
const SEARCH = /^(Grep|Glob|LS|ToolSearch|WebSearch)$/;
const DIGEST = /^(Agent|Task|WebFetch)$/;

/** Shell and unknown tools: outputs up to this size, or errors, stay whole. */
const SHELL_KEEP_CHARS = 1200;
const SHELL_HEAD = 200;
const SHELL_TAIL = 200;
const READ_HEAD = 300;
const SEARCH_HEAD = 150;
const DIGEST_HEAD = 600;
const EDIT_INPUT_CHARS = 300;
const OTHER_INPUT_CHARS = 400;

export type Action = 'pinned' | 'kept' | 'trimmed' | 'stale';

export type Decision = {
  tool_use_id: string;
  tool: string;
  result: Action;
  input: 'kept' | 'trimmed';
};

export type Stats = {
  messages: number;
  calls: number;
  charsBefore: number;
  charsAfter: number;
  reduction: number;
  resultsTrimmed: number;
  resultsStale: number;
  inputsTrimmed: number;
};

export type Plan = { messages: SessionMessage[]; decisions: Decision[]; stats: Stats };

type Call = { use: ToolUseSummary; index: number; resultIndex: number; resultText: string; isError: boolean };

const pathOf = (input: Record<string, unknown>): string => {
  const p = input['file_path'] ?? input['notebook_path'] ?? input['path'];
  return typeof p === 'string' ? p.replace(/\\/g, '/').toLowerCase() : '';
};

function cut(text: string, head: number, tail: number, hint: string): string {
  if (text.includes(MARK) || text.length <= head + tail + 80) return text;
  const middle = `${MARK} ${text.length - head - tail} chars cut; ${hint}]`;
  return `${text.slice(0, head)}\n${middle}${tail > 0 ? `\n${text.slice(-tail)}` : ''}`;
}

/** Shortens every long string inside a tool input; returns the same object when nothing changed. */
function trimInput(value: unknown, limit: number): unknown {
  if (typeof value === 'string') {
    return value.length > limit && !value.includes(MARK)
      ? `${value.slice(0, limit)}${MARK} ${value.length - limit} chars cut; the file on disk is current]`
      : value;
  }
  if (Array.isArray(value)) {
    const next = value.map((v) => trimInput(v, limit));
    return next.some((v, i) => v !== value[i]) ? next : value;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const next = entries.map(([k, v]) => [k, trimInput(v, limit)] as const);
    return next.some(([, v], i) => v !== entries[i]![1]) ? Object.fromEntries(next) : value;
  }
  return value;
}

function collectCalls(messages: readonly SessionMessage[]): Call[] {
  const results = new Map<string, { index: number; text: string; isError: boolean }>();
  messages.forEach((m, index) => {
    for (const r of m.toolResults ?? []) results.set(r.tool_use_id, { index, text: r.text, isError: r.isError });
  });
  const calls: Call[] = [];
  messages.forEach((m, index) => {
    for (const use of m.toolUses) {
      const found = results.get(use.tool_use_id);
      const text = found?.text ?? use.text;
      if (text === undefined) continue; // unanswered: nothing to trim
      calls.push({
        use,
        index,
        resultIndex: found?.index ?? index,
        resultText: text,
        isError: found?.isError ?? use.isError === true,
      });
    }
  });
  return calls;
}

/** What one old call becomes: its new result text and input (undefined = unchanged). */
function ruleFor(call: Call, later: readonly Call[]): { result: Action; text?: string; input?: Record<string, unknown> } {
  const { use, resultText: text } = call;
  const tool = use.tool;
  const p = pathOf(use.input);
  const limit = EDIT.test(tool) ? EDIT_INPUT_CHARS : OTHER_INPUT_CHARS;
  const supersededWrite = tool === 'Write' && p !== '' && later.some((l) => l.use.tool === 'Write' && pathOf(l.use.input) === p);
  const input = supersededWrite
    ? { ...use.input, content: `${MARK} superseded by a later Write of this file]` }
    : (trimInput(use.input, limit) as Record<string, unknown>);
  const changedInput = input !== use.input ? input : undefined;
  const out = (result: Action, next?: string) =>
    ({ result, ...(next !== undefined && next !== text ? { text: next } : {}), ...(changedInput ? { input: changedInput } : {}) });

  if (EDIT.test(tool)) return out('kept');
  if (READ.test(tool)) {
    const stale = p !== '' && later.some((l) => pathOf(l.use.input) === p && (READ.test(l.use.tool) || EDIT.test(l.use.tool)));
    if (stale) return out('stale', `${MARK} stale read of ${p}; it was read or edited again later]`);
    const next = cut(text, READ_HEAD, 0, 'Read the file again if needed');
    return out(next === text ? 'kept' : 'trimmed', next);
  }
  if (SEARCH.test(tool)) {
    const next = cut(text, SEARCH_HEAD, 0, `re-run ${tool} if needed`);
    return out(next === text ? 'kept' : 'trimmed', next);
  }
  if (DIGEST.test(tool)) {
    const next = cut(text, DIGEST_HEAD, 0, `the full ${tool} output is gone`);
    return out(next === text ? 'kept' : 'trimmed', next);
  }
  // Bash, PowerShell, MCP and unknown tools: errors and short outputs stay whole.
  if (call.isError || text.length <= SHELL_KEEP_CHARS) return out('kept');
  const next = cut(text, SHELL_HEAD, SHELL_TAIL, `re-run ${tool} if needed`);
  return out(next === text ? 'kept' : 'trimmed', next);
}

function messageChars(m: SessionMessage): number {
  let n = m.text.length;
  const seen = new Set((m.toolResults ?? []).map((r) => r.tool_use_id));
  for (const u of m.toolUses) {
    n += JSON.stringify(u.input ?? {}).length;
    if (u.text !== undefined && !seen.has(u.tool_use_id)) n += u.text.length;
  }
  for (const r of m.toolResults ?? []) n += r.text.length;
  return n;
}

/**
 * Applies the rules. Untouched messages come back as the same objects (handles
 * included); a changed message is rebuilt without its handle so the engine
 * takes the edited content. No message, call or result is ever removed.
 */
export function planCompaction(messages: readonly SessionMessage[], options: Partial<Options> = {}): Plan {
  const { preserveRecentMessages } = { ...DEFAULTS, ...options };
  const total = messages.length;
  const pinned = (i: number) => i === 0 || i >= total - preserveRecentMessages;
  const calls = collectCalls(messages);

  const decisions: Decision[] = [];
  const newText = new Map<string, string>();
  const newInput = new Map<string, Record<string, unknown>>();
  calls.forEach((call, i) => {
    if (pinned(call.index) || pinned(call.resultIndex)) {
      decisions.push({ tool_use_id: call.use.tool_use_id, tool: call.use.tool, result: 'pinned', input: 'kept' });
      return;
    }
    const rule = ruleFor(call, calls.slice(i + 1));
    if (rule.text !== undefined) newText.set(call.use.tool_use_id, rule.text);
    if (rule.input) newInput.set(call.use.tool_use_id, rule.input);
    decisions.push({ tool_use_id: call.use.tool_use_id, tool: call.use.tool, result: rule.result, input: rule.input ? 'trimmed' : 'kept' });
  });

  const out = messages.map((m): SessionMessage => {
    const touched =
      m.toolUses.some((u) => newText.has(u.tool_use_id) || newInput.has(u.tool_use_id)) ||
      (m.toolResults ?? []).some((r) => newText.has(r.tool_use_id));
    if (!touched) return m;
    const toolUses = m.toolUses.map((u): ToolUseSummary => {
      const text = newText.get(u.tool_use_id);
      const input = newInput.get(u.tool_use_id);
      if (text === undefined && !input) return u;
      const copy: ToolUseSummary = { tool_use_id: u.tool_use_id, tool: u.tool, input: input ?? u.input };
      if (u.text !== undefined) copy.text = text ?? u.text;
      if (u.isError) copy.isError = true;
      return copy;
    });
    const rebuilt: SessionMessage = { role: m.role, text: m.text, toolUses };
    if (m.toolResults && m.toolResults.length > 0) {
      rebuilt.toolResults = m.toolResults.map((r): ToolResultSummary => {
        const text = newText.get(r.tool_use_id);
        return text === undefined ? r : { tool_use_id: r.tool_use_id, text, isError: r.isError };
      });
    }
    return rebuilt;
  });

  const charsBefore = messages.reduce((s, m) => s + messageChars(m), 0);
  const charsAfter = out.reduce((s, m) => s + messageChars(m), 0);
  const count = (a: Action) => decisions.filter((d) => d.result === a).length;
  return {
    messages: out,
    decisions,
    stats: {
      messages: total,
      calls: calls.length,
      charsBefore,
      charsAfter,
      reduction: charsBefore === 0 ? 0 : (charsBefore - charsAfter) / charsBefore,
      resultsTrimmed: count('trimmed'),
      resultsStale: count('stale'),
      inputsTrimmed: decisions.filter((d) => d.input === 'trimmed').length,
    },
  };
}

export function summarize(stats: Stats): string {
  return `${Math.round(stats.reduction * 100)}% fewer chars (${stats.charsBefore} → ${stats.charsAfter}); ` +
    `${stats.resultsTrimmed} outputs trimmed, ${stats.resultsStale} stale reads, ${stats.inputsTrimmed} inputs trimmed, ` +
    `${stats.calls} calls, ${stats.messages} messages, nothing removed`;
}

/** The arm file the skill writes: `{ armedAt, cwd? }`; `usedAt` once consumed. */
export type Arm = { armedAt: number; cwd?: string; usedAt?: number };

export function isArmed(arm: Arm | undefined, now: number): boolean {
  return !!arm && typeof arm.armedAt === 'number' && !arm.usedAt && now - arm.armedAt >= 0 && now - arm.armedAt <= ARM_TTL_MS;
}

function optionNumber(options: PluginOptions, key: string, fallback: number): number {
  const v = options[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export const register: Register = (on: On, options: PluginOptions) => {
  const config: Options = {
    preserveRecentMessages: Math.max(0, Math.floor(optionNumber(options, 'preserveRecentMessages', DEFAULTS.preserveRecentMessages))),
    minReductionRatio: optionNumber(options, 'minReductionRatio', DEFAULTS.minReductionRatio),
  };

  on('session.compact', async ($, event, next) => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'));
    const dir = home ? `${home.replace(/\\/g, '/')}/.claude/fast-compact` : undefined;
    /** One JSON line per compaction in <home>/.claude/fast-compact/log.jsonl (newest LOG_LINES kept). */
    const log = async (entry: Record<string, unknown>) => {
      if (!dir) return;
      try {
        let old = '';
        try {
          old = await $.fs.read(`${dir}/log.jsonl`);
        } catch {
          // first line
        }
        const lines = old.split('\n').filter(Boolean).slice(-(LOG_LINES - 1));
        const session = await $.session.id().catch(() => undefined);
        lines.push(JSON.stringify({ t: new Date().toISOString(), session, trigger: event.trigger, messages: event.messages.length, ...entry }));
        await $.fs.write(`${dir}/log.jsonl`, `${lines.join('\n')}\n`);
      } catch {
        // logging never blocks a compaction
      }
    };
    // Only the person's own /compact (or a plugin's) on the main conversation.
    if ((event.trigger !== 'manual' && event.trigger !== 'plugin') || event.agentId) {
      await log({ outcome: 'builtin', reason: event.agentId ? 'subagent' : `trigger ${event.trigger}` });
      return next(event);
    }
    if (!dir) return next(event);
    const armPath = `${dir}/arm.json`;
    let arm: Arm | undefined;
    try {
      arm = JSON.parse(await $.fs.read(armPath)) as Arm;
    } catch {
      await log({ outcome: 'builtin', reason: 'not armed' });
      return next(event);
    }
    if (!isArmed(arm, Date.now())) {
      await log({ outcome: 'builtin', reason: arm?.usedAt ? 'arm already used' : 'arm expired' });
      return next(event);
    }
    try {
      await $.fs.write(armPath, JSON.stringify({ ...arm, usedAt: Date.now() }));
    } catch {
      return next(event); // cannot consume the arm: do not risk running twice
    }

    const toast = (text: string) => {
      $.ui.log(`fast-compact: ${text}`);
      $.ui.toast(`fast-compact: ${text}`, { timeoutMs: 15_000 });
    };
    try {
      const plan = planCompaction(event.messages, config);
      if (plan.stats.reduction < config.minReductionRatio) {
        toast(`fallback to built-in summary (only ${summarize(plan.stats)})`);
        await log({ outcome: 'builtin', reason: 'below minReductionRatio', stats: plan.stats });
        return next(event);
      }
      toast(`verbatim, no summary: ${summarize(plan.stats)}`);
      await log({ outcome: 'verbatim', stats: plan.stats });
      return { messages: plan.messages };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast(`fallback to built-in summary (${reason})`);
      await log({ outcome: 'builtin', reason: `error: ${reason}` });
      return next(event);
    }
  }).catch(($, event, next) => next(event)); // a failed or overrun hook: built-in summary
};
