import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import session_store as ss  # noqa: E402

NOW = 1_800_000_000.0


def good(ts):
    return {"tier": "sonnet", "model": "m", "turns": 1, "ts": ts}


def test_missing_file(tmp_path):
    assert ss.load_sessions(tmp_path / "nope.json", now=NOW) == {}


def test_roundtrip_creates_parent(tmp_path):
    p = tmp_path / "a" / "b" / "sessions.json"
    data = {"k1": good(NOW), "k2": {**good(NOW - 10), "tier": "opus", "model": "é"}}
    ss.save_sessions_atomic(p, data)
    assert ss.load_sessions(p, now=NOW) == data


@pytest.mark.parametrize("content", [b"{not json", b"", b"[]", b'"x"', b"null", b"\xff\xfe\x00"])
def test_corrupt_file(tmp_path, content):
    p = tmp_path / "sessions.json"
    p.write_bytes(content)
    assert ss.load_sessions(p, now=NOW) == {}


def test_bad_entries_dropped(tmp_path):
    p = tmp_path / "sessions.json"
    items = {
        "ok": good(NOW),
        "nondict": "x",
        "notier": {"model": "m", "turns": 1, "ts": NOW},
        "badtier": {**good(NOW), "tier": "gpt"},
        "model5": {**good(NOW), "model": 5},
        "turnsstr": {**good(NOW), "turns": "3"},
        "turnsbool": {**good(NOW), "turns": True},
        "nots": {"tier": "sonnet", "model": "m", "turns": 1},
        "tsstr": {**good(NOW), "ts": "2026"},
        "tsbool": {**good(NOW), "ts": True},
    }
    text = json.dumps(items)[:-1] + ', "tsnan": {"tier": "sonnet", "model": "m", "turns": 1, "ts": NaN}}'
    p.write_text(text, encoding="utf-8")
    assert ss.load_sessions(p, now=NOW) == {"ok": good(NOW)}


def test_expiry(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text(json.dumps({
        "old": good(NOW - ss.TTL_SECONDS - 1),
        "edge": good(NOW - ss.TTL_SECONDS + 60),
        "future": good(NOW + 3600),
    }), encoding="utf-8")
    assert set(ss.load_sessions(p, now=NOW)) == {"edge"}


def test_no_temp_left_after_save(tmp_path):
    p = tmp_path / "sessions.json"
    ss.save_sessions_atomic(p, {"k": good(NOW)})
    assert [f.name for f in tmp_path.iterdir()] == ["sessions.json"]


def _raise_oserror(*a, **k):
    raise OSError("boom")


@pytest.mark.parametrize("mode", ["typeerror", "fsync", "replace"])
def test_failed_write_keeps_old(tmp_path, monkeypatch, mode):
    p = tmp_path / "sessions.json"
    ss.save_sessions_atomic(p, {"k": good(NOW)})
    old = p.read_bytes()
    data = {"k2": good(NOW)}
    if mode == "typeerror":
        data = {"k2": object()}
        exc = TypeError
    else:
        exc = OSError
        monkeypatch.setattr(ss.os, "fsync" if mode == "fsync" else "replace", _raise_oserror)
    with pytest.raises(exc):
        ss.save_sessions_atomic(p, data)
    assert p.read_bytes() == old
    assert [f.name for f in tmp_path.iterdir()] == ["sessions.json"]


def test_writer_coalesces_no_overlap(tmp_path, monkeypatch):
    p = tmp_path / "sessions.json"
    real = ss.save_sessions_atomic
    state = {"cur": 0, "max": 0, "calls": 0}

    def wrapper(path, data):
        state["cur"] += 1
        state["calls"] += 1
        state["max"] = max(state["max"], state["cur"])
        try:
            time.sleep(0.02)
            real(path, data)
        finally:
            state["cur"] -= 1

    monkeypatch.setattr(ss, "save_sessions_atomic", wrapper)
    d = {}
    w = ss.SessionWriter(p, lambda: dict(d))

    async def main():
        for i in range(5):
            d["k"] = good(NOW + i)
            w.schedule()
            await asyncio.sleep(0)
        await w.flush()

    asyncio.run(main())
    assert state["max"] == 1
    assert state["calls"] <= 2
    assert json.loads(p.read_text(encoding="utf-8")) == d


def test_writer_error_swallowed_then_recovers(tmp_path, monkeypatch):
    p = tmp_path / "sessions.json"
    d = {"k": good(NOW)}
    w = ss.SessionWriter(p, lambda: dict(d))
    real = ss.save_sessions_atomic
    monkeypatch.setattr(ss, "save_sessions_atomic", _raise_oserror)

    async def first():
        w.schedule()
        await w.flush()

    asyncio.run(first())
    assert not p.exists()
    monkeypatch.setattr(ss, "save_sessions_atomic", real)

    async def second():
        w.schedule()
        await w.flush()

    asyncio.run(second())
    assert json.loads(p.read_text(encoding="utf-8")) == d


def test_schedule_without_loop_is_sync(tmp_path):
    p = tmp_path / "sessions.json"
    d = {"k": good(NOW)}
    ss.SessionWriter(p, lambda: dict(d)).schedule()
    assert json.loads(p.read_text(encoding="utf-8")) == d


def test_sessions_path(tmp_path):
    assert ss.sessions_path({"ROUTER_SESSIONS_FILE": str(tmp_path / "x.json")}, tmp_path / "d") == tmp_path / "x.json"
    assert ss.sessions_path({"ROUTER_SESSIONS_FILE": ""}, tmp_path) == tmp_path / "sessions.json"
    assert ss.sessions_path({}, tmp_path) == tmp_path / "sessions.json"
