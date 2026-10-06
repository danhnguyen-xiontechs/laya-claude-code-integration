"""laya_shim.py - lenh `claude` co Laya prune. Goi tu ham PowerShell `claude` (claude-shim.ps1).

  claude                      -> menu: session cu cua repo nay (resume, van cat) / [n] de bai moi / [f] nguyen ban
  claude "fix bug X"          -> Laya chon profile -> phien tuong tac, de bai la tin nhan dau
  claude -P bugfix "..."      -> ep profile
  claude -y "..."             -> khong hoi xac nhan
  claude --full ...           -> claude nguyen ban voi phan con lai
  claude -p / -c / -r / mcp … -> di thang claude that (-c/-r: van cat theo intent da ghi, neu co)
  claude "..." -- --model sonnet   -> co sau "--" chuyen cho claude

Moi phien mo qua shim duoc ghi vao ~/.laya/sessions.jsonl {session_id, cwd, intent, profile, task} de lan sau
resume khong phai hoi Laya. Chi thu vien chuan.
"""
import json, os, re, subprocess, sys, time, uuid
from pathlib import Path

import laya_launch as L

HOME = Path.home()
PROJECTS = HOME / ".claude" / "projects"
RECORDS = HOME / ".laya" / "sessions.jsonl"
PASSTHROUGH_FLAGS = {"-p", "--print", "--version", "-v", "--help", "-h", "--bg", "--teleport", "--from-pr", "--safe-mode", "--restricted"}
SUBCOMMANDS = {"mcp", "plugin", "auth", "update", "doctor", "config", "agents", "logs", "install", "migrate-installer", "setup-token"}
MAX_SESSIONS = 8


def slug(cwd: Path) -> str:
    return re.sub(r"[:\\/]", "-", str(cwd))


def records() -> dict:
    out = {}
    if RECORDS.exists():
        for line in RECORDS.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                out[r["session_id"]] = r
            except (ValueError, KeyError):
                pass
    return out


