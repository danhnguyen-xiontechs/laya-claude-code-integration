# categories.py - bo nhom loi co ban (base) + phan mo rong theo project (.claude/laya-triage.json).
# Moi mo ta la "dap an" Laya doc; Laya cat moi mo ta o 48 token nen giu ngan va tach biet nhau.
import json, os

BASE = {
    "dependency_missing": "A third-party package, library or CLI tool is not installed or cannot be found by the package manager.",
    "import_or_path": "The project's own module, file, export or path is wrong or missing: bad relative import, wrong file name, file not found.",
    "syntax_or_type": "A bug in the code itself: syntax error, type error, undefined variable, wrong attribute or method on a value.",
    "test_assertion": "Tests ran but an assertion failed: the actual value differs from the expected value.",
    "env_or_config": "Missing environment variable, invalid config file, missing script or project file, wrong runtime version.",
    "permission_or_network": "Access denied, file permission error, connection refused, DNS lookup failure or port already in use.",
    "timeout_or_resource": "Operation timed out, out of memory, or recursion / call stack too deep.",
    "other": "None of the above: version control state, a deliberate abort, or an unclear failure.",
}

QUESTION_TEXT = "What kind of failure is shown in this command output?"


def load(project_dir: str | None = None) -> dict:
    """Base + .claude/laya-triage.json cua project (add / disable / override). Loi doc file -> chi dung base."""
    cats = dict(BASE)
    path = os.path.join(project_dir or os.getcwd(), ".claude", "laya-triage.json")
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        return cats
    for k, v in (cfg.get("override") or {}).items():
        if k in cats and isinstance(v, str):
            cats[k] = v
    for k in cfg.get("disable") or []:
        if k != "other":
            cats.pop(k, None)
    for k, v in (cfg.get("add") or {}).items():
        if isinstance(v, str):
            cats[k] = v
    return cats


def question(cats: dict) -> dict:
    return {"type": "choice", "instructions": QUESTION_TEXT, "criteria": cats}
