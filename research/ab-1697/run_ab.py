"""Chay task #1697 (pxp-ai PR4854) qua mot cau hinh, trong ban sao sach cua repo tai commit truoc merge.

  <laya tool python> run_ab.py --config plain|launcher|launcher-gate|mcp --run 1

  plain         : Claude Code thuan (tool, MCP, skill mac dinh)
  launcher      : L1 - Laya chon intent -> --tools / --strict-mcp-config / --disable-slash-commands
  launcher-gate : L1 + L2 (hook PreToolUse Read hoi Laya qua laya-serve :8000)
  mcp           : plain + nhac dung MCP laya-router (doi chung cho y tuong "MCP pruning")
Model khong doi giua cac cau hinh. Ket qua: runs/<config>-<run>/{events.jsonl, meta.json, agent.diff, hidden_tests.xml}
"""
import argparse, json, os, shutil, stat, subprocess, sys, time
from pathlib import Path

import laya_launcher

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
SRC = ROOT / "pxp" / "pxp-ai"
VENV = ROOT / "pxp" / ".venv-ai"
BASE, MERGE = "6252ba6d2115881600ebbf8c441a8acbe483c8d6", "9f8560bb94a0cff2e49e83925f15b1d63dc899d3"
HIDDEN = ["tests/unit/flows/test_assignment_results_routing.py", "tests/unit/flows/test_assignment_rubric_routing.py"]
MCP_NUDGE = ("\n\nBefore starting, call the laya-router MCP tool `laya_decide` with a one-line summary of this task "
             "and use its answer to decide which tools and files you need.")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def _force_rm(func, path, _exc):
    os.chmod(path, stat.S_IWRITE)
    func(path)


ap = argparse.ArgumentParser()
ap.add_argument("--config", required=True, choices=["plain", "launcher", "launcher-gate", "mcp"])
ap.add_argument("--run", type=int, default=1)
ap.add_argument("--model", default=None, help="mac dinh: model mac dinh cua Claude Code")
ap.add_argument("--max-turns", type=int, default=60)
a = ap.parse_args()

name = f"{a.config}-{a.run}"
out = HERE / "runs" / name
out.mkdir(parents=True, exist_ok=True)
task_file = HERE / "task.txt"
task = task_file.read_text(encoding="utf-8").strip()

work = Path(os.environ.get("TEMP", "/tmp")) / "laya-ab" / f"1697-{name}"
if work.exists():
    shutil.rmtree(work, onexc=_force_rm)
work.parent.mkdir(parents=True, exist_ok=True)
for cmd in (["git", "clone", "-q", "--no-checkout", str(SRC), str(work)], ["git", "-C", str(work), "checkout", "-q", BASE]):
    r = run(cmd)
    if r.returncode:
        sys.exit(f"{cmd}: {r.stderr}")

meta = {"config": a.config, "run": a.run, "base": BASE}
extra = []
if a.config.startswith("launcher"):
    t0 = time.perf_counter()
    d = laya_launcher.decide(task)
    meta["launcher"] = {**d, "ms": round((time.perf_counter() - t0) * 1000)}
    empty = out / "mcp_empty.json"
    empty.write_text('{"mcpServers": {}}', encoding="utf-8")
    extra = laya_launcher.cli_args(d, str(empty))
if a.config == "launcher-gate":
    hook_cmd = f'"{sys.executable}" "{HERE / "read_gate.py"}"'
    settings = {"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [{"type": "command", "command": hook_cmd, "timeout": 15}]}]}}
    sp = out / "gate_settings.json"
    sp.write_text(json.dumps(settings), encoding="utf-8")
    extra += ["--settings", str(sp)]
prompt = task + (MCP_NUDGE if a.config == "mcp" else "")
meta["extra_args"] = extra

env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "ANTHROPIC", "AI_AGENT", "BAGGAGE"))}
env["PATH"] = str(VENV / "Scripts") + os.pathsep + env.get("PATH", "")
env["VIRTUAL_ENV"] = str(VENV)
env["LAYA_TASK_FILE"] = str(task_file)
env["GATE_LOG"] = str(out / "gate.jsonl")
env["MSYS_NO_PATHCONV"] = "1"
if (out / "gate.jsonl").exists():
    (out / "gate.jsonl").unlink()

cmd = [shutil.which("claude") or "claude", "-p", "--output-format", "stream-json", "--verbose",
       "--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Grep,Glob,Bash",
       "--max-turns", str(a.max_turns)] + (["--model", a.model] if a.model else []) + extra
t0 = time.perf_counter()
p = run(cmd, cwd=work, env=env, input=prompt, timeout=3600)  # prompt qua stdin: shim .cmd cat tham so o dong moi
meta["wall_s"] = round(time.perf_counter() - t0)
(out / "events.jsonl").write_text(p.stdout, encoding="utf-8")
if p.stderr.strip():
    (out / "stderr.txt").write_text(p.stderr, encoding="utf-8")

# diff cua agent (truoc khi dat test an vao)
diff = run(["git", "-C", str(work), "diff"]).stdout
untracked = run(["git", "-C", str(work), "ls-files", "--others", "--exclude-standard"]).stdout.split()
(out / "agent.diff").write_text(diff + "\n--- untracked ---\n" + "\n".join(untracked), encoding="utf-8")
meta["changed_files"] = sorted(set(run(["git", "-C", str(work), "diff", "--name-only"]).stdout.split()) | set(untracked))

py = str(VENV / "Scripts" / "python.exe")
# kiem tra hanh vi C1/C2 (thuoc do chinh)
sc = run([py, str(HERE / "semantic_check.py")], cwd=work)
try:
    meta["semantic"] = json.loads(sc.stdout.strip().splitlines()[-1])
except (ValueError, IndexError):
    meta["semantic"] = {"pass": False, "error": (sc.stdout + sc.stderr)[-400:]}
# test cua chinh agent (ban agent da sua)
run([py, "-m", "pytest", *HIDDEN, "-q", "--tb=no", f"--junitxml={out / 'own_tests.xml'}"], cwd=work)
# hoi quy: test goc (AC2 utterance bi ghim) chay tren code cua agent
run(["git", "-C", str(work), "checkout", BASE, "--"] + HIDDEN)
run([py, "-m", "pytest", *HIDDEN, "-q", "--tb=no", f"--junitxml={out / 'base_tests.xml'}"], cwd=work)
# test an cua PR (tham khao: khoa cau chu cua PR)
run(["git", "-C", str(work), "fetch", "-q", str(SRC), MERGE])
run(["git", "-C", str(work), "checkout", MERGE, "--"] + HIDDEN)
run([py, "-m", "pytest", *HIDDEN, "-q", "--tb=no", f"--junitxml={out / 'hidden_tests.xml'}"], cwd=work)
(out / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
print(f"[{name}] wall={meta['wall_s']}s semantic={meta['semantic'].get('pass')} files={meta['changed_files']} "
      f"launcher={meta.get('launcher', {}).get('intent')}")
