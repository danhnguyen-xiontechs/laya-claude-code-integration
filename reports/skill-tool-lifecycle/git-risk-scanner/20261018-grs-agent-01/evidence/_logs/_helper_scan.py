import json, os, sys
from jev_skills.git_risk import risk
from jev_skills.git_risk.__main__ import _repo_paths
log = sys.argv[1]
paths = sys.argv[2:] or ["."]
repo, rel = _repo_paths(paths)
cfg = risk.load_config(repo)
res = risk.score_files(repo, "HEAD", rel, cfg, use_jev=cfg["jev"])
print(risk.render_table(res))
rows = [{"file": r["file"], "formula": r["formula"], "risk": r["risk"], "flagged": r["flagged"],
         "jev": {k: r["jev"].get(k) for k in ("status", "p", "kind", "adjust", "error", "reason")}} for r in res["results"]]
u = res.get("jevUsage") or {}
with open(log, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"threshold": res["threshold"], "requests": u.get("requests", 0), "latencyMs": u.get("latencyMs"), "cost": u.get("cost"), "inputTokens": u.get("input_tokens"), "rows": rows}) + "\n")
