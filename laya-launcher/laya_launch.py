"""laya_launch.py - L1 launcher: chon profile tool/MCP/skill cho mot phien claude TRUOC khi chay.

  python laya_launch.py --task-file task.txt                 # Laya chon intent -> profile, chay `claude -p` (de bai qua stdin)
  python laya_launch.py -i --task "fix bug X"                # phien TUONG TAC, de bai la tin nhan dau
  python laya_launch.py --task-file task.txt --profile bugfix # tu chon, khong goi Laya
  python laya_launch.py --task-file task.txt --dry-run        # chi in lenh, khong chay
  echo "fix bug X" | python laya_launch.py                    # de bai qua stdin
  python laya_launch.py --task-file t.txt -- --model sonnet --max-turns 30   # tham so sau "--" chuyen thang cho claude

Profiles o profiles.json canh file nay. Chi dung thu vien chuan. Laya loi / tat / p < min_prob -> fail-open: chay claude
voi profile "default" trong profiles.json (neu co), khong thi chay claude nguyen ban.
Env: LAYA_URL (mac dinh http://127.0.0.1:8000), LAYA_TIMEOUT (giay, mac dinh 30), LAYA_LAUNCH_LOG (JSONL, mac dinh tat),
     LAYA_CLAUDE_BIN (duong dan claude that; mac dinh tim tren PATH), LAYA_WAIT (giay cho laya-serve len, mac dinh 20).
"""
import argparse, json, os, shutil, socket, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES_FILE = HERE / "profiles.json"


