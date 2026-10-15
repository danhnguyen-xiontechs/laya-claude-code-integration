export function createLimiter({ capacity, refillPerSec, now = Date.now }) {
  const buckets = new Map();
  const state = (key) => {
    const t = now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, t }; buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + ((t - b.t) / 1000) * refillPerSec);
    b.t = t;
    return b;
  };
  return {
    take(key, cost = 1) {
      const b = state(key);
      if (cost > capacity) return { ok: false, remaining: Math.floor(b.tokens), retryAfterMs: Infinity };
      if (b.tokens + 1e-9 >= cost) { b.tokens = Math.max(0, b.tokens - cost); return { ok: true, remaining: Math.floor(b.tokens + 1e-9) }; }
      return { ok: false, remaining: Math.floor(b.tokens), retryAfterMs: Math.ceil(((cost - b.tokens) / refillPerSec) * 1000 - 1e-6) };
    },
    peek(key) { return Math.floor(state(key).tokens + 1e-9); },
  };
}
