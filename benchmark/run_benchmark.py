# run_benchmark.py - Buoc D (ban offline): so sanh chien luoc chon model tren 60 prompt, qua proxy dang chay dry-run.
# Chua goi LLM that: chi phi la UOC TINH theo ti le gia gia dinh, chat luong la proxy "co bi chon tang thap hon can khong".
# Chay:  python run_benchmark.py   (can router_proxy.py dang chay o cong 8787)
import csv, json, time, urllib.request, uuid
from pathlib import Path

HERE = Path(__file__).parent
PROXY = "http://127.0.0.1:8787"
DECISIONS = HERE.parent / "proxy" / "decisions.jsonl"
TIERS = ["haiku", "sonnet", "opus"]
# GIA DINH: ti le gia haiku : sonnet : opus = 1 : 3 : 5, moi task ton cung so token o moi model.
COST = {"haiku": 1, "sonnet": 3, "opus": 5}
FALLBACK = "sonnet"


def call_proxy(prompt, run_id):
    body = {"model": "claude-sonnet-5-5", "max_tokens": 16, "metadata": {"user_id": run_id},
            "messages": [{"role": "user", "content": prompt}]}
    req = urllib.request.Request(PROXY + "/v1/messages", json.dumps(body).encode(), {"content-type": "application/json"})
    t = time.perf_counter()
    urllib.request.urlopen(req).read()
    return round((time.perf_counter() - t) * 1000)


def score(name, rows, picks, overhead_ms=0):
    n = len(rows)
    exp = [TIERS.index(r["tier"]) for r in rows]
    got = [TIERS.index(p) for p in picks]
    cost = sum(COST[p] for p in picks)
    return {"strategy": name, "exact": sum(e == g for e, g in zip(exp, got)),
            "under": sum(g < e for e, g in zip(exp, got)), "over": sum(g > e for e, g in zip(exp, got)),
            "under2": sum(e - g == 2 for e, g in zip(exp, got)), "cost": cost,
            "mix": "/".join(str(picks.count(t)) for t in TIERS), "overhead_ms": overhead_ms, "n": n}


def main():
    rows = list(csv.DictReader(open(HERE.parent / "routing" / "prompts.csv", encoding="utf-8")))
    run_id = "bench-" + uuid.uuid4().hex[:8]
    before = len(DECISIONS.read_text(encoding="utf-8").splitlines()) if DECISIONS.exists() else 0
    wall = [call_proxy(r["prompt"], run_id) for r in rows]
    decs = [json.loads(l) for l in DECISIONS.read_text(encoding="utf-8").splitlines()[before:]]
    assert len(decs) == len(rows) and all(d["action"] == "routed" for d in decs), "log khong khop"
    med = sorted(wall)[len(wall) // 2]

    out = [score("oracle (nhan dung)", rows, [r["tier"] for r in rows]),
           score("manual: always opus", rows, ["opus"] * len(rows)),
           score("manual: always sonnet", rows, ["sonnet"] * len(rows))]
    for thr in [0.0, 0.4, 0.5, 0.6, 0.7]:
        picks = [d["laya_tier"] if d["top_prob"] >= thr else FALLBACK for d in decs]
        s = score(f"laya proxy, min_prob={thr}", rows, picks, med)
        s["fallbacks"] = sum(d["top_prob"] < thr for d in decs)
        out.append(s)

    base = out[1]["cost"]
    lines = ["# Routing benchmark (offline, dry-run)", "",
             f"60 synthetic prompts (20 per tier) sent through the proxy as 60 new sessions. Run id `{run_id}`.",
             "No LLM was called. Cost is an estimate under an assumed price ratio haiku:sonnet:opus = 1:3:5 "
             "and equal tokens per task. 'Under-routed' (picked a weaker tier than the label) is the quality-risk proxy.", "",
             "| Strategy | Exact | Under-routed | of which 2 tiers | Over-routed | Mix h/s/o | Est. cost vs always-opus | Fallbacks | Router overhead (median) |",
             "|---|---|---|---|---|---|---|---|---|"]
    for s in out:
        lines.append(f"| {s['strategy']} | {s['exact']}/{s['n']} | {s['under']} | {s['under2']} | {s['over']} | {s['mix']} | "
                     f"{s['cost'] / base:.0%} | {s.get('fallbacks', '-')} | {s['overhead_ms'] or '-'}{' ms' if s['overhead_ms'] else ''} |")
    lines += ["", "LLM routing (Haiku as router): not run, no API access yet.", ""]
    report = "\n".join(lines)
    (HERE / "report.md").write_text(report, encoding="utf-8")
    (HERE / "results.json").write_text(json.dumps({"summary": out, "decisions": decs}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