def load_profiles(path: Path = PROFILES_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def claude_bin() -> str:
    """claude that. Dat LAYA_CLAUDE_BIN khi lenh `claude` tren PATH da bi shim de len (tranh goi de quy)."""
    return os.environ.get("LAYA_CLAUDE_BIN") or shutil.which("claude") or "claude"


def _port_open(url: str) -> bool:
    host = url.split("://", 1)[-1].split("/", 1)[0]
    h, _, p = host.partition(":")
    try:
        with socket.create_connection((h, int(p or 80)), timeout=0.5):
            return True
    except OSError:
        return False


def ensure_serve(wait: float | None = None) -> bool:
    """Bat laya-serve nen neu cong chua mo; cho toi da LAYA_WAIT giay. Tra ve True neu cong mo."""
    url = os.environ.get("LAYA_URL", "http://127.0.0.1:8000")
    if _port_open(url):
        return True
    # Uu tien `python -m laya.serve` cua chinh interpreter nay (shim .exe cua uv khong len duoc khi khong co console)
    try:
        import laya.serve  # noqa: F401
        cmd = [sys.executable, "-m", "laya.serve"]
    except ImportError:
        exe = shutil.which("laya-serve")
        if not exe:
            return False
        cmd = [exe]
    env = {**os.environ}
    env.setdefault("LAYA_DEVICE", "cpu")
    env.setdefault("LAYA_HOST", "127.0.0.1")
    log_dir = Path.home() / ".laya"
    log_dir.mkdir(exist_ok=True)
    log = open(log_dir / "laya-serve.log", "ab")
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(cmd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags)
    deadline = time.time() + (wait if wait is not None else float(os.environ.get("LAYA_WAIT", "20")))
    while time.time() < deadline:
        if _port_open(url):
            return True
        time.sleep(0.5)
    return False


def decide(task: str, cfg: dict) -> dict:
    """Hoi laya-serve mot cau choice tren de bai. Tra ve intent, prob, probs. Nem exception neu Laya loi."""
    url = os.environ.get("LAYA_URL", "http://127.0.0.1:8000").rstrip("/") + "/v1/systemone"
    q = {"intent": {"type": "choice", "instructions": cfg["question"], "criteria": cfg["criteria"]}}
    body = json.dumps({"state": {"request": task[:4000]}, "questions": q, "model": "english", "max_len": 1024}).encode()
    req = urllib.request.Request(url, body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=float(os.environ.get("LAYA_TIMEOUT", "30"))) as r:
        probs = json.load(r)["answers"]["intent"]["probabilities"]
    intent = max(probs, key=probs.get)
    return {"intent": intent, "prob": round(probs[intent], 4), "probs": {k: round(v, 4) for k, v in probs.items()}}


def pick_profile(task: str, cfg: dict, forced: str | None = None, serve: bool = True) -> tuple[str | None, dict | None, dict]:
    """Chon ten profile: ep tay, hoac Laya, hoac fail-open ve `default`. Tra ve (ten, profile, rec)."""
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": None, "profile": None}
    name = forced
    if name:
        rec["source"] = "manual"
    else:
        try:
            t0 = time.perf_counter()
            if serve and not ensure_serve():
                raise ConnectionError("laya-serve not reachable")
            d = decide(task, cfg)
            rec.update(laya=d, laya_ms=round((time.perf_counter() - t0) * 1000), source="laya")
            name = d["intent"] if d["prob"] >= cfg.get("min_prob", 0.5) else None
            if name is None:
                rec["source"] = "laya_low_prob"
        except Exception as e:  # fail-open
            rec.update(source="laya_error", error=f"{type(e).__name__}: {e}"[:200])
    if name is None:
        name = "default" if "default" in cfg["profiles"] else None
    profile = cfg["profiles"].get(name) if name else None
    if name and profile is None:
        raise KeyError(f"profile '{name}' khong co trong profiles.json")
    rec["profile"] = name
    return name, profile, rec


def describe(profile: dict | None) -> str:
    """Mot dong mo ta profile cho man hinh: '6 tool · 0 MCP · 0 skill'."""
    if not profile:
        return "nguyen ban (khong cat)"
    tools = f"{len(profile['tools'])} tool" if profile.get("tools") else "tat ca tool"
    mcp = f"{len(profile['mcp'])} MCP" if "mcp" in profile else "MCP mac dinh"
    skills = "0 skill" if profile.get("no_skills") else "skill mac dinh"
    return f"{tools} · {mcp} · {skills}"


def cli_args(profile: dict | None, mcp_cfg_path: Path) -> list[str]:
    """Doi mot profile thanh cac co cua claude CLI."""
    if not profile:
        return []
    args = []
    if profile.get("tools"):
        args += ["--tools", ",".join(profile["tools"])]
    if "mcp" in profile:  # {} = khong MCP nao; {"name": {...}} = chi MCP nay
        mcp_cfg_path.write_text(json.dumps({"mcpServers": profile["mcp"]}), encoding="utf-8")
        args += ["--strict-mcp-config", "--mcp-config", str(mcp_cfg_path)]
    if profile.get("no_skills"):
        args.append("--disable-slash-commands")
    return args


def log_rec(rec: dict) -> None:
    print(json.dumps(rec, ensure_ascii=False), file=sys.stderr)
    log = os.environ.get("LAYA_LAUNCH_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def clean_env() -> dict:
    """Bo env cua app desktop de claude dung dang nhap CLI."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "ANTHROPIC", "AI_AGENT", "BAGGAGE"))}
    env["MSYS_NO_PATHCONV"] = "1"
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--task-file", help="file de bai (mac dinh: doc stdin)")
    ap.add_argument("--task", help="de bai truc tiep")
    ap.add_argument("-i", "--interactive", action="store_true", help="mo phien chat tuong tac (khong -p); de bai la tin nhan dau")
    ap.add_argument("--profile", help="ep profile, bo qua Laya")
    ap.add_argument("--profiles", default=str(PROFILES_FILE), help="file profiles.json khac")
    ap.add_argument("--cwd", default=".", help="repo dich")
    ap.add_argument("--no-serve", action="store_true", help="khong tu bat laya-serve")
    ap.add_argument("--dry-run", action="store_true", help="chi in quyet dinh va lenh")
    ap.add_argument("claude_args", nargs="*", help="tham so them cho claude, dat sau --")
    a = ap.parse_args()

    cfg = load_profiles(Path(a.profiles))
    if a.task:
        task = a.task.strip()
    elif a.task_file:
        task = Path(a.task_file).read_text(encoding="utf-8").strip()
    elif a.interactive:
        sys.exit("che do tuong tac can --task hoac --task-file (stdin la ban phim cua phien)")
    else:
        task = sys.stdin.read().strip()
    if not task:
        sys.exit("khong co de bai (dung --task, --task-file hoac stdin)")

    try:
        name, profile, rec = pick_profile(task, cfg, a.profile, serve=not a.no_serve)
    except KeyError as e:
        sys.exit(str(e))
    mcp_cfg = Path(os.environ.get("TEMP", "/tmp")) / f"laya_launch_mcp_{os.getpid()}.json"
    extra = cli_args(profile, mcp_cfg)
    # tuong tac: de bai la tham so cuoi (phien nhan tiep tu ban phim); -p: de bai qua stdin (shim .cmd cat tham so nhieu dong)
    cmd = [claude_bin(), *extra, *a.claude_args, task] if a.interactive else [claude_bin(), "-p", *extra, *a.claude_args]
    rec["cmd"] = cmd[1:]
    log_rec(rec)
    if a.dry_run:
        mcp_cfg.unlink(missing_ok=True)
        return 0
    try:
        if a.interactive:
            return subprocess.call(cmd, cwd=a.cwd, env=clean_env())
        return subprocess.run(cmd, cwd=a.cwd, env=clean_env(), input=task, text=True, encoding="utf-8").returncode
    finally:
        mcp_cfg.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
