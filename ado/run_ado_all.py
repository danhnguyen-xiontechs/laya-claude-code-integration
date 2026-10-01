import json, os, re, sys, time
from collections import Counter
sys.path.insert(0, r"D:\XionTechs\Laya\routing")
os.environ.setdefault("LAYA_DEVICE", "cpu"); os.environ.setdefault("LAYA_MODELS", "english")
from laya import Router
from run_routing import QUESTION
FILE_RE = re.compile(r"[\w./\-]+\.(?:py|js|jsx|ts|tsx|cs|java|go|json|ya?ml|md|sql|sh|tf)\b", re.I)
T = ["haiku", "sonnet", "opus"]
data = []
for f, lf, proj in (("items.json", "labels.json", "PXP"), ("items2.json", "labels2.json", "SmartPlatform"), ("items_new.json", "labels3.json", None)):
    items = {str(o["id"]): o for o in json.load(open(f, encoding="utf-8"))}
    for i, lab in json.load(open(lf)).items():
        o = items[i]; data.append({**o, "label": lab, "project": proj or o["project"]})
r = Router(); r.predict({"request": "warm"}, QUESTION)
mk = {"title_only": lambda o: {"request": o["title"]},
      "title+desc": lambda o: {"request": (o["title"] + ". " + o["desc"])[:2000], "files_mentioned": str(len(set(FILE_RE.findall(o["desc"])))), "has_stack_trace": "no", "conversation_turns": "1"}}
res = {}
for k, make in mk.items():
    out = []
    for o in data:
        t = time.perf_counter()
        p = r.predict(make(o), QUESTION, max_len=1024)["answers"]["model"]["probabilities"]
        out.append({"id": o["id"], "project": o["project"], "type": o["type"], "label": o["label"], "pred": max(p, key=p.get), "prob": max(p.values()), "ms": round((time.perf_counter() - t) * 1000), "desc_chars": len(o["desc"])})
    res[k] = out
json.dump(res, open("results_all.json", "w"), indent=1)
def st(v):
    d = [T.index(x["pred"]) - T.index(x["label"]) for x in v]
    return f"n={len(v)} exact={sum(g==0 for g in d)} under={sum(g<0 for g in d)} (2tier {sum(g==-2 for g in d)}) over={sum(g>0 for g in d)} within1={sum(abs(g)<=1 for g in d)}"
for k, v in res.items():
    print("==", k, st(v), "median_ms", sorted(x["ms"] for x in v)[len(v)//2])
    for pj in ("PXP", "SmartPlatform"): print("  ", pj, st([x for x in v if x["project"] == pj]))
    for ty in ("Bug", "Task", "User Story"): print("  ", ty, st([x for x in v if x["type"] == ty]) if any(x["type"] == ty for x in v) else "-")
    print("   has desc:", st([x for x in v if x["desc_chars"]]), "| no desc:", st([x for x in v if not x["desc_chars"]]))
    c = Counter((x["label"], x["pred"]) for x in v)
    for l in T: print("   label", l, {p: c[(l, p)] for p in T})
    for lo, hi in ((0, .5), (.5, .6), (.6, .7), (.7, 1.1)):
        b = [x for x in v if lo <= x["prob"] < hi]; print("   prob", lo, "-", hi, "n", len(b), "exact", sum(x["label"]==x["pred"] for x in b), "under", sum(T.index(x["pred"])<T.index(x["label"]) for x in b))
v = res["title+desc"]; lab = Counter(x["label"] for x in v)
print("label dist", dict(lab), "always-sonnet exact", lab["sonnet"], "under", lab["opus"])
h = [("haiku" if x["desc_chars"] < 200 else "sonnet" if x["desc_chars"] < 900 else "opus") for x in v]
print("length-heuristic exact", sum(a == x["label"] for a, x in zip(h, v)), "under", sum(T.index(a) < T.index(x["label"]) for a, x in zip(h, v)))
tags = lambda x: "haiku" if x["type"] == "Bug" else "sonnet"
print("type-heuristic (Bug->haiku else sonnet) exact", sum(tags(x) == x["label"] for x in v))
