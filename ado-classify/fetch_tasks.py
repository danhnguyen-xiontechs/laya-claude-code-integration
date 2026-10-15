# fetch_tasks.py - lay work item tu ADO (CHI DOC), chi giu item trong scope (project + tu khoa ESS o Area/Iteration).
#   <tool python> fetch_tasks.py --ids 19427,20934      lay cac item cu the
#   <tool python> fetch_tasks.py --from-git             lay moi item duoc nhac trong commit message cua repo,
#                                                       kem danh sach file ma commit cua item do da sua (de cham diem)
# Ket qua: tasks.json trong data_dir. Khong ghi gi len ADO.
import argparse, collections, json, re, subprocess
from common import data_path, fetch_tasks, load_config

# Cac kieu nhac work item trong commit cua ess-be: "ADO 20934", "TASK-19427", "BUG-19358", "#19424", "bug 19279"
ID_RE = re.compile(r"(?:ADO|TASK|BUG|bug|task|US|#)[\s-]?(\d{5})")


def ids_from_git(repo: str) -> dict[str, set[str]]:
    log = subprocess.run(["git", "-C", repo, "log", "--all", "--format=@@%s", "--name-only"],
                         capture_output=True, text=True, encoding="utf-8").stdout
    files, cur = collections.defaultdict(set), set()
    for line in log.splitlines():
        if line.startswith("@@"):
            cur = set(ID_RE.findall(line))
        elif line.strip():
            for i in cur:
                files[i].add(line.strip())
    return files


ap = argparse.ArgumentParser()
ap.add_argument("--config")
g = ap.add_mutually_exclusive_group(required=True)
g.add_argument("--ids", help="danh sach ID, cach nhau bang dau phay")
g.add_argument("--from-git", action="store_true")
args = ap.parse_args()
cfg = load_config(args.config)

files = ids_from_git(cfg["repo"]) if args.from_git else {}
ids = sorted(files) if args.from_git else [x.strip() for x in args.ids.split(",") if x.strip()]
tasks, rejected = fetch_tasks(cfg, ids)
for t in tasks:
    t["files"] = sorted(files.get(t["id"], []))
json.dump(tasks, open(data_path(cfg, "tasks.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"yeu cau {len(ids)} | trong scope {len(tasks)} | bi loai {len(rejected)} -> {data_path(cfg, 'tasks.json')}")
for f in rejected:
    print(f"  loai {f['System.Id']}: project={f.get('System.TeamProject')} area={f.get('System.AreaPath')} iteration={f.get('System.IterationPath')}")
