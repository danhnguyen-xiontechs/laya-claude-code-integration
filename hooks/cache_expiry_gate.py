# cache_expiry_gate.py - UserPromptSubmit hook: stop once before a prompt that would rebuild a large expired cache.
# Rule only (no Laya, no LLM, no network). Basis: audit/summary.md section C - rebuilds after an idle gap longer than
# the cache TTL were ~10% of API-equivalent cost, median context ~240k.
#
# Logic: last main-thread request in the transcript -> context size, TTL used (1h if 1h cache writes were seen,
# else 5m) and its timestamp. If context >= MIN_CONTEXT and idle > TTL, block the prompt ONCE with an explanation.
# Re-submitting within CONFIRM_WINDOW goes through. Fail-open: any error -> allow silently.
#
# Env: CACHE_GATE_MODE=block|warn|off (default block), CACHE_GATE_MIN_CONTEXT (default 100000),
#      CACHE_GATE_CONFIRM_S (default 600), CACHE_GATE_PRICING (default ../audit/pricing.json)
import json, os, sys, tempfile, time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
MODE = os.environ.get("CACHE_GATE_MODE", "block")
MIN_CONTEXT = int(os.environ.get("CACHE_GATE_MIN_CONTEXT", "100000"))
CONFIRM_WINDOW = int(os.environ.get("CACHE_GATE_CONFIRM_S", "600"))
PRICING = os.environ.get("CACHE_GATE_PRICING", os.path.join(HERE, "..", "audit", "pricing.json"))
TAIL_BYTES = 4 * 1024 * 1024
LOG = os.path.join(HERE, "cache_expiry_gate.log.jsonl")


def last_request(path):
    """Scan the transcript tail for the newest main-thread assistant usage. Returns (ts, context, model, ttl_s)."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        f.seek(max(0, size - TAIL_BYTES))
        lines = f.read().decode("utf-8", "replace").splitlines()
    last, saw_1h, saw_5m = None, False, False
    for line in lines:
        if '"assistant"' not in line or '"usage"' not in line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("type") != "assistant" or d.get("isSidechain"):
            continue
        m = d.get("message") or {}
        u = m.get("usage") or {}
        if m.get("model") == "<synthetic>" or not u:
            continue
        cc = u.get("cache_creation") or {}
        if cc.get("ephemeral_1h_input_tokens"):
            saw_1h = True
        if cc.get("ephemeral_5m_input_tokens"):
            saw_5m = True
        last = (d.get("timestamp"), u, m.get("model", ""))
    if not last:
        return None
    t = datetime.fromisoformat(last[0].replace("Z", "+00:00")).timestamp()
    u = last[1]
    ctx = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
    # 5m only when 5m writes were actually seen; unknown TTL -> 1h so a guess never blocks early
    return t, ctx, last[2], 300 if (saw_5m and not saw_1h) else 3600


def rebuild_cost(model, ctx, ttl):
    try:
        models = json.load(open(PRICING, encoding="utf-8"))["models"]
        key = max((k for k in models if model.startswith(k)), key=len)
        p = models[key]
        return ctx * ((p["cache_write_1h"] if ttl == 3600 else p["cache_write_5m"]) - p["cache_read"]) / 1e6
    except Exception:
        return None


def state_file(session_id):
    return os.path.join(tempfile.gettempdir(), f"cache_expiry_gate_{session_id}.json")


def log(rec):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:
        pass


def main():
    if MODE == "off":
        return
    d = json.loads(sys.stdin.read())
    prompt = (d.get("prompt") or "").strip()
    if prompt.startswith("/"):
        return
    info = last_request(d["transcript_path"])
    if not info:
        return
    t, ctx, model, ttl = info
    idle = time.time() - t
    if ctx < MIN_CONTEXT or idle <= ttl:
        return
    sid = d.get("session_id", "x")
    sf = state_file(sid)
    try:
        prev = json.load(open(sf))
    except Exception:
        prev = None
    cost = rebuild_cost(model, ctx, ttl)
    cost_s = f"~${cost:.2f}" if cost is not None else "a full cache rebuild"
    rec = {"ts": time.time(), "session": sid, "context": ctx, "idle_s": int(idle), "ttl_s": ttl, "model": model,
           "est_extra_usd": round(cost, 4) if cost is not None else None}
    if MODE == "block" and prev and time.time() - prev["blocked_at"] < CONFIRM_WINDOW and prev.get("last_ts") == t:
        os.remove(sf)
        log({**rec, "action": "allowed-after-confirm"})
        return
    msg = (f"Cache expired: idle {idle/60:.0f} min > TTL {ttl//60} min, context {ctx/1000:.0f}k tokens. "
           f"Continuing re-writes the whole context to cache ({cost_s} extra, API-equivalent). "
           f"Options: /clear if this is new work, or /compact to shrink it first")
    if MODE == "warn":
        log({**rec, "action": "warned"})
        print(json.dumps({"systemMessage": msg + "."}))
        return
    json.dump({"blocked_at": time.time(), "last_ts": t}, open(sf, "w"))
    log({**rec, "action": "blocked"})
    print(json.dumps({"decision": "block",
                      "reason": msg + f", or send the prompt again within {CONFIRM_WINDOW//60} min to continue anyway."}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail-open
