import json, os, re, sys, time
from collections import Counter
sys.path.insert(0, r"D:\XionTechs\Laya\routing")
os.environ.setdefault("LAYA_DEVICE", "cpu"); os.environ.setdefault("LAYA_MODELS", "english")
from laya import Router
from run_routing import QUESTION
FILE_RE = re.compile(r"[\w./\-]+\.(?:py|js|jsx|ts|tsx|cs|java|go|json|ya?ml|md|sql|sh|tf)\b", re.I)
items = {str(o["id"]): o for o in json.load(open("items.json", encoding="utf-8"))}
labels = json.load(open("labels.json"))
T = ["haiku", "sonnet", "opus"]
r = Router(); r.predict({"request": "warm"}, QUESTION)
def run(make):
    out = []
    for i, lab in labels.items():
        o = items[i]; t = time.perf_counter()
        a = r.predict(make(o), QUESTION, max_len=1024)["answers"]["model"]["probabilities"]
        out.append((i, lab, max(a, key=a.get), max(a.values()), round((time.perf_counter() - t) * 1000), a))
    return out
variants = {"title_only": lambda o: {"request": o["title"]},
            "title+desc": lambda o: {"request": (o["title"] + ". " + o["desc"])[:2000], "files_mentioned": str(len(set(FILE_RE.findall(o["desc"])))), "has_stack_trace": "no", "conversation_turns": "1"}}
res = {k: run(v) for k, v in variants.items()}
for k, v in res.items():
    n = len(v); ok = sum(x[1] == x[2] for x in v)
    print(f"\n{k}: {ok}/{n} exact, under={sum(T.index(x[2]) < T.index(x[1]) for x in v)}, over={sum(T.index(x[2]) > T.index(x[1]) for x in v)}, mix={dict(Counter(x[2] for x in v))}, median ms={sorted(x[4] for x in v)[n//2]}")
    for lab in T:
        print("  label", lab, "->", dict(Counter(x[2] for x in v if x[1] == lab)))
    print("  wrong:", ", ".join(f"#{x[0]} {x[1]}->{x[2]} ({x[3]:.2f})" for x in v if x[1] != x[2]))
    print("  top prob >=0.6:", [(sum(x[1]==x[2] for x in v if x[3]>=th), sum(x[3]>=th for x in v)) for th in (0.5, 0.6, 0.7)])
json.dump({k: [list(x[:5]) for x in v] for k, v in res.items()}, open("results.json", "w"))
