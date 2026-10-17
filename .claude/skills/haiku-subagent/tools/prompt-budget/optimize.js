// Prompt Budget Optimizer — keeps an Anthropic Messages payload under a token limit.
// Pipeline: count -> passthrough | (A clean -> B prune oldest turns -> C summarize dropped) -> cache_control.
// Zero dependencies (Node 18+). Uses the free /v1/messages/count_tokens endpoint when
// ANTHROPIC_API_KEY is set; otherwise falls back to a conservative local estimate.

const API = 'https://api.anthropic.com/v1/messages';
const HEADERS = (key) => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
});

export const DEFAULTS = {
  model: 'claude-haiku-5-5',
  limit: 90_000,
  keepTurns: 3,
  summaryReserve: 2_000, // tokens kept free for the Tier C summary
  tier2Threshold: 100_000, // above this, the 5x price tier applies
};

// ---------- token counting ----------

// Conservative: ~3 chars/token over the JSON form (overcounts a little on purpose).
export const estimateTokens = (payload) =>
  Math.ceil(JSON.stringify({ system: payload.system, messages: payload.messages, tools: payload.tools }).length / 3);

export async function countTokens(payload, { model, apiKey, warn }) {
  if (apiKey) {
    try {
      const body = { model, messages: payload.messages };
      if (payload.system) body.system = payload.system;
      if (payload.tools) body.tools = payload.tools; // tool schemas count towards the limit
      const res = await fetch(`${API}/count_tokens`, {
        method: 'POST',
        headers: HEADERS(apiKey),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
      return { tokens: (await res.json()).input_tokens, exact: true };
    } catch (e) {
      warn?.(`Official token count failed (${e.message}); using local estimate.`);
    }
  }
  return { tokens: estimateTokens(payload), exact: false };
}

// ---------- Tier A: heuristic clean-up ----------

function cleanSegment(s, isCode) {
  if (!isCode) {
    s = s
      .replace(/[ \t]+$/gm, '')
      .replace(/(\S)[ \t]{2,}/g, '$1 ')
      .replace(/^\s*([-*_])\1{2,}\s*$/gm, '') // horizontal rules
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1'); // bold markers (not the `2 ** 10` operator)
  }
  return s.replace(/\n{3,}/g, '\n\n');
}

// Collapse runs (>=3) of identical consecutive lines — repetitive log/boilerplate.
function dedupeLines(s) {
  const lines = s.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[i]) j++;
    const n = j - i + 1;
    out.push(lines[i]);
    if (n >= 3 && lines[i].trim().length >= 8) out.push(`[... previous line repeated ${n - 1} more times]`);
    else for (let k = 1; k < n; k++) out.push(lines[i]);
    i = j + 1;
  }
  return out.join('\n');
}

export function cleanText(text) {
  const parts = text.split(/(```[\s\S]*?```)/g); // odd indexes are fenced code
  return dedupeLines(parts.map((p, i) => cleanSegment(p, i % 2 === 1)).join('')).trim();
}

function mapContent(content, fn) {
  if (typeof content === 'string') return fn(content);
  if (!Array.isArray(content)) return content;
  return content.map((b) => {
    if (b?.type === 'text' && typeof b.text === 'string') return { ...b, text: fn(b.text) };
    if (b?.type === 'tool_result') return { ...b, content: mapContent(b.content, fn) };
    return b;
  });
}

const tierA = (payload) => ({
  ...payload,
  system: payload.system && mapContent(payload.system, cleanText),
  messages: payload.messages.map((m) => ({ ...m, content: mapContent(m.content, cleanText) })),
});

// ---------- Tier B/C helpers ----------

const isTurnStart = (m) =>
  m.role === 'user' && !(Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result'));

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) =>
      b?.type === 'text' ? b.text : b?.type === 'tool_use' ? `[tool_use ${b.name}]` : b?.type === 'tool_result' ? `[tool_result] ${blockText(b.content)}` : `[${b?.type}]`,
    )
    .join(' ');
}

const transcript = (msgs, cap = 1500) =>
  msgs.map((m) => `${m.role.toUpperCase()}: ${blockText(m.content).slice(0, cap)}`).join('\n');

function extractiveSummary(msgs, maxChars) {
  const bullets = msgs
    .filter((m) => blockText(m.content).trim())
    .map((m) => `- ${m.role}: ${blockText(m.content).replace(/\s+/g, ' ').trim().slice(0, 240)}`);
  return bullets.join('\n').slice(0, maxChars);
}

async function llmSummary(msgs, { model, apiKey }, maxTokens) {
  const res = await fetch(API, {
    method: 'POST',
    headers: HEADERS(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system:
        'Compress the conversation excerpt into a dense bullet-point summary. Keep decisions, facts, names, numbers, file paths, open questions and user preferences. No preamble.',
      messages: [{ role: 'user', content: transcript(msgs) }],
    }),
  });
  if (!res.ok) throw new Error(`summarize ${res.status}: ${await res.text()}`);
  return (await res.json()).content.map((b) => b.text ?? '').join('').trim();
}

function prependToFirstUser(messages, summary) {
  const note = { type: 'text', text: `Summary of past context:\n${summary}` };
  const [first, ...rest] = messages;
  const content = typeof first.content === 'string' ? [{ type: 'text', text: first.content }] : first.content;
  return [{ ...first, content: [note, ...content] }, ...rest];
}

