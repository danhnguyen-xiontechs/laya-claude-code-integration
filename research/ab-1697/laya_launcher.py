"""L1 - Launcher theo intent: Laya phan loai task MOT lan truoc phien, roi chon tap tool / MCP / skill.

Model giu nguyen (do pruning rieng, khong tron voi routing model). Quyet dinh co dinh ca phien -> khong pha prompt cache.
Goi laya-serve (mac dinh http://127.0.0.1:8000).
"""
INTENT_Q = {"intent": {
    "type": "choice",
    "instructions": "What kind of software engineering request is this?",
    "criteria": {  # moi mo ta < 48 token
        "bugfix": "Fix a defect: existing behaviour is wrong and must be corrected in code, usually with a regression test.",
        "feature": "Add new functionality: a new endpoint, screen, flow or capability.",
        "refactor": "Restructure existing code without changing its behaviour.",
        "docs": "Write or update documentation, comments or prose only.",
        "question": "Answer a question or explain code; no code changes.",
        "infra": "Build, CI/CD, deployment, dependency or configuration change.",
    },
}}

CODE = ["Read", "Edit", "Write", "Grep", "Glob", "Bash"]
PROFILES = {  # tools = danh sach schema duoc gui; strict_mcp = bo moi MCP; no_skills = --disable-slash-commands
    "bugfix":   {"tools": CODE, "strict_mcp": True, "no_skills": True},
    "feature":  {"tools": CODE, "strict_mcp": True, "no_skills": True},
    "refactor": {"tools": CODE, "strict_mcp": True, "no_skills": True},
    "infra":    {"tools": CODE, "strict_mcp": True, "no_skills": True},
    "docs":     {"tools": ["Read", "Edit", "Write", "Grep", "Glob"], "strict_mcp": True, "no_skills": True},
    "question": {"tools": ["Read", "Grep", "Glob"], "strict_mcp": True, "no_skills": True},
}
MIN_PROB = 0.5  # duoi nguong -> khong prune (fail open)


def decide(task: str) -> dict:
    # goi laya-serve (model da nong) thay vi nap ban thu hai trong tien trinh: hai ban cung luc het bo nho ao (os error 1455)
    import json, os, urllib.request
    url = os.environ.get("LAYA_URL", "http://127.0.0.1:8000").rstrip("/") + "/v1/systemone"
    body = json.dumps({"state": {"request": task}, "questions": INTENT_Q, "model": "english", "max_len": 1024}).encode()
    with urllib.request.urlopen(urllib.request.Request(url, body, {"content-type": "application/json"}), timeout=60) as r:
        ans = json.load(r)["answers"]["intent"]
    probs = ans["probabilities"]
    intent = max(probs, key=probs.get)
    prof = PROFILES[intent] if probs[intent] >= MIN_PROB else None
    return {"intent": intent, "prob": probs[intent], "probs": probs, "profile": prof}


def cli_args(decision: dict, mcp_empty_path: str) -> list[str]:
    p = decision["profile"]
    if not p:
        return []
    args = ["--tools", ",".join(p["tools"])]
    if p["strict_mcp"]:
        args += ["--strict-mcp-config", "--mcp-config", mcp_empty_path]
    if p["no_skills"]:
        args += ["--disable-slash-commands"]
    return args
