"""Buoc D (ban that): chay 15 task trong benchmark/tasks.json qua proxy voi 3 chien luoc, bang Claude Code that.

  A  fixed_sonnet : proxy mode=off, claude --model sonnet          (baseline: mot model co dinh)
  B  llm_router   : proxy mode=llm  (Haiku chon tang)               (baseline: LLM routing)
  C  laya_router  : proxy mode=laya (Laya chon tang)

Moi lan chay: copy repo sang thu muc tam, chay `claude -p` o do, cham ket qua bang lenh `check`, doc token/model that
tu proxy/decisions.jsonl theo session id. Ket qua: benchmark/live/<run>/results.jsonl + report.md.

Chay:  python run_live.py [--tasks e2,m2] [--strategies A,B,C] [--max-turns 40]
Can: proxy dang chay o 8787 voi ROUTER_UPSTREAM that; `claude` da dang nhap; env CLAUDE_*/ANTHROPIC_* cua app desktop bi unset.
"""
import argparse, json, os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
PROXY = "http://127.0.0.1:8787"
DECISIONS = ROOT / "proxy" / "decisions.jsonl"
PY = str(Path(os.environ["APPDATA"]) / "uv/tools/laya/Scripts/python.exe")
STRATEGIES = {"A": ("fixed_sonnet", {"mode": "off"}, ["--model", "sonnet"]),
              "B": ("llm_router", {"mode": "llm", "min_prob": 0}, []),
              "C": ("laya_router", {"mode": "laya", "min_prob": 0}, []),
              "D": ("fixed_opus", {"mode": "off"}, ["--model", "opus"])}  # model mac dinh hien tai cua nguoi dung
ALLOWED = "Read,Edit,Write,Glob,Grep,Bash(python*),Bash(pytest*),Bash(git *),Bash(grep*),Bash(ls*),Bash(cat*),Bash(head*),Bash(wc*)"
EXCLUDE = {".venv", "__pycache__", "results", "live", ".git"}
# "bash" tren PATH cua Windows co the la WSL (chua co distro) -> moi check deu fail. Dung Git Bash ro rang.
BASH = next((b for b in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe")
             if Path(b).exists()), "bash")


def proxy_config(cfg):
    req = urllib.request.Request(PROXY + "/router/config", json.dumps({**cfg, "clear_sessions": True}).encode(),
                                 {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req))


def fresh_copy(dst: Path) -> Path:
    if dst.exists():
        shutil.rmtree(dst, ignore_errors=True)
    if dst.exists():  # file bi khoa (vd. git index) -> dung ten khac
        dst = dst.with_name(dst.name + "-" + str(int(time.time())))
    shutil.copytree(ROOT, dst, ignore=lambda d, names: [n for n in names if n in EXCLUDE])
    subprocess.run(["git", "init", "-q"], cwd=dst, capture_output=True)
    subprocess.run(["git", "add", "-A"], cwd=dst, capture_output=True)
    subprocess.run(["git", "-c", "user.email=b@b", "-c", "user.name=bench", "commit", "-qm", "base"], cwd=dst, capture_output=True)
    return dst


def clean_env():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "ANTHROPIC", "AI_AGENT", "BAGGAGE"))}
    env["ANTHROPIC_BASE_URL"] = PROXY
    return env


def run_claude(cwd, prompt, extra, max_turns):
    cmd = ["claude", "-p", prompt, "--output-format", "json", "--max-turns", str(max_turns),
           "--allowedTools", ALLOWED, "--permission-mode", "acceptEdits", *extra]
    t = time.perf_counter()
    p = subprocess.run(cmd, cwd=cwd, env=clean_env(), capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=1800, shell=True)
    wall = round(time.perf_counter() - t, 1)
    try:
        out = json.loads(p.stdout)
    except ValueError:
        out = {"is_error": True, "result": (p.stdout + p.stderr)[-500:], "session_id": None}
    return out, wall


