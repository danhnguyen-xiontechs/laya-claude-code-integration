# ablate.py - thi nghiem phu cho phan loai nhom loi: loi do cach hoi hay do model?
# 4 bien the: do dai state (8 dong cuoi / doan nhieu tu khoa nhat / 30 dong cuoi) x co hay khong lua chon "other".
# Chay:  python triage/ablate.py   -> in tien do tung case, ghi triage/ablate_results.json
import json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import categories  # noqa: E402
import eval as ev  # noqa: E402
from chunker import clean, chunk  # noqa: E402

NO_OTHER = {k: v for k, v in categories.BASE.items() if k != "other"}
VARIANTS = {
    "tail8+other": (lambda L, ch: "\n".join(L[-8:]), categories.BASE),
    "kwchunk+other": (lambda L, ch: ch[ev.kw_chunk(ch)]["text"], categories.BASE),
    "tail30-noother": (lambda L, ch: ev.tail_text(L), NO_OTHER),
    "kwchunk-noother": (lambda L, ch: ch[ev.kw_chunk(ch)]["text"], NO_OTHER),
}


def main() -> None:
    cases = [json.loads(l) for l in open(os.path.join(HERE, "dataset", "cases.jsonl"), encoding="utf-8")]
    hits = {k: 0 for k in VARIANTS}
    ms = {k: [] for k in VARIANTS}
    rows = []
    for c in cases:
        L = clean(c["error"])
        ch = chunk(L)
        row = {"id": c["id"], "gold": c["category"]}
        for k, (f, cats) in VARIANTS.items():
            a, t = ev.laya({"command": c["command"], "output_tail": f(L, ch)}, {"category": categories.question(cats)})
            p = a["category"]["probabilities"]
            pred = max(p, key=p.get)
            hits[k] += pred == c["category"]
            ms[k].append(t)
            row[k] = [pred, round(p[pred], 3)]
        rows.append(row)
        print(c["id"], c["category"], {k: row[k][0] for k in VARIANTS}, flush=True)
    n = len(cases)
    summary = {k: {"accuracy": round(hits[k] / n, 3), "p50_ms": round(statistics.median(ms[k]))} for k in VARIANTS}
    with open(os.path.join(HERE, "ablate_results.json"), "w", encoding="utf-8") as f:
        json.dump({"n": n, "summary": summary, "rows": rows}, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
