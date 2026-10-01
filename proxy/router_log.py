# router_log.py - Xem proxy da chon model nao cho tung session (Claude Code khong tu hien dieu nay).
# Chay:  python router_log.py            -> tom tat moi session
#        python router_log.py -n 5       -> 5 session gan nhat
#        python router_log.py --watch    -> in tiep khi co quyet dinh moi (Ctrl+C de dung)
import argparse, json, sys, time
from collections import OrderedDict
from pathlib import Path

LOG = Path(__file__).with_name("decisions.jsonl")
TOK = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")


def load():
    sessions: "OrderedDict[str, dict]" = OrderedDict()
    if not LOG.exists():
        return sessions
    for line in LOG.open(encoding="utf-8"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        s = sessions.setdefault(d.get("session", "?"), {"first": d.get("ts", ""), "requests": 0, "errors": 0,
                                                       "models": {}, "tok": dict.fromkeys(TOK, 0)})
        s["last"] = d.get("ts", "")
        a = d.get("action", "")
        if a == "routed":
            s["decision"] = f'{d.get("tier")}  p={d.get("top_prob")}  laya={d.get("laya_ms")}ms' + ("  (fallback)" if d.get("fallback") else "")
            s["request"] = (d.get("state") or {}).get("request", "")[:90].replace("\n", " ")
        elif a == "usage":
            s["requests"] += 1
            if d.get("status") != 200:
                s["errors"] += 1
            m = d.get("model_actual")
            if m:
                s["models"][m] = s["models"].get(m, 0) + 1
            for k in TOK:
                s["tok"][k] += d.get(k) or 0
    return sessions


def show(sessions, n):
    items = list(sessions.items())[-n:] if n else list(sessions.items())
    for sid, s in items:
        print(f"\n[{sid[:8]}]  {s['first'][11:]} -> {s['last'][11:]}   requests={s['requests']}  errors={s['errors']}")
        if s.get("request"):
            print(f"  task:     {s['request']}")
        print(f"  laya:     {s.get('decision', '- (chi co call phu)')}")
        print("  answered: " + (", ".join(f"{m} x{c}" for m, c in s["models"].items()) or "-"))
        t = s["tok"]
        print(f"  tokens:   in={t['input_tokens']}  cache_read={t['cache_read_input_tokens']}  "
              f"cache_new={t['cache_creation_input_tokens']}  out={t['output_tokens']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=0, help="chi in N session gan nhat")
    ap.add_argument("--watch", action="store_true")
    a = ap.parse_args()
    show(load(), a.n)
    if a.watch:
        seen = LOG.stat().st_size if LOG.exists() else 0
        print("\n... dang theo doi (Ctrl+C de dung)")
        try:
            while True:
                time.sleep(1)
                size = LOG.stat().st_size if LOG.exists() else 0
                if size > seen:
                    with LOG.open(encoding="utf-8") as f:
                        f.seek(seen)
                        for line in f:
                            d = json.loads(line)
                            if d.get("action") == "routed":
                                print(f'{d["ts"][11:]}  [{d["session"][:8]}]  LAYA -> {d["tier"]} (p={d["top_prob"]})  '
                                      f'{(d.get("state") or {}).get("request", "")[:60]!r}')
                            elif d.get("action") == "usage" and d.get("model_actual"):
                                print(f'{d["ts"][11:]}  [{d["session"][:8]}]  answered by {d["model_actual"]}  '
                                      f'in={d.get("input_tokens")} cache={d.get("cache_read_input_tokens")} out={d.get("output_tokens")}')
                    seen = size
        except KeyboardInterrupt:
            sys.exit(0)
