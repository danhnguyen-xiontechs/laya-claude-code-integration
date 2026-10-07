# classify.py - phan loai mot task theo cach C: BM25 lay top-k module, Laya chon mot.
#   <tool python> classify.py --id 20934                 lay task tu ADO (chi doc, phai trong scope) roi phan loai
#   <tool python> classify.py --title "..." --text "..."  phan loai van ban bat ky, khong goi ADO
#   them --json de in JSON (cho script / MCP sau nay)
import argparse, json, time
from common import BM25, classify, fetch_tasks, load_catalog, load_config

ap = argparse.ArgumentParser()
ap.add_argument("--config")
ap.add_argument("--id")
ap.add_argument("--title")
ap.add_argument("--text", default="")
ap.add_argument("--json", action="store_true")
args = ap.parse_args()
if not args.id and not args.title:
    ap.error("can --id hoac --title")
cfg = load_config(args.config)
catalog = load_catalog(cfg)
bm25 = BM25(cfg, catalog)

t0 = time.perf_counter()
if args.id:
    tasks, rejected = fetch_tasks(cfg, [args.id])
    if not tasks:
        raise SystemExit(f"Work item {args.id} khong doc duoc hoac nam ngoai scope ({cfg['ado']['project']} / {cfg['ado'].get('scope_keyword')}).")
    task = tasks[0]
else:
    task = {"id": None, "title": args.title, "desc": args.text}
fetch_ms = round((time.perf_counter() - t0) * 1000)
res = classify(cfg, catalog, bm25, task)
res["timing_ms"]["fetch"] = fetch_ms if args.id else 0
res["title"] = task["title"]

if args.json:
    print(json.dumps(res, ensure_ascii=False, indent=1))
else:
    head = f"ADO #{task['id']} ({task.get('type')})" if task["id"] else "Van ban"
    print(f"{head}: {task['title']}")
    for i, x in enumerate(res["top"]):
        p = f"{x['p']:.2f}" if x["p"] is not None else " -  "
        print(f"  {'->' if i == 0 else '  '} {x['module']:22} {p}  {', '.join(x['paths'][:3])}")
    print(f"  engine={res['engine']} | ung vien BM25: {', '.join(res['shortlist'])}")
    print(f"  thoi gian (ms): {res['timing_ms']}")
    if res.get("fallback"):
        print(f"  Laya loi, dung BM25: {res['fallback']}")
