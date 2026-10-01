import json, os, re, sys, time
from collections import Counter
sys.path.insert(0, r"D:\XionTechs\Laya\routing")
os.environ.setdefault("LAYA_DEVICE", "cpu"); os.environ.setdefault("LAYA_MODELS", "english")
from laya import Router
from run_routing import QUESTION
FILE_RE = re.compile(r"[\w./\-]+\.(?:py|js|jsx|ts|tsx|cs|java|go|json|ya?ml|md|sql|sh|tf)\b", re.I)
T = ["haiku", "sonnet", "opus"]
data = []
for f, lf, proj in (("items.json", "labels.json", "PXP"), ("items2.json", "labels2.json", "SmartPlatform")):
    items = {str(o["id"]): o for o in json.load(open(f, encoding="utf-8"))}
    for i, lab in json.load(open(lf)).items():
        data.append({**items[i], "label": lab, "project": proj})
r = Router(); r.predict({"request": "warm"}, QUESTION)
mk = {"title_only": lambda o: {"request": o["title"]},
      "title+desc": lambda o: {"request": (o["title"] + ". " + o["desc"])[:2000], "files_mentioned": str(len(set(FILE_RE.findall(o["desc"])))), "has_stack_trace": "no", "conversation_turns": "1"}}
res = {}
for k, make in mk.items():
    out = []
    for o in data:
        t = time.perf_counter()
        p = r.predict(make(o), QUESTION, max_len=1024)["answers"]["model"]["probabilities"]
        out.append({"id": o["id"], "project": o["project"], "label": o["label"], "pred": max(p, key=p.get), "prob": max(p.values()), "probs": p, "ms": round((time.perf_counter() - t) * 1000), "desc_chars": len(o["desc"])})
    res[k] = out
json.dump(res, open("results_all.json", "w"), indent=1)
def stats(v):
    n = len(v); d = [T.index(x["pred"]) - T.index(x["label"]) for x in v]
    return dict(n=n, exact=sum(g == 0 for g in d), under=sum(g < 0 for g in d), over=sum(g > 0 for g in d), under2=sum(g == -2 for g in d), within1=sum(abs(g) <= 1 for g in d))
for k, v in res.items():
    print(k, stats(v))
    for pj in ("PXP", "SmartPlatform"): print("  ", pj, stats([x for x in v if x["project"] == pj]))
    for lo, hi in ((0, .5), (.5, .7), (.7, 1.1)):
        b = [x for x in v if lo <= x["prob"] < hi]; print("   prob", lo, len(b), sum(x["label"] == x["pred"] for x in b), "under", sum(T.index(x["pred"]) < T.index(x["label"]) for x in b))
    print("   label dist", dict(Counter(x["label"] for x in v)), "median ms", sorted(x["ms"] for x in v)[len(v)//2])
# baselines
v = res["title+desc"]; lab = Counter(x["label"] for x in v)
print("baseline always-sonnet exact", lab["sonnet"], "/", len(v))
def heur(c): return "haiku" if c < 200 else "sonnet" if c < 900 else "opus"
h = [heur(x["desc_chars"]) for x in v]
print("baseline desc-length heuristic exact", sum(a == x["label"] for a, x in zip(h, v)), "under", sum(T.index(a) < T.index(x["label"]) for a, x in zip(h, v)))
