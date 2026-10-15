# eval.py - Buoc 2: do Laya tren dataset log loi that (triage/dataset/cases.jsonl).
#
# Hai viec cua hook:
#   1. Nhom loi: Laya (choice) so voi baseline regex tu khoa.
#   2. Doan chua nguyen nhan goc (chi tinh case co >= 2 doan): Laya choice (A/B/C), Laya noul tung doan,
#      so voi 2 baseline khong can model: "doan cuoi" va "doan nhieu tu khoa loi nhat".
# Can laya-serve dang chay (LAYA_URL, mac dinh http://127.0.0.1:8000).
#
# Chay:  python triage/eval.py      -> in bang ket qua, ghi triage/eval_results.json
import json, os, re, statistics, string, sys, time, urllib.request
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import categories  # noqa: E402
from chunker import clean, chunk  # noqa: E402

URL = os.environ.get("LAYA_URL", "http://127.0.0.1:8000").rstrip("/") + "/v1/systemone"
STATE_TAIL_LINES = 30
STATE_MAX_CHARS = 2400


def laya(state: dict, questions: dict) -> tuple[dict, float]:
    body = json.dumps({"state": state, "questions": questions, "model": "english", "max_len": 1024}).encode()
    t = time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request(URL, body, {"content-type": "application/json"}), timeout=60) as r:
        ans = json.load(r)["answers"]
    return ans, (time.perf_counter() - t) * 1000


def tail_text(lines: list[str]) -> str:
    return "\n".join(lines[-STATE_TAIL_LINES:])[-STATE_MAX_CHARS:]


# ---- baseline regex cho nhom loi (thu tu quan trong: luat dau tien khop thang)
KW_RULES = [
    ("test_assertion", r"AssertionError|assert .*==|deep-?equal|DID NOT RAISE|Expected:|\bFAILED\b.*test|not ok \d"),
    ("timeout_or_resource", r"Timeout|timed out|MemoryError|out of memory|RecursionError|call stack"),
    ("permission_or_network", r"PermissionError|EPERM|EACCES|Access is denied|ConnectionRefused|ECONNREFUSED|ENOTFOUND|resolve host|socket address"),
    ("dependency_missing", r"No module named|Cannot find (module|package) '[^./]|NU1101|is not recognized|command not found"),
    ("import_or_path", r"Cannot find module '\.|cannot import name|No such file|can't open file|does not provide an export"),
    ("env_or_config", r"environ|environment variable|JSONDecodeError|Missing script|Couldn't find a project|requires Python"),
    ("syntax_or_type", r"SyntaxError|TypeError|ReferenceError|AttributeError|NameError|error CS\d+|error TS\d+"),
]


def kw_category(text: str) -> str:
    for cat, pat in KW_RULES:
        if re.search(pat, text, re.I):
            return cat
    return "other"


ERR_WORDS = re.compile(r"error|exception|fail|assert|denied|refused|not found|cannot|can't|missing|timeout|traceback", re.I)


def kw_chunk(chunks: list[dict]) -> int:
    scores = [len(ERR_WORDS.findall(c["text"])) for c in chunks]
    return max(range(len(chunks)), key=lambda i: (scores[i], i))


def correct_chunk(chunks: list[dict], marker: str) -> set[int]:
    return {i for i, c in enumerate(chunks) if marker in c["text"]}


def main() -> None:
    cases = [json.loads(l) for l in open(os.path.join(HERE, "dataset", "cases.jsonl"), encoding="utf-8")]
    cats = categories.BASE
    rows, lat = [], {"category": [], "chunk_choice": [], "chunk_noul": []}
    for c in cases:
        lines = clean(c["error"])
        state = {"command": c["command"], "output_tail": tail_text(lines)}
        ans, ms = laya(state, {"category": categories.question(cats)})
        lat["category"].append(ms)
        probs = ans["category"]["probabilities"]
        pred = max(probs, key=probs.get)
        row = {"id": c["id"], "gold": c["category"], "laya": pred, "laya_p": round(probs[pred], 3),
               "kw": kw_category("\n".join(lines)), "lines": len(lines)}

        chunks = chunk(lines)
        gold_ix = correct_chunk(chunks, c["marker"])
        row.update(n_chunks=len(chunks), gold_chunks=sorted(gold_ix))
        if len(chunks) >= 2 and gold_ix:
            letters = string.ascii_uppercase[:len(chunks)]
            labeled = "\n".join(f"[{L}] (lines {ch['start']}-{ch['end']})\n{ch['text']}" for L, ch in zip(letters, chunks))
            q = {"type": "choice", "instructions": "Which part of this failed command output shows the root cause of the failure?",
                 "criteria": {L: f"Part [{L}] contains the line that explains why the command failed." for L in letters}}
            a, ms = laya({"command": c["command"], "output": labeled[-STATE_MAX_CHARS * 2:]}, {"part": q})
            lat["chunk_choice"].append(ms)
            pc = a["part"]["probabilities"]
            row["laya_choice"] = letters.index(max(pc, key=pc.get))

            noul = []
            for ch in chunks:
                qn = {"type": "noul", "instructions": "Does this excerpt of a failed command's output show the root cause of the failure?",
                      "criteria": {"true": "Yes: it contains the actual error that made the command fail.",
                                   "false": "No: it is progress output, warnings, passing tests or stack frames only."}}
                a, ms = laya({"command": c["command"], "excerpt": ch["text"]}, {"root": qn})
                lat["chunk_noul"].append(ms)
                noul.append(a["root"]["noul"])
            row["laya_noul"] = max(range(len(chunks)), key=lambda i: (noul[i], i))
            row["noul_scores"] = [round(x, 3) for x in noul]
            row["last"] = len(chunks) - 1
            row["kwc"] = kw_chunk(chunks)
        rows.append(row)
        print(f"{c['id']} gold={c['category']:<22} laya={pred:<22}({probs[pred]:.2f}) kw={row['kw']:<22} "
              f"chunks={len(chunks)} gold={sorted(gold_ix)} choice={row.get('laya_choice')} noul={row.get('laya_noul')}", flush=True)

    n = len(rows)
    out = {"n": n, "category": {}, "chunk": {}, "latency_ms": {}, "thresholds": [], "confusion": {}, "rows": rows}
    out["category"]["laya"] = sum(r["laya"] == r["gold"] for r in rows) / n
    out["category"]["keyword_baseline"] = sum(r["kw"] == r["gold"] for r in rows) / n
    out["confusion"] = dict(Counter(f"{r['gold']} -> {r['laya']}" for r in rows if r["laya"] != r["gold"]))
    for th in (0.0, 0.3, 0.4, 0.5, 0.6, 0.7):
        kept = [r for r in rows if r["laya_p"] >= th]
        out["thresholds"].append({"min_p": th, "coverage": len(kept) / n,
                                  "accuracy": (sum(r["laya"] == r["gold"] for r in kept) / len(kept)) if kept else None})
    multi = [r for r in rows if "laya_choice" in r]
    for k in ("laya_choice", "laya_noul", "last", "kwc"):
        out["chunk"][k] = sum(r[k] in r["gold_chunks"] for r in multi) / len(multi) if multi else None
    out["chunk"]["n_multi"] = len(multi)
    for k, v in lat.items():
        if v:
            out["latency_ms"][k] = {"p50": round(statistics.median(v)), "p90": round(sorted(v)[int(len(v) * 0.9) - 1]), "n": len(v)}
    with open(os.path.join(HERE, "eval_results.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: out[k] for k in ("category", "chunk", "latency_ms", "thresholds", "confusion")}, indent=1))


if __name__ == "__main__":
    main()
