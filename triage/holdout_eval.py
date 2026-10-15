# holdout_eval.py - so sanh cong bang tren bo de moi (dataset/holdout.jsonl, chua ai xem truoc):
#   Laya  : cau hinh tot nhat da dong bang tu ablate2 (23 nhom con -> 8, input = doan nhieu tu khoa loi nhat)
#   Sonnet: claude -p --model sonnet, doc log da lam sach (toi da 200 dong cuoi), chon 1 trong 8 nhom BASE
# Can laya-serve dang chay. Claude chay qua goi Max (OAuth), cwd = thu muc tam de khong nap hook/CLAUDE.md cua repo.
# Chay:  python triage/holdout_eval.py   -> ghi triage/holdout_results.json
import json, os, statistics, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import categories  # noqa: E402
import eval as ev  # noqa: E402
from ablate2 import FINE, FINE_Q  # noqa: E402
from chunker import clean, chunk  # noqa: E402

CLAUDE = os.environ.get("CLAUDE_BIN", r"C:\Users\ADMIN\AppData\Roaming\npm\claude.cmd")
SONNET_MAX_LINES = 200
PROMPT = """Classify the failure in this command output into exactly one category.

Categories:
{cats}

Command: {command}
Output:
```
{log}
```

Reply with only the category key, nothing else."""


def run_laya(c: dict) -> dict:
    L = clean(c["error"])
    ch = chunk(L)
    a, t = ev.laya({"command": c["command"], "output_tail": ch[ev.kw_chunk(ch)]["text"]}, {"category": categories.question(FINE_Q)})
    p = a["category"]["probabilities"]
    raw = max(p, key=p.get)
    return {"pred": FINE[raw][0], "raw": raw, "prob": round(p[raw], 3), "ms": round(t)}


def run_sonnet(c: dict, cwd: str) -> dict:
    cats = "\n".join(f"- {k}: {v}" for k, v in categories.BASE.items())
    log = "\n".join(clean(c["error"])[-SONNET_MAX_LINES:])
    prompt = PROMPT.format(cats=cats, command=c["command"], log=log)
    cmd = [CLAUDE, "-p", "--model", "sonnet", "--tools", "", "--strict-mcp-config",
           "--no-session-persistence", "--output-format", "json"]
    t = time.perf_counter()
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", cwd=cwd, timeout=180)
    ms = (time.perf_counter() - t) * 1000
    try:
        out = json.loads(r.stdout)
        text = out["result"].strip().strip("`").strip()
        u = out["usage"]
        tokens = u["input_tokens"] + u["cache_creation_input_tokens"] + u["cache_read_input_tokens"] + u["output_tokens"]
        cost = out.get("total_cost_usd", 0)
    except (ValueError, KeyError):
        text, tokens, cost = "ERROR: " + (r.stderr or r.stdout)[:200], 0, 0
    pred = text if text in categories.BASE else "invalid"
    return {"pred": pred, "raw": text[:60], "ms": round(ms), "tokens": tokens, "cost_usd": cost}


def main() -> None:
    cases = [json.loads(l) for l in open(os.path.join(HERE, "dataset", "holdout.jsonl"), encoding="utf-8")]
    laya = [run_laya(c) for c in cases]
    print("laya done", flush=True)
    with tempfile.TemporaryDirectory() as cwd, ThreadPoolExecutor(4) as pool:
        sonnet = list(pool.map(lambda c: run_sonnet(c, cwd), cases))
    rows, n = [], len(cases)
    for c, l, s in zip(cases, laya, sonnet):
        rows.append({"id": c["id"], "gold": c["category"], "laya": l, "sonnet": s})
        print(c["id"], c["category"], "| laya:", l["pred"], "| sonnet:", s["pred"], flush=True)

    def acc(k, rs):
        return round(sum(r[k]["pred"] == r["gold"] for r in rs) / max(1, len(rs)), 3)

    laya_conf = [r for r in rows if r["laya"]["prob"] >= 0.6]
    summary = {
        "n": n,
        "laya": {"accuracy": acc("laya", rows), "p50_ms": round(statistics.median(r["laya"]["ms"] for r in rows)),
                 "p>=0.6": {"coverage": round(len(laya_conf) / n, 3), "accuracy": acc("laya", laya_conf)}},
        "sonnet": {"accuracy": acc("sonnet", rows), "p50_ms": round(statistics.median(r["sonnet"]["ms"] for r in rows)),
                   "avg_tokens": round(statistics.mean(r["sonnet"]["tokens"] for r in rows)),
                   "total_cost_usd_list_price": round(sum(r["sonnet"]["cost_usd"] for r in rows), 3),
                   "invalid": sum(r["sonnet"]["pred"] == "invalid" for r in rows)},
        "per_category": {k: {"n": sum(r["gold"] == k for r in rows),
                             "laya": sum(r["gold"] == k and r["laya"]["pred"] == k for r in rows),
                             "sonnet": sum(r["gold"] == k and r["sonnet"]["pred"] == k for r in rows)}
                         for k in categories.BASE},
    }
    with open(os.path.join(HERE, "holdout_results.json"), "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "rows": rows}, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