def record(session_id: str, cwd: Path, name: str | None, rec: dict, task: str) -> None:
    RECORDS.parent.mkdir(exist_ok=True)
    row = {"session_id": session_id, "cwd": str(cwd), "ts": rec.get("ts"), "profile": name,
           "intent": (rec.get("laya") or {}).get("intent"), "prob": (rec.get("laya") or {}).get("prob"), "task": task[:300]}
    with open(RECORDS, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def first_prompt(path: Path) -> tuple[str | None, str | None]:
    """(de bai dau, timestamp) cua mot transcript; bo qua dong lenh noi bo cua Claude Code."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"type":"user"' not in line:
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                if o.get("type") != "user" or o.get("isSidechain"):
                    continue
                c = o.get("message", {}).get("content")
                if isinstance(c, list):
                    c = " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
                if not isinstance(c, str) or not c.strip() or c.lstrip().startswith("<"):
                    continue
                return c.strip(), o.get("timestamp")
    except OSError:
        pass
    return None, None


def sessions(cwd: Path) -> list[dict]:
    d = PROJECTS / slug(cwd)
    if not d.is_dir():
        return []
    rows = []
    for p in sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True):
        if len(rows) >= MAX_SESSIONS:
            break
        task, ts = first_prompt(p)
        if task:
            rows.append({"id": p.stem, "task": task, "mtime": p.stat().st_mtime})
    return rows


def ago(t: float) -> str:
    s = time.time() - t
    if s < 3600:
        return f"{int(s // 60)} phut"
    if s < 86400:
        return f"{int(s // 3600)} gio"
    return f"{int(s // 86400)} ngay"


def one_line(s: str, n: int = 60) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def run_claude(args: list[str], cwd: Path) -> int:
    return subprocess.call([L.claude_bin(), *args], cwd=cwd, env=L.clean_env())


def launch(task: str, cwd: Path, cfg: dict, forced: str | None, yes: bool, dry: bool, extra: list[str],
           resume_id: str | None = None, known: dict | None = None) -> int:
    """Chon profile cho `task`, hien man hinh dau, roi mo phien (moi hoac resume) voi co cat."""
    if known and known.get("profile") in cfg["profiles"] and not forced:
        name, profile = known["profile"], cfg["profiles"][known["profile"]]
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "source": "record", "profile": name,
               "laya": {"intent": known.get("intent"), "prob": known.get("prob")}}
    else:
        name, profile, rec = L.pick_profile(task, cfg, forced)
    while True:
        lay = rec.get("laya") or {}
        head = f"intent={lay.get('intent')} p={lay.get('prob')}" if lay.get("intent") else f"laya: {rec.get('source')}"
        print(f"\n  Laya  {head}  ->  profile {name or '-'}: {L.describe(profile)}", file=sys.stderr)
        if yes:
            break
        ans = input("  [Enter] chay   [f] nguyen ban   [p] doi profile   [q] thoat > ").strip().lower()
        if ans == "":
            break
        if ans == "q":
            return 0
        if ans == "f":
            name, profile, rec = None, None, {**rec, "source": "manual_full", "profile": None}
            break
        if ans == "p":
            print("  profiles: " + ", ".join(cfg["profiles"]), file=sys.stderr)
            pn = input("  profile > ").strip()
            if pn in cfg["profiles"]:
                name, profile, rec = pn, cfg["profiles"][pn], {**rec, "source": "manual", "profile": pn}
    mcp_cfg = Path(os.environ.get("TEMP", "/tmp")) / f"laya_shim_mcp_{os.getpid()}.json"
    flags = L.cli_args(profile, mcp_cfg)
    if resume_id:
        cmd = ["-r", resume_id, *flags, *extra]
    else:
        resume_id = str(uuid.uuid4())
        cmd = ["--session-id", resume_id, *flags, *extra, task]
    rec["cmd"] = cmd
    L.log_rec(rec)
    if dry:
        mcp_cfg.unlink(missing_ok=True)
        return 0
    try:
        if not rec["cmd"][0] == "-r":
            record(resume_id, cwd, name, rec, task)
        return run_claude(cmd, cwd)
    finally:
        mcp_cfg.unlink(missing_ok=True)


def menu(cwd: Path, cfg: dict, forced: str | None, yes: bool, dry: bool, extra: list[str]) -> int:
    rows = sessions(cwd)
    known = records()
    print(f"\n  Laya · {cwd}", file=sys.stderr)
    for i, r in enumerate(rows, 1):
        k = known.get(r["id"])
        tag = f"{k['intent']} · {k['profile']}" if k else "chua phan loai"
        print(f"  [{i}] {ago(r['mtime']):>8}   {one_line(r['task']):<62} {tag}", file=sys.stderr)
    print("  [n] de bai moi        [f] Claude Code nguyen ban        [q] thoat", file=sys.stderr)
    ans = input("  > ").strip().lower()
    if ans in ("", "n"):
        task = input("  de bai > ").strip()
        if not task:
            return run_claude(extra, cwd)
        return launch(task, cwd, cfg, forced, yes, dry, extra)
    if ans == "f":
        return run_claude(extra, cwd)
    if ans == "q":
        return 0
    if ans.isdigit() and 1 <= int(ans) <= len(rows):
        r = rows[int(ans) - 1]
        return launch(r["task"], cwd, cfg, forced, yes, dry, extra, resume_id=r["id"], known=known.get(r["id"]))
    print("  khong hieu, thoat", file=sys.stderr)
    return 1


def main(argv: list[str]) -> int:
    cwd = Path.cwd()
    cfg = L.load_profiles()
    forced, yes, dry = None, False, False
    args, extra = argv, []
    if "--" in args:
        i = args.index("--")
        args, extra = args[:i], args[i + 1:]
    if "--full" in args:
        args.remove("--full")
        return run_claude(args + extra, cwd)
    # -c / -r <id>: resume, van cat theo ban ghi cu neu co
    if args and args[0] in ("-c", "--continue", "-r", "--resume"):
        rows = sessions(cwd)
        rid = args[1] if args[0] in ("-r", "--resume") and len(args) > 1 and not args[1].startswith("-") else (rows[0]["id"] if rows else None)
        row = next((r for r in rows if r["id"] == rid), None)
        if row:
            rest = args[2:] if args[0] in ("-r", "--resume") and len(args) > 1 and args[1] == rid else args[1:]
            return launch(row["task"], cwd, cfg, None, True, False, rest + extra, resume_id=rid, known=records().get(rid))
        return run_claude(args + extra, cwd)
    if args and (args[0] in SUBCOMMANDS or any(a in PASSTHROUGH_FLAGS for a in args)):
        return run_claude(args + extra, cwd)
    rest, task_parts = [], []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-P", "--profile") and i + 1 < len(args):
            forced = args[i + 1]
            i += 2
            continue
        if a == "-y":
            yes = True
        elif a == "--dry-run":
            dry = True
        elif a.startswith("-"):
            rest.append(a)
            if i + 1 < len(args) and not args[i + 1].startswith("-") and a not in ("-d", "--debug", "--verbose"):
                rest.append(args[i + 1])  # gia tri cua co (--model sonnet)
                i += 1
        else:
            task_parts.append(a)
        i += 1
    task = " ".join(task_parts).strip()
    if not task:
        return menu(cwd, cfg, forced, yes, dry, rest + extra)
    return launch(task, cwd, cfg, forced, yes, dry, rest + extra)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
