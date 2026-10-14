# eval.py (v2) - Buoc 5 cua plan: Laya vs bo luat don gian, offline, tren log loi THAT da gan nhan (data/to_label.json).
# Ca Laya (categories.py) va luat (rules.py) da dong bang truoc khi xem du lieu (commit 2f2b51f).
# Input cho ca hai: ~50 dong cuoi da lam sach (plan muc 11), toi da 4000 ky tu.
# Cham: gop FLAKY_TEST -> ENVIRONMENT (theo label_rules trong file nhan).
# Do: accuracy, precision/recall/F1 tung nhom, confusion matrix, do chinh xac theo nguong tin cay, false confidence, latency.
# Can laya-serve dang chay. Chay:  python triage/v2/eval.py  -> ghi triage/v2/results.json (chi id + nhan, khong chua log)
import json, os, statistics, sys
from collections import Counter

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # triage/ cho chunker va eval v1 (ham goi Laya)
from chunker import clean  # noqa: E402


def _load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


categories = _load("categories_v2", os.path.join(HERE, "categories.py"))
rules = _load("rules_v2", os.path.join(HERE, "rules.py"))
ev1 = _load("eval_v1", os.path.join(os.path.dirname(HERE), "eval.py"))

TAIL_LINES, MAX_CHARS = 50, 4000


def score(gold: list[str], pred: list[str], labels: list[str]) -> dict:
    per = {}
    for k in labels:
        tp = sum(g == k and p == k for g, p in zip(gold, pred))
        fp = sum(g != k and p == k for g, p in zip(gold, pred))
        fn = sum(g == k and p != k for g, p in zip(gold, pred))
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0.0
        per[k] = {"support": tp + fn, "precision": round(pr, 3), "recall": round(rc, 3), "f1": round(f1, 3)}
    present = [k for k in labels if per[k]["support"]]
    return {"accuracy": round(sum(g == p for g, p in zip(gold, pred)) / len(gold), 3),
            "macro_f1": round(statistics.mean(per[k]["f1"] for k in present), 3),
            "per_class": per,
            "confusion": {g: dict(Counter(p for gg, p in zip(gold, pred) if gg == g)) for g in present}}


def main() -> None:
    data = json.load(open(os.path.join(HERE, "data", "to_label.json"), encoding="utf-8"))
    merge = data.get("label_rules", {}).get("merge_for_scoring", {})
    m = lambda x: merge.get(x, x)  # noqa: E731
    cases = [c for c in data["cases"] if not c["drop"]]
    labels = [k for k in categories.CATEGORIES if k not in merge]
    rows = []
    for c in cases:
        text = "\n".join(clean(c["excerpt"])[-TAIL_LINES:])[-MAX_CHARS:]
        a, ms = ev1.laya({"command": c["command"][:300], "output_tail": text}, {"category": categories.question()})
        p = a["category"]["probabilities"]
        lp = max(p, key=p.get)
        rows.append({"id": c["id"], "gold": m(c["label"]), "laya": m(lp), "laya_raw": lp, "laya_p": round(p[lp], 3),
                     "rule": m(rules.classify(text)), "ms": round(ms)})
        print(c["id"], rows[-1]["gold"], "| laya:", rows[-1]["laya"], rows[-1]["laya_p"], "| rule:", rows[-1]["rule"], flush=True)

    gold = [r["gold"] for r in rows]
    out = {"n": len(rows), "labels": labels, "merge": merge,
           "laya": score(gold, [r["laya"] for r in rows], labels),
           "rule": score(gold, [r["rule"] for r in rows], labels)}
    out["laya"]["latency_ms"] = {"p50": round(statistics.median(r["ms"] for r in rows)),
                                 "p90": round(sorted(r["ms"] for r in rows)[int(len(rows) * 0.9)])}
    out["laya"]["by_confidence"] = []
    for th in (0.0, 0.4, 0.5, 0.6, 0.7, 0.8):
        s = [r for r in rows if r["laya_p"] >= th]
        out["laya"]["by_confidence"].append({"min_p": th, "coverage": round(len(s) / len(rows), 3),
                                             "accuracy": round(sum(r["laya"] == r["gold"] for r in s) / max(1, len(s)), 3)})
    out["laya"]["false_confidence_p>=0.7"] = [r["id"] for r in rows if r["laya_p"] >= 0.7 and r["laya"] != r["gold"]]
    out["laya"]["pred_distribution"] = dict(Counter(r["laya"] for r in rows))
    out["rule"]["pred_distribution"] = dict(Counter(r["rule"] for r in rows))
    out["by_source"] = {s: {k: round(sum(r[k] == r["gold"] for r in rows if r["id"].startswith(s)) /
                                     max(1, sum(r["id"].startswith(s) for r in rows)), 3) for k in ("laya", "rule")}
                        for s in ("tx", "gh")}
    out["rows"] = rows
    json.dump(out, open(os.path.join(HERE, "results.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ("n", "by_source")}, indent=1))
    for k in ("laya", "rule"):
        print(k, "acc", out[k]["accuracy"], "macroF1", out[k]["macro_f1"])


if __name__ == "__main__":
    main()
