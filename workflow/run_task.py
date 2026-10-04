"""Chay mot task qua mot cau hinh workflow trong ban sao dung mot lan cua repo, roi sinh bao cao theo buoc.

  python run_task.py --name add-json --config static|laya|baseline --task-file task.txt [--repo D:\\Laya] [--main-model sonnet]

  static   : /wf + hook bang model tinh theo loai buoc
  laya     : /wf + hook Laya chon (can laya-serve o cong 8000)
  baseline : mot luong, khong workflow, model mac dinh hien tai (--baseline-model, mac dinh opus)
Ket qua: workflow/runs/<name>/<config>/{result.json, report.md, review.md, final.diff}. Bien moi truong CLAUDE_*/ANTHROPIC_* bi bo
(de claude dung dang nhap cua CLI). Ban sao nam trong %TEMP%\\laya-wf\\<name>-<config>; Bash duoc phep rong vi day la ban sao dung mot lan.
"""
import argparse, json, os, shutil, stat, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).parent
BASH = next((b for b in (r"C:\Program Files\Git\bin\bash.exe",) if Path(b).exists()), "bash")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


ap = argparse.ArgumentParser()
ap.add_argument("--name", required=True)
ap.add_argument("--config", required=True, choices=["static", "laya", "baseline"])
ap.add_argument("--task-file", required=True)
ap.add_argument("--repo", default=str(HERE.parent))
ap.add_argument("--main-model", default="sonnet")
ap.add_argument("--baseline-model", default="opus")
ap.add_argument("--max-turns", type=int, default=40)
a = ap.parse_args()

task = Path(a.task_file).read_text(encoding="utf-8").strip()
out = HERE / "runs" / a.name / a.config
out.mkdir(parents=True, exist_ok=True)
work = Path(os.environ.get("TEMP", "/tmp")) / "laya-wf" / f"{a.name}-{a.config}"
def _force_rm(func, path, _exc):  # file .git tren Windows la chi-doc
    os.chmod(path, stat.S_IWRITE)
    func(path)


if work.exists():
    shutil.rmtree(work, **({"onexc": _force_rm} if sys.version_info >= (3, 12) else {"onerror": _force_rm}))
    if work.exists():
        sys.exit(f"khong xoa duoc {work}")
work.parent.mkdir(parents=True, exist_ok=True)
r = run(["git", "clone", "-q", a.repo, str(work)])
if r.returncode:
    sys.exit("clone failed: " + r.stderr)
if a.config != "baseline":
    r = run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERE / "setup_workflow.ps1"), "-Target", str(work)])
    if r.returncode:
        sys.exit("setup failed: " + r.stdout + r.stderr)

env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "ANTHROPIC", "AI_AGENT", "BAGGAGE"))}
env["MSYS_NO_PATHCONV"] = "1"
env["LAYA_STEP_MODE"] = a.config if a.config != "baseline" else "off"
prompt = task if a.config == "baseline" else f"/wf {task}"
model = a.baseline_model if a.config == "baseline" else a.main_model
tools = "Agent,Read,Edit,Write,Grep,Glob,Bash" if a.config != "baseline" else "Read,Edit,Write,Grep,Glob,Bash"
t0 = time.perf_counter()
p = run([shutil.which("claude") or "claude", "-p", prompt, "--model", model, "--allowedTools", tools, "--permission-mode", "acceptEdits",
         "--max-turns", str(a.max_turns), "--output-format", "json"], cwd=work, env=env, stdin=subprocess.DEVNULL, timeout=3000)
wall = round(time.perf_counter() - t0)
try:
    res = json.loads(p.stdout)
except ValueError:
    res = {"is_error": True, "result": (p.stdout + p.stderr)[-800:], "session_id": None}
(out / "result.json").write_text(json.dumps({**res, "wall_s": wall, "config": a.config, "model": model}, indent=1), encoding="utf-8")
(out / "final.diff").write_text(run(["git", "diff"], cwd=work).stdout + "\n--- untracked ---\n" +
                                run(["git", "ls-files", "--others", "--exclude-standard"], cwd=work).stdout, encoding="utf-8")
print(f"[{a.config}] error={res.get('is_error')} turns={res.get('num_turns')} wall={wall}s session={res.get('session_id')}")
print((res.get("result") or "")[:600])
if res.get("session_id"):
    rep = run([sys.executable, str(HERE / "step_report.py"), res["session_id"], "--out", str(out / "report.md"),
               "--review", str(out / "review.md")], env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    print(rep.stdout[-1800:] if rep.returncode == 0 else rep.stderr[-500:])
