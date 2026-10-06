# build.py - synthetic Claude Code transcript fixtures for cache_expiry_gate tests.
# Timestamps are relative to "now" so idle time is controlled by the test, not by when it runs.
import json
from datetime import datetime, timezone


def iso(age_s, now):
    return datetime.fromtimestamp(now - age_s, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def assistant(age_s, now, context, ttl="1h", model="claude-opus-5-5", cache_meta=True, sidechain=False, write=20_000):
    """One assistant record shaped like a real transcript line. context = input + cache_read + cache_creation."""
    write = min(write, context)
    usage = {"input_tokens": 2, "cache_read_input_tokens": context - write - 2,
             "cache_creation_input_tokens": write, "output_tokens": 100}
    if cache_meta:
        usage["cache_creation"] = {"ephemeral_1h_input_tokens": write if ttl == "1h" else 0,
                                   "ephemeral_5m_input_tokens": write if ttl == "5m" else 0}
    return {"type": "assistant", "isSidechain": sidechain, "timestamp": iso(age_s, now), "sessionId": "fixture",
            "message": {"id": f"msg_{age_s}_{context}", "model": model, "role": "assistant",
                        "content": [{"type": "text", "text": "ok"}], "usage": usage}}


def user(age_s, now, text="hello"):
    return {"type": "user", "timestamp": iso(age_s, now), "message": {"role": "user", "content": text}}


def write(path, records, raw_lines=()):
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
        for line in raw_lines:
            f.write(line + "\n")
    return path