// ---------- Step 3: cache structure ----------

function withCache(payload) {
  if (!payload.system || (Array.isArray(payload.system) && !payload.system.length)) return payload;
  const blocks = typeof payload.system === 'string' ? [{ type: 'text', text: payload.system }] : payload.system.map((b) => ({ ...b }));
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' };
  return { ...payload, system: blocks };
}

// ---------- main ----------

export async function optimize(input, options = {}) {
  const o = { ...DEFAULTS, apiKey: process.env.ANTHROPIC_API_KEY, summarize: true, ...(input.model && { model: input.model }), ...options };
  // Everything except system/messages (tools, max_tokens, ...) must survive untouched.
  const { system: _s, messages: _m, ...passThrough } = input;
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const count = (p) => countTokens(p, { model: o.model, apiKey: o.apiKey, warn });
  const done = (status, original, payload, final, extra = {}) => ({
    status,
    original_tokens: original,
    final_tokens: final,
    savings_multiplier: original > o.tier2Threshold && final <= o.tier2Threshold ? '5x_saved' : '1x',
    ...(warnings.length && { warnings }),
    ...extra,
    payload: { ...passThrough, ...payload },
  });

  let payload = { ...passThrough, system: input.system, messages: input.messages ?? [] };
  const original = (await count(payload)).tokens;
  if (original <= o.limit) return done('passthrough', original, { system: input.system, messages: input.messages }, original); // untouched

  // Tier A
  payload = tierA(payload);
  let cur = await count(payload);

  // Tier B (+C): drop oldest turns, then summarize what was dropped
  let dropped = [];
  if (cur.tokens > o.limit) {
    const starts = payload.messages.flatMap((m, i) => (isTurnStart(m) ? [i] : []));
    const floor = Math.max(0, starts.length - o.keepTurns); // index into starts we must not drop past
    const target = o.limit - (o.summarize ? o.summaryReserve : 0);
    let cut = 0;
    let factor = cur.tokens / Math.max(1, estimateTokens(payload)); // calibrate local estimate to real counter
    for (let pass = 0; pass < 4; pass++) {
      let k = 0;
      while (k < floor && estimateTokens({ ...payload, messages: payload.messages.slice(starts[k] ?? 0) }) * factor > target) k++;
      cut = k < floor ? starts[k] : starts[floor] ?? 0;
      if (k === 0) cut = 0;
      const test = { ...payload, messages: payload.messages.slice(cut) };
      cur = await count(test);
      if (cur.tokens <= target || cut >= (starts[floor] ?? 0)) break;
      factor = cur.tokens / Math.max(1, estimateTokens(test)); // recalibrate on the kept part and retry
    }
    dropped = payload.messages.slice(0, cut);
    payload = { ...payload, messages: payload.messages.slice(cut) };

    if (dropped.length && o.summarize) {
      const maxTokens = Math.max(200, Math.min(o.summaryReserve, o.limit - cur.tokens - 50));
      let summary;
      try {
        summary = o.apiKey ? await llmSummary(dropped, o, maxTokens) : null;
      } catch (e) {
        warn(`LLM summary failed (${e.message}); used extractive summary.`);
      }
      if (!summary?.trim()) summary = extractiveSummary(dropped, maxTokens * 3);
      payload = { ...payload, messages: prependToFirstUser(payload.messages, summary) };
    }
    cur = await count(payload);
  }

  // Tier D (opt-in): nothing left to prune (e.g. one giant prompt) -> cut the middle of the largest text.
  for (let pass = 0; o.trim && cur.tokens > o.limit && pass < 3; pass++) {
    const wanted = Math.ceil((cur.tokens - o.limit) * 3.2) + 200;
    let big = null;
    payload.messages.forEach((m, mi) =>
      (typeof m.content === 'string' ? [m.content] : m.content.map((b) => b.text ?? '')).forEach((t, bi) => {
        if (!big || t.length > big.t.length) big = { mi, bi, t };
      }),
    );
    if (!big || big.t.length <= 800) break;
    const excessChars = Math.min(wanted, big.t.length - 400); // always leave a head/tail so the task survives
    const keep = big.t.length - excessChars;
    const trimmed = `${big.t.slice(0, Math.ceil(keep / 2))}\n[... ${excessChars} chars trimmed to fit token budget ...]\n${big.t.slice(big.t.length - Math.floor(keep / 2))}`;
    payload = {
      ...payload,
      messages: payload.messages.map((m, mi) =>
        mi !== big.mi ? m
          : typeof m.content === 'string' ? { ...m, content: trimmed }
          : { ...m, content: m.content.map((b, bi) => (bi === big.bi ? { ...b, text: trimmed } : b)) },
      ),
    };
    cur = await count(payload);
  }

  if (cur.tokens > o.limit)
    warn(`Still ${cur.tokens} tokens (> ${o.limit}) after all tiers: system prompt + last ${o.keepTurns} turns alone exceed the budget. Trim them manually.`);
  if (!cur.exact) warn('Token counts are local estimates (set ANTHROPIC_API_KEY for exact counts).');

  payload = withCache(payload);
  return done('optimized', original, payload, cur.tokens, { dropped_messages: dropped.length });
}
