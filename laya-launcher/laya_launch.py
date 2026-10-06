"""laya_launch.py - L1 launcher: chon profile tool/MCP/skill cho mot phien `claude -p` TRUOC khi chay.

  python laya_launch.py --task-file task.txt                 # Laya chon intent -> profile
  python laya_launch.py --task-file task.txt --profile bugfix # tu chon, khong goi Laya
  python laya_launch.py --task-file task.txt --dry-run        # chi in lenh, khong chay
  echo "fix bug X" | python laya_launch.py                    # de bai qua stdin
  python laya_launch.py --task-file t.txt -- --model sonnet --max-turns 30   # tham so sau "--" chuyen thang cho claude

Profiles o profiles.json canh file nay. Chi dung thu vien chuan. Laya loi / tat / p < min_prob -> fail-open: chay claude
voi profile "default" trong profiles.json (neu co), khong thi chay claude nguyen ban.
Env: LAYA_URL (mac dinh http://127.0.0.1:8000), LAYA_TIMEOUT (giay, mac dinh 30), LAYA_LAUNCH_LOG (JSONL, mac dinh tat).
"""
import argparse, json, os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES_FILE = HERE / "profiles.json"


def load_profiles(path: Path = PROFILES_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--task-file", help="file de bai (mac dinh: doc stdin)")
    ap.add_argument("--profile", help="ep profile, bo qua Laya")
    ap.add_argument("--profiles", default=str(PROFILES_FILE), help="file profiles.json khac")
    ap.add_argument("--cwd", default=".", help="repo dich")
    ap.add_argument("--dry-run", action="store_true", help="chi in quyet dinh va lenh")
    ap.add_argument("claude_args", nargs="*", help="tham so them cho claude, dat sau --")
    a = ap.parse_args()

    cfg = load_profiles(Path(a.profiles))
    task = Path(a.task_file).read_text(encoding="utf-8").strip() if a.task_file else sys.stdin.read().strip()
    if not task:
        sys.exit("khong co de bai (dung --task-file hoac stdin)")

    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": None, "profile": None}
    name = a.profile
    if name:
        rec["source"] = "manual"
    else:
        try:
            t0 = time.perf_counter()
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
        sys.exit(f"profile '{name}' khong co trong {a.profiles}")
    rec["profile"] = name

    mcp_cfg = Path(os.environ.get("TEMP", "/tmp")) / f"laya_launch_mcp_{os.getpid()}.json"
    extra = cli_args(profile, mcp_cfg)
    cmd = [shutil.which("claude") or "claude", "-p", *extra, *a.claude_args]
    rec["cmd"] = cmd[1:]
    print(json.dumps(rec, ensure_ascii=False), file=sys.stderr)
    log = os.environ.get("LAYA_LAUNCH_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    if a.dry_run:
        mcp_cfg.unlink(missing_ok=True)
        return 0
    # Bo env cua app desktop de claude dung dang nhap CLI; de bai qua stdin (shim .cmd cat tham so nhieu dong)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "ANTHROPIC", "AI_AGENT", "BAGGAGE"))}
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        return subprocess.run(cmd, cwd=a.cwd, env=env, input=task, text=True, encoding="utf-8").returncode
    finally:
        mcp_cfg.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
