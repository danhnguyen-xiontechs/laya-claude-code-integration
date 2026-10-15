# common.py - phan dung chung cho ado-classify: config, ADO (chi doc), danh muc module, BM25, Laya.
# Chay bang Python cua tool Laya (co san laya, torch). Khong can cai them thu vien.
import collections, glob, html, json, math, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"  # resource id co dinh cua Azure DevOps

DEFAULT_INSTRUCTIONS = "Which feature of the HR system does this request mainly concern?"


# ---------- config ----------

def load_config(path: str | None = None) -> dict:
    """Doc config.local.json (that, khong commit) hoac file truyen vao. config.example.json chi la mau."""
    path = path or os.environ.get("ADO_CLASSIFY_CONFIG") or os.path.join(HERE, "config.local.json")
    if not os.path.exists(path):
        sys.exit(f"Khong thay config: {path}. Chep config.example.json thanh config.local.json roi dien gia tri.")
    cfg = json.load(open(path, encoding="utf-8"))
    cfg.setdefault("laya", {})
    cfg["laya"] = {"checkpoint": "english", "shortlist_k": 8, "max_len": 1024, "head_max_len": 192,
                   "instructions": DEFAULT_INSTRUCTIONS, **cfg["laya"]}
    os.makedirs(cfg["data_dir"], exist_ok=True)
    return cfg


def data_path(cfg: dict, name: str) -> str:
    return os.path.join(cfg["data_dir"], name)


# ---------- ADO (chi doc) ----------

