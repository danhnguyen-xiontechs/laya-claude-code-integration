"""Tong ket benchmark that tu results.rescored.jsonl (khong goi LLM). Chay: python summarize_live.py live/<run>"""
import json, sys
from collections import defaultdict
from pathlib import Path

run = Path(sys.argv[1])
rows = [json.loads(l) for l in (run / "results.rescored.jsonl").open(encoding="utf-8")]
cost = json.loads((run / "summary.json").read_text(encoding="utf-8"))
ORDER = ["fixed_sonnet", "llm_router", "laya_router", "fixed_opus"]
tasks = {r["task"]: r["tier_label"] for r in rows}
by = defaultdict(list)
for r in rows:
    by[r["strategy"]].append(r)

L = ["# Live benchmark: 15 real Claude Code tasks x 4 strategies", "",
     f"Run `{run.name}`. Pass/fail is re-scored from the kept working dirs (`results.rescored.jsonl`). "
     "Tokens are read from the proxy log (Anthropic's response), not from Claude Code.", "",
     "| Strategy | Pass | Errors | Turns | Wall (s) | Output tok | Cache-read tok | Cache-new tok | Cost (summary.json, units unverified) |",
     "|---|---|---|---|---|---|---|---|---|"]
for s in ORDER:
    v = by[s]
    L.append(f"| {s} | {sum(r['passed'] for r in v)}/{len(v)} | {sum(bool(r['is_error']) for r in v)} | "
             f"{sum(r['num_turns'] for r in v)} | {sum(r['wall_s'] for r in v):.0f} | {sum(r['output'] or 0 for r in v)} | "
             f"{sum(r['cache_read'] or 0 for r in v)} | {sum(r['cache_new'] or 0 for r in v)} | {cost[s]['cost']:.0f} |")
L += ["", "## Pass by task tier", "", "| Strategy | haiku tasks | sonnet tasks | opus tasks |", "|---|---|---|---|"]
for s in ORDER:
    cells = []
    for t in ("haiku", "sonnet", "opus"):
        v = [r for r in by[s] if r["tier_label"] == t]
        cells.append(f"{sum(r['passed'] for r in v)}/{len(v)}")
    L.append(f"| {s} | " + " | ".join(cells) + " |")
L += ["", "## Models that actually answered (requests)", "", "| Strategy | haiku | sonnet | opus |", "|---|---|---|---|"]
for s in ORDER:
    m = defaultdict(int)
    for r in by[s]:
        for k, n in (r["models"] or {}).items():
            m["haiku" if "haiku" in k else "sonnet" if "sonnet" in k else "opus"] += n
    L.append(f"| {s} | {m['haiku']} | {m['sonnet']} | {m['opus']} |")
L += ["", "## Routed tier vs task label (router strategies)", "", "| Strategy | exact | lower than label | higher than label |", "|---|---|---|---|"]
rank = {"haiku": 0, "sonnet": 1, "opus": 2}
for s in ("llm_router", "laya_router"):
    ex = lo = hi = 0
    for r in by[s]:
        ds = [d["tier"] for d in (r["decisions"] or []) if d.get("tier")]
        if not ds:
            continue
        g = rank[ds[-1]] - rank[r["tier_label"]]
        ex += g == 0; lo += g < 0; hi += g > 0
    L.append(f"| {s} | {ex} | {lo} | {hi} |")
bad = [f"{r['strategy']} {r['task']}" for r in rows if r["is_error"]]
L += ["", f"Errored runs: {', '.join(bad) or 'none'} (failed within seconds, likely a rate limit; not re-run).", ""]
(run / "report.md").write_text("\n".join(L), encoding="utf-8")
print("\n".join(L))
