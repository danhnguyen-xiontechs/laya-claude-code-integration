// pricing.mjs — list prices (USD per million tokens) used as the quota proxy. On a Max plan there
// is no bill, but usage limits track model cost, so list-price cost is the best available weight.
// Source: claude-api skill model table (cached 2026-10-06). Cache writes: 1.25x input (5 min TTL),
// 2x input (1 h TTL). Checked against a claude -p run: Haiku subagent $0.00499 reproduced exactly.
export const PRICES = {
  opus: { input: 4, output: 20, cacheRead: 0.2 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** claude-opus-5-5 / opus / claude-haiku-4-5 … → 'opus' | 'sonnet' | 'haiku' | null */
export function tierOf(model) {
  const m = String(model ?? '').toLowerCase();
  for (const t of ['opus', 'sonnet', 'haiku']) if (m.includes(t)) return t;
  return null;
}

/** USD for one API usage object at a tier's prices. */
export function usageCost(tier, u = {}) {
  const p = PRICES[tier];
  if (!p || !u) return 0;
  const c5 = u.cache_creation?.ephemeral_5m_input_tokens;
  const c1 = u.cache_creation?.ephemeral_1h_input_tokens;
  const cw = (c5 != null || c1 != null)
    ? (c5 ?? 0) * p.input * 1.25 + (c1 ?? 0) * p.input * 2
    : (u.cache_creation_input_tokens ?? 0) * p.input * 1.25;
  return ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + cw) / 1e6;
}