def strip_html(s: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def ado_token(tenant: str) -> str:
    p = subprocess.run(f"az account get-access-token --tenant {tenant} --resource {ADO_RESOURCE} -o json",
                       shell=True, capture_output=True, text=True)
    if p.returncode:
        sys.exit("Khong lay duoc token ADO (thu `az login --tenant <tenant> --allow-no-subscriptions`): " + p.stderr.strip()[:300])
    return json.loads(p.stdout)["accessToken"]


def ado_get(cfg: dict, ids: list[str], fields: list[str]) -> list[dict]:
    """Lay nhieu work item (toi da 200 moi lan). Item khong ton tai / khong co quyen thi bo qua."""
    a = cfg["ado"]
    tok = ado_token(a["tenant"])
    out = []
    for i in range(0, len(ids), 200):
        url = (f"https://dev.azure.com/{a['org']}/_apis/wit/workitems?ids={','.join(ids[i:i + 200])}"
               f"&fields={','.join(fields)}&errorPolicy=omit&api-version=7.1")
        r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": "Bearer " + tok})))
        out += [w["fields"] for w in r["value"] if w]
    return out


def in_scope(cfg: dict, f: dict) -> bool:
    """Chi nhan item cua dung project va co tu khoa scope (vd ESS) trong Area hoac Iteration."""
    a = cfg["ado"]
    kw = a.get("scope_keyword", "")
    return (f.get("System.TeamProject") == a["project"]
            and (kw in f.get("System.AreaPath", "") or kw in f.get("System.IterationPath", "")))


META_FIELDS = ["System.Id", "System.TeamProject", "System.AreaPath", "System.IterationPath", "System.WorkItemType", "System.Title"]
TEXT_FIELDS = ["System.Id", "System.WorkItemType", "System.Title", "System.Description",
               "Microsoft.VSTS.TCM.ReproSteps", "Microsoft.VSTS.Common.AcceptanceCriteria"]


def fetch_tasks(cfg: dict, ids: list[str]) -> tuple[list[dict], list[dict]]:
    """Buoc 1 chi doc metadata de loc scope; buoc 2 moi doc noi dung cua item trong scope.
    Tra ve (tasks trong scope, metadata cua item bi loai)."""
    meta = ado_get(cfg, ids, META_FIELDS)
    keep = [str(f["System.Id"]) for f in meta if in_scope(cfg, f)]
    rejected = [f for f in meta if not in_scope(cfg, f)]
    tasks = []
    for f in ado_get(cfg, keep, TEXT_FIELDS) if keep else []:
        tasks.append({"id": str(f["System.Id"]), "type": f.get("System.WorkItemType"), "title": f.get("System.Title", ""),
                      "desc": strip_html(f.get("System.Description")), "repro": strip_html(f.get("Microsoft.VSTS.TCM.ReproSteps")),
                      "ac": strip_html(f.get("Microsoft.VSTS.Common.AcceptanceCriteria"))})
    return tasks, rejected


def task_text(t: dict, limit: int = 5000) -> str:
    """Title + description + repro steps (Bug) + acceptance criteria, cat o `limit` ky tu."""
    return "\n".join(p for p in (t.get("title"), t.get("desc"), t.get("repro"), t.get("ac")) if p)[:limit]


# ---------- danh muc module tu docs/features ----------

def build_catalog(cfg: dict) -> dict:
    """Quet <repo>/<features_dir>/*.md. Moi file la mot module: mo ta = ten + cau dau muc '1. What it does',
    tu khoa BM25 = ca file, duong dan code = cac path trong muc '2. Where the code is'."""
    fdir = os.path.join(cfg["repo"], cfg.get("features_dir", "docs/features"))
    overrides = cfg.get("catalog_overrides", {})
    cat = collections.OrderedDict()
    for p in sorted(glob.glob(os.path.join(fdir, "*.md"))):
        slug = os.path.basename(p)[:-3]
        if slug.upper() == "README" or slug.startswith("_"):
            continue
        doc = open(p, encoding="utf-8").read()
        m = re.search(r"^# (.+)$", doc, re.M)
        title = re.sub(r"\(.*?\)", "", m.group(1)).strip() if m else slug
        s1 = re.search(r"^## 1\..*?\n(.*?)^## ", doc, re.M | re.S)
        first = ""
        if s1:
            flat = re.sub(r"\s+", " ", re.sub(r"[`*>]", "", s1.group(1))).strip()
            first = re.split(r"(?<=[.:;])\s", flat)[0]
        s2 = re.search(r"^## 2\..*?\n(.*?)^## ", doc, re.M | re.S)
        paths = []
        for x in re.findall(r"`([^`\s]+/[^`\s]*)`", s2.group(1) if s2 else ""):
            # chi giu file .cs hoac thu muc (ket thuc bang /); bo route kieu `api/leave`
            if re.search(r"\.cs$|/$", x) and x not in paths:
                paths.append(x)
        cat[slug] = {"description": overrides.get(slug, f"{title}: {first}"), "paths": paths[:6],
                     "code_files": sorted(set(re.findall(r"(\w+)\.cs\b", doc))), "keywords_source": os.path.relpath(p, cfg["repo"])}
    return cat


def load_catalog(cfg: dict) -> dict:
    p = data_path(cfg, "modules.json")
    if not os.path.exists(p):
        sys.exit("Chua co modules.json, chay build_catalog.py truoc.")
    return json.load(open(p, encoding="utf-8"))


# ---------- BM25 ----------

_tok = lambda s: re.findall(r"[a-z]{3,}", s.lower())


class BM25:
    """BM25 tren toan van tung feature doc. Dung de loc top-k ung vien truoc khi hoi Laya."""

    def __init__(self, cfg: dict, catalog: dict, k1: float = 1.2, b: float = 0.75):
        self.docs = {k: _tok(open(os.path.join(cfg["repo"], v["keywords_source"]), encoding="utf-8").read()) for k, v in catalog.items()}
        self.tf = {k: collections.Counter(d) for k, d in self.docs.items()}
        self.n = len(self.docs)
        self.avg = sum(map(len, self.docs.values())) / max(1, self.n)
        self.df = collections.Counter(w for d in self.docs.values() for w in set(d))
        self.k1, self.b = k1, b

    def rank(self, query: str) -> list[str]:
        q = set(_tok(query))
        sc = {}
        for k, d in self.docs.items():
            tf, s = self.tf[k], 0.0
            for w in q:
                if w in tf:
                    idf = math.log(1 + (self.n - self.df[w] + .5) / (self.df[w] + .5))
                    s += idf * tf[w] * (self.k1 + 1) / (tf[w] + self.k1 * (1 - self.b + self.b * len(d) / self.avg))
            sc[k] = s
        return sorted(sc, key=sc.get, reverse=True)


# ---------- Laya ----------

_router = None


def laya_router():
    """Nap Laya mot lan (khoang 10 s, 2 GB RAM voi checkpoint english), giu trong RAM cho cac lan sau."""
    global _router
    if _router is None:
        import logging, warnings
        warnings.filterwarnings("ignore")
        logging.disable(logging.WARNING)
        from laya import Router
        _router = Router()
    return _router


def laya_choose(cfg: dict, catalog: dict, options: list[str], t: dict, max_len: int | None = None,
                head_max_len: int | None = None) -> tuple[list[tuple[str, float]], int]:
    """Hoi Laya chon mot trong `options`. Tra ve ([(module, xac suat)] giam dan, ms)."""
    L = cfg["laya"]
    q = {"area": {"type": "choice", "instructions": L["instructions"],
                  "criteria": {k: catalog[k]["description"] for k in options}}}
    state = {"title": t.get("title", ""), "details": task_text(t)}
    s = time.perf_counter()
    res = laya_router().predict(state, q, model=L["checkpoint"], max_len=max_len or L["max_len"],
                                head_max_len=head_max_len or L["head_max_len"])
    ms = round((time.perf_counter() - s) * 1000)
    p = res["answers"]["area"]["probabilities"]
    return sorted(((k, round(v, 4)) for k, v in p.items()), key=lambda x: -x[1]), ms


def classify(cfg: dict, catalog: dict, bm25: BM25, t: dict) -> dict:
    """Cach C: BM25 lay top-k trong toan bo danh muc, Laya chon trong top-k.
    Laya loi (chua cai, het RAM...) thi tra ket qua BM25 va ghi ro `fallback`."""
    k = cfg["laya"]["shortlist_k"]
    s = time.perf_counter()
    short = bm25.rank(task_text(t))[:k]
    bm_ms = round((time.perf_counter() - s) * 1000, 2)
    out = {"id": t.get("id"), "shortlist": short, "timing_ms": {"bm25": bm_ms}}
    try:
        ranked, ms = laya_choose(cfg, catalog, short, t)
        out["timing_ms"]["laya"] = ms
        out["engine"] = "bm25+laya"
    except Exception as e:  # fail-open ve BM25
        ranked = [(m, None) for m in short]
        out["engine"] = "bm25"
        out["fallback"] = f"{type(e).__name__}: {e}"[:200]
    out["top"] = [{"module": m, "p": p, "paths": catalog[m]["paths"]} for m, p in ranked[:3]]
    return out
