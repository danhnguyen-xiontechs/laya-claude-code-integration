# eval_history.py - cham cac cach phan loai tren task lich su (tasks.json tu fetch_tasks.py --from-git).
# Dap an tu dong: cac module ma feature doc co nhac toi file .cs do commit cua task da sua (nhieu nhat).
# So sanh:
#   A  Laya doc du danh muc (max_len 2048 / head_max_len 768)
#   B  chi BM25
#   C  BM25 top-k -> Laya (max_len 1024 / head_max_len 192)   <- cach dang dung
#   <tool python> eval_history.py [--skip-full]
# Ket qua: eval_results.json + eval_report.md trong data_dir (khong commit: co title cua task).
import argparse, json, os, time
from common import BM25, data_path, laya_choose, load_catalog, load_config, task_text

COMMON_FILES = {"CacheKeys", "D365EntityNames", "D365DateConverter", "BatchQueryService"}  # file dung chung, khong mang tin hieu module

ap = argparse.ArgumentParser()
ap.add_argument("--config")
ap.add_argument("--skip-full", action="store_true", help="bo cach A (cham nhat, khoang 3 s moi task)")
args = ap.parse_args()
cfg = load_config(args.config)
catalog = load_catalog(cfg)
bm25 = BM25(cfg, catalog)
tasks = json.load(open(data_path(cfg, "tasks.json"), encoding="utf-8"))
k = cfg["laya"]["shortlist_k"]


def truth_of(t):
    changed = {os.path.basename(f)[:-3] for f in t.get("files", []) if f.endswith(".cs") and "Test" not in f} - COMMON_FILES
    sc = {m: len(changed & set(v["code_files"])) for m, v in catalog.items()}
    best = max(sc.values()) if sc else 0
    return sorted(m for m, v in sc.items() if v == best) if best else None


t0 = time.perf_counter()
laya_choose(cfg, catalog, list(catalog)[:k], {"title": "warm up"})
load_s = round(time.perf_counter() - t0, 1)
rows = []
for t in tasks:
    r = {"id": t["id"], "type": t["type"], "chars": len(task_text(t)), "truth": truth_of(t)}
    r["B"] = bm25.rank(task_text(t))
    c, r["C_ms"] = laya_choose(cfg, catalog, r["B"][:k], t)
    r["C"], r["C_p"] = [m for m, _ in c], c[0][1]
    if not args.skip_full:
        a, r["A_ms"] = laya_choose(cfg, catalog, list(catalog), t, max_len=2048, head_max_len=768)
        r["A"], r["A_p"] = [m for m, _ in a], a[0][1]
    rows.append(r)
    print(f"{t['id']} truth={r['truth']} B={r['B'][0]} C={r['C'][0]}({r['C_p']:.2f})" + (f" A={r['A'][0]}" if "A" in r else ""))

clear = [r for r in rows if r["truth"]]
hit = lambda r, s, n: any(x in r["truth"] for x in r[s][:n])
med = lambda xs: sorted(xs)[len(xs) // 2] if xs else None
summary = {"modules": len(catalog), "tasks": len(rows), "tasks_with_truth": len(clear), "load_s": load_s, "shortlist_k": k}
for s, n in (("A", 3), ("B", k), ("C", 3)):
    if clear and s in clear[0]:
        summary[s] = {"hit1": sum(hit(r, s, 1) for r in clear), "hit3": sum(hit(r, s, 3) for r in clear),
                      f"hit{n}": sum(hit(r, s, n) for r in clear), "ms_median": med([r.get(f"{s}_ms") for r in rows if r.get(f"{s}_ms")])}
json.dump({"summary": summary, "rows": rows}, open(data_path(cfg, "eval_results.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

lines = [f"# Eval ado-classify ({time.strftime('%Y-%m-%d %H:%M')})", "",
         f"{summary['modules']} module, {summary['tasks']} task, {summary['tasks_with_truth']} task co dap an. Nap Laya {load_s} s.", "",
         "| Cach | hit@1 | hit@3 | Ghi chu |", "|---|---|---|---|"]
names = {"A": "A. Laya doc du danh muc (2048/768)", "B": "B. Chi BM25", "C": f"C. BM25 top {k} -> Laya (1024/192)"}
for s in ("A", "B", "C"):
    if s in summary:
        x = summary[s]
        note = f"hit@{k} = {x[f'hit{k}']} (do phu cua buoc loc)" if s == "B" else f"trung vi {x['ms_median']} ms/task"
        lines.append(f"| {names[s]} | {x['hit1']}/{len(clear)} | {x['hit3']}/{len(clear)} | {note} |")
lines += ["", "| ID | Loai | Dap an | B top 1 | C top 1 (p) | A top 1 |", "|---|---|---|---|---|---|"]
for r in rows:
    lines.append(f"| {r['id']} | {r['type']} | {', '.join(r['truth'] or ['(khong co)'])} | {r['B'][0]} | {r['C'][0]} ({r['C_p']:.2f}) | {r.get('A', ['-'])[0]} |")
open(data_path(cfg, "eval_report.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(json.dumps(summary, indent=1))
print("->", data_path(cfg, "eval_report.md"))
