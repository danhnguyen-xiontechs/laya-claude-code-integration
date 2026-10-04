"""Luu ben vung bang sessions cua router_proxy: file JSON, ghi nguyen tu (crash-safe), khong chan event loop."""
import asyncio
import json
import logging
import math
import os
import tempfile
import time
from pathlib import Path

log = logging.getLogger("router.sessions")

TTL_SECONDS = 24 * 3600
FUTURE_SKEW = 300
DEFAULT_TIERS = ("haiku", "sonnet", "opus")


def sessions_path(env, default_dir) -> Path:
    v = env.get("ROUTER_SESSIONS_FILE")
    return Path(v) if v else Path(default_dir) / "sessions.json"


def load_sessions(path, now=None, ttl=TTL_SECONDS, valid_tiers=DEFAULT_TIERS) -> dict:
    """Doc file; khong bao gio raise. File thieu -> {}; hong -> {} kem canh bao; muc sai/het han bi bo."""
    path = Path(path)
    if not path.exists():
        return {}
    now = time.time() if now is None else now
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("sessions file %s unreadable (%s); starting empty", path, e)
        return {}
    if not isinstance(raw, dict):
        log.warning("sessions file %s: top level is not an object; starting empty", path)
        return {}
    out, dropped = {}, 0
    for key, v in raw.items():
        ok = (
            isinstance(key, str) and key
            and isinstance(v, dict)
            and v.get("tier") in valid_tiers
            and isinstance(v.get("model"), str) and v["model"]
            and isinstance(v.get("turns"), int) and not isinstance(v["turns"], bool) and v["turns"] >= 0
        )
        if ok:
            ts = v.get("ts")
            ok = (isinstance(ts, (int, float)) and not isinstance(ts, bool) and math.isfinite(ts)
                  and now - ts <= ttl and ts <= now + FUTURE_SKEW)
        if ok:
            out[key] = {"tier": v["tier"], "model": v["model"], "turns": v["turns"], "ts": ts}
        else:
            dropped += 1
    if dropped:
        log.warning("sessions file %s: dropped %d invalid/expired entries", path, dropped)
    return out


def save_sessions_atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class SessionWriter:
    """Gop nhieu schedule() thanh it lan ghi; ghi trong thread, khong bao gio chay chong nhau."""

    def __init__(self, path, snapshot):
        self.path = Path(path)
        self.snapshot = snapshot
        self._dirty = False
        self._task = None

    def schedule(self):
        self._dirty = True
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._write(self.snapshot())
            return
        if self._task is None or self._task.done():
            self._task = loop.create_task(self._run())

    async def _run(self):
        while self._dirty:
            self._dirty = False
            snap = self.snapshot()
            await asyncio.to_thread(self._write, snap)

    def _write(self, snap):
        try:
            save_sessions_atomic(self.path, snap)
        except Exception:
            log.warning("could not write sessions file %s", self.path, exc_info=True)

    async def flush(self):
        t = self._task
        if t:
            await t
