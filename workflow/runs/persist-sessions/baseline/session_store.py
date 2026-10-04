# session_store.py - luu bang session cua router_proxy ra file JSON de khoi dong lai khong mat quyet dinh.
# Khong phu thuoc fastapi/laya de test nhe.
import asyncio, json, os, sys, tempfile, time
from pathlib import Path

MAX_AGE = 24 * 3600  # session cu hon (theo "ts") bi bo khi nap


def load(path: Path, max_age: float = MAX_AGE, now: float | None = None) -> dict[str, dict]:
    """Nap session tu file. File thieu/hong khong bao gio lam proxy dung: tra ve {} va canh bao."""
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        print(f"[sessions] khong doc duoc {path}: {e}; bat dau voi bang rong", file=sys.stderr)
        return {}
    if not isinstance(data, dict):
        print(f"[sessions] {path} khong phai object JSON; bat dau voi bang rong", file=sys.stderr)
        return {}
    cutoff = (time.time() if now is None else now) - max_age
    return {k: v for k, v in data.items()
            if isinstance(v, dict) and isinstance(v.get("ts"), (int, float)) and v["ts"] >= cutoff}


def write_atomic(path: Path, text: str):
    """Ghi ra file tam cung thu muc, fsync, roi os.replace: file dich luon la ban cu hoac ban moi day du."""
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class SessionStore:
    """Ghi bang session ra dia trong thread rieng; lock giu thu tu ghi (ban chup sau khong bi ban truoc de len)."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.lock = asyncio.Lock()

    def load(self) -> dict[str, dict]:
        return load(self.path)

    async def save(self, sessions: dict[str, dict]):
        text = json.dumps(sessions, ensure_ascii=False)  # chup ngay tren event loop, truoc khi dict doi tiep
        async with self.lock:
            try:
                await asyncio.to_thread(write_atomic, self.path, text)
            except OSError as e:
                print(f"[sessions] khong ghi duoc {self.path}: {e}", file=sys.stderr)
