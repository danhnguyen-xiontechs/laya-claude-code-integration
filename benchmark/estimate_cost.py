"""UOC TINH chi phi tu results.rescored.jsonl (KHONG phai tu log tho: decisions.jsonl cua lan chay khong co tren may nay).
Moi run co tong token theo session va so request theo model; token duoc chia theo ti le so request (gan dung).
Gia gia dinh: input haiku:sonnet:opus = 1:3:5; cache-read 0.1x, cache-write 1.25x, output 5x gia input.
Chay: python estimate_cost.py live/<run>"""
import json, sys
from collections import defaultdict
from pathlib import Path

TIER_PRICE = {"haiku": 1, "sonnet": 3, "opus": 5}
rows = [json.loads(l) for l in (Path(sys.argv[1]) / "results.rescored.jsonl").open(encoding="utf-8")]
tot, by_tier = defaultdict(float), defaultdict(lambda: defaultdict(float))
for r in rows:
    n = sum((r["models"] or {}).values())
    if not n:
        continue
    unit = (r["input"] or 0) + 0.1 * (r["cache_read"] or 0) + 1.25 * (r["cache_new"] or 0) + 5 * (r["output"] or 0)
    for m, k in r["models"].items():
        t = "haiku" if "haiku" in m else "sonnet" if "sonnet" in m else "opus"
        c = unit * k / n * TIER_PRICE[t]
        tot[r["strategy"]] += c
        by_tier[r["strategy"]][t] += c
base = tot["fixed_sonnet"]
print("| Strategy | Est. cost (relative units) | vs fixed_sonnet | haiku | sonnet | opus |\n|---|---|---|---|---|---|")
for s in ["fixed_sonnet", "llm_router", "laya_router", "fixed_opus"]:
    print(f"| {s} | {tot[s] / 1e6:.2f}M | {tot[s] / base:.2f}x | " + " | ".join(f"{by_tier[s][t] / 1e6:.2f}M" for t in TIER_PRICE) + " |")
