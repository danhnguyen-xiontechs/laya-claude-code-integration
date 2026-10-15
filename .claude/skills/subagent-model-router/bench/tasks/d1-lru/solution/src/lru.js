export class LruCache {
  #map = new Map();
  #finite = 0; // entries with a finite expiry: only then is a scan for expired entries useful
  constructor({ max, ttlMs = Infinity, now = Date.now }) { this.max = max; this.ttlMs = ttlMs; this.now = now; }
  #expired(e) { return e.exp <= this.now(); }
  #live(key) {
    const e = this.#map.get(key);
    if (!e) return undefined;
    if (this.#expired(e)) { this.#map.delete(key); return undefined; }
    return e;
  }
  get(key) {
    const e = this.#live(key);
    if (!e) return undefined;
    this.#map.delete(key); this.#map.set(key, e);
    return e.value;
  }
  has(key) { return Boolean(this.#live(key)); }
  set(key, value, { ttlMs = this.ttlMs } = {}) {
    const old = this.#map.get(key);
    if (old && old.exp !== Infinity) this.#finite--;
    this.#map.delete(key);
    this.#map.set(key, { value, exp: this.now() + ttlMs });
    if (ttlMs !== Infinity) this.#finite++;
    if (this.#map.size > this.max) {
      if (this.#finite) for (const [k, e] of this.#map) if (this.#expired(e)) { this.#map.delete(k); this.#finite--; }
      while (this.#map.size > this.max) this.#map.delete(this.#map.keys().next().value);
    }
    return this;
  }
  delete(key) { const had = Boolean(this.#live(key)); this.#map.delete(key); return had; }
  get size() { return this.keys().length; }
  keys() { return [...this.#map].filter(([, e]) => !this.#expired(e)).map(([k]) => k); }
}