def check(cwd, spec, answer):
    if spec.startswith("answer_contains:"):
        return spec.split(":", 1)[1].lower() in (answer or "").lower()
    # cho phep ket hop "... && answer_contains:xyz"
    if "answer_contains:" in spec:
        spec, _, needle = spec.rpartition("&& answer_contains:")
        if needle.strip().lower() not in (answer or "").lower():
            return False
    r = subprocess.run([BASH, "-c", spec], cwd=cwd, capture_output=True, text=True, env={**os.environ, "PY": PY})
    return r.returncode == 0


def usage_for(session_id, since_offset):
    agg = {"requests": 0, "errors": 0, "models": {}, "input": 0, "cache_read": 0, "cache_new": 0, "output": 0,
           "router_ms": [], "decisions": []}
    if not session_id or not DECISIONS.exists():
        return agg
    with DECISIONS.open(encoding="utf-8") as f:
        f.seek(since_offset)
        for line in f:
            d = json.loads(line)
            if d.get("session") != session_id:
                continue
            a = d.get("action")
            if a == "usage":
                agg["requests"] += 1
                agg["errors"] += d.get("status") != 200
                m = d.get("model_actual")
                if m:
                    agg["models"][m] = agg["models"].get(m, 0) + 1
                agg["input"] += d.get("input_tokens") or 0
                agg["cache_read"] += d.get("cache_read_input_tokens") or 0
                agg["cache_new"] += d.get("cache_creation_input_tokens") or 0
                agg["output"] += d.get("output_tokens") or 0
            elif a in ("routed", "upgraded"):
                agg["router_ms"].append(d.get("laya_ms") or d.get("router_ms"))
                agg["decisions"].append({"action": a, "tier": d.get("tier"), "p": d.get("top_prob")})
            elif a == "sticky_reeval":
                agg["router_ms"].append(d.get("laya_ms") or d.get("router_ms"))
    return agg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="")
    ap.add_argument("--strategies", default="A,B,C")
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument("--run", default=time.strftime("%Y%m%d-%H%M"))
    a = ap.parse_args()
    tasks = json.loads((HERE / "tasks.json").read_text(encoding="utf-8"))
    if a.tasks:
        want = a.tasks.split(",")
        tasks = [t for t in tasks if t["id"] in want]
    out_dir = HERE / "live" / a.run
    out_dir.mkdir(parents=True, exist_ok=True)
    results_f = (out_dir / "results.jsonl").open("a", encoding="utf-8")
    work = Path(os.environ.get("TEMP", "/tmp")) / "laya-bench"
    for key in a.strategies.split(","):
        name, cfg, extra = STRATEGIES[key]
        print(f"\n=== strategy {key} {name}: {proxy_config(cfg)}", flush=True)
        for t in tasks:
            cwd = fresh_copy(work / f"{key}-{t['id']}")
            offset = DECISIONS.stat().st_size if DECISIONS.exists() else 0
            out, wall = run_claude(cwd, t["prompt"], extra, a.max_turns)
            answer = out.get("result") or ""
            passed = check(cwd, t["check"], answer) if not out.get("is_error") else False
            u = usage_for(out.get("session_id"), offset)
            rec = {"strategy": name, "task": t["id"], "tier_label": t["tier"], "passed": passed, "wall_s": wall, "cwd": str(cwd),
                   "is_error": bool(out.get("is_error")), "num_turns": out.get("num_turns"), "session": out.get("session_id"),
                   "client_usage": out.get("usage"), **u, "answer_head": answer[:300]}
            results_f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            results_f.flush()
            print(f"  {t['id']:3} {t['tier']:6} pass={passed!s:5} wall={wall:6}s turns={out.get('num_turns')} "
                  f"models={u['models']} in={u['input']} cr={u['cache_read']} cn={u['cache_new']} out={u['output']} "
                  f"dec={[(d['tier'], d['p']) for d in u['decisions']]}", flush=True)
    proxy_config({"mode": "laya", "min_prob": 0})
    print("\ndone ->", out_dir)


if __name__ == "__main__":
    main()
