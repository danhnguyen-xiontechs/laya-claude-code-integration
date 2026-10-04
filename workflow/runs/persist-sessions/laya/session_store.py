# session_store.py - luu bang session cua router_proxy ra file JSON, giu qua lan khoi dong lai.
# Chi dung thu vien chuan. Ghi file atomic (tmp + fsync + os.replace) trong thread rieng, khong chan event loop.
import asyncio, json, os, sys, tempfile, time
from pathlib import Path

MAX_AGE = 24 * 3600  # bo session cu hon 24h khi nap
TIERS = ("haiku", "sonnet", "opus")  # phai khop voi khoa cua TIER_RANK trong workflow/hooks/laya_common.py


def _warn(msg: str):
    print(f"[sessions] {msg}", file=sys.stderr)


def _num(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def load(path, now=None, max_age=MAX_AGE) -> dict:
    """Doc file session; khong bao gio raise. File thieu -> {}; file hong -> canh bao, {}."""
    path = Path(path)
    now = time.time() if now is None else now
    try:
        raw = path.read_bytes()
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return {}
    except OSError as e:
        _warn(f"cannot read {path}: {e}")
        return {}
    try:
        if not raw.strip():
            raise ValueError("empty file")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"top level is {type(data).__name__}, expected object")
    except (UnicodeDecodeError, ValueError) as e:
        _warn(f"ignoring corrupt {path}: {e}")
        return {}
    out, invalid, expired = {}, 0, 0
    for k, v in data.items():
        if not (isinstance(k, str) and isinstance(v, dict) and v.get("tier") in TIERS
                and isinstance(v.get("model"), str) and v["model"]
                and isinstance(v.get("turns"), int) and not isinstance(v["turns"], bool) and v["turns"] >= 0):
            invalid += 1
            continue
        if "ts" not in v:
            ts = mtime  # file cu chua co ts: dung thoi diem ghi file
        elif _num(v["ts"]):
            ts = float(v["ts"])
        else:
            invalid += 1
            continue
        ts = min(ts, now)
        if now - ts > max_age:
            expired += 1
            continue
        out[k] = {"tier": v["tier"], "model": v["model"], "turns": v["turns"], "ts": float(ts)}
    _warn(f"loaded {len(out)} session(s) from {path}; dropped {expired} expired, {invalid} invalid")
    return out


def write_atomic(path, data):
    """Ghi JSON atomic: file tmp cung thu muc, fsync, os.replace. Loi thi xoa tmp va raise lai."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        for attempt in range(3):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:  # Windows: file dich dang bi mo boi tien trinh khac
                if attempt == 2:
                    raise
                time.sleep(0.05)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class Saver:
    """Gop nhieu lan danh dau thanh it lan ghi; ghi trong thread, chi mot task ghi tai mot thoi diem."""

    def __init__(self, path, sessions: dict):
        self.path, self.sessions = Path(path), sessions
        self._dirty = False
        self._task: asyncio.Task | None = None

    def mark(self):
        """Goi tu event loop sau khi sessions thay doi."""
        self._dirty = True
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def _run(self):
        while self._dirty:
            self._dirty = False
            snap = {k: dict(v) for k, v in self.sessions.items()}
            try:
                await asyncio.to_thread(write_atomic, self.path, snap)
            except Exception as e:
                _warn(f"save failed: {e!r}")

    async def flush(self):
        if self._task is not None:
            await self._task
