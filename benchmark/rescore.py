"""Cham lai results.jsonl cua mot lan chay run_live.py tu cac thu muc lam viec con nguyen (khong goi LLM lai).
Chay:  python rescore.py live/<run>      -> ghi results.rescored.jsonl"""
import json, os, sys
from pathlib import Path
import run_live as rl

run = Path(sys.argv[1])
tasks = {t["id"]: t for t in json.loads((rl.HERE / "tasks.json").read_text(encoding="utf-8"))}
work = Path(os.environ.get("TEMP", "/tmp")) / "laya-bench"
key = {"fixed_sonnet": "A", "llm_router": "B", "laya_router": "C"}
PROJECTS = Path.home() / ".claude" / "projects"


def full_answer(cwd, session):
    """Cau tra loi cuoi cung, day du, tu transcript cua Claude Code (results.jsonl chi giu 300 ky tu dau)."""
    if not (cwd and session):
        return ""
    slug = str(cwd).replace(":", "-").replace("\\", "-").replace("/", "-")
    f = PROJECTS / slug / f"{session}.jsonl"
    if not f.exists():
        return ""
    last = ""
    for line in f.open(encoding="utf-8"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "assistant":
            for b in d.get("message", {}).get("content", []):
                if isinstance(b, dict) and b.get("type") == "text" and b.get("text"):
                    last = b["text"]
    return last


out = []
for line in (run / "results.jsonl").open(encoding="utf-8"):
    d = json.loads(line)
    cwd = Path(d["cwd"]) if d.get("cwd") else None
    if cwd is None:  # ban cu khong ghi cwd: lay thu muc moi nhat khop ten
        cands = sorted(work.glob(f"{key[d['strategy']]}-{d['task']}*"), key=lambda p: p.stat().st_mtime)
        cwd = cands[-1] if cands else None
    d["passed_old"] = d["passed"]
    answer = full_answer(cwd, d.get("session")) or d.get("answer_head", "")
    d["answer_chars"] = len(answer)
    d["passed"] = rl.check(cwd, tasks[d["task"]]["check"], answer) if cwd and not d["is_error"] else False
    d["cwd"] = str(cwd)
    out.append(d)
    print(f'{d["strategy"]:13} {d["task"]:3} {d["passed_old"]!s:5} -> {d["passed"]!s:5}  {cwd.name if cwd else "-"}')
(run / "results.rescored.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in out), encoding="utf-8")
