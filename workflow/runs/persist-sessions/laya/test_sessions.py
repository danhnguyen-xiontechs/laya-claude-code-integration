# test_sessions.py - kiem tra session_store (luu session cua router_proxy ra file JSON).
# Chay tu thu muc goc repo:  <uv tool dir>\laya\Scripts\python.exe -m pytest proxy/test_sessions.py -q
import asyncio, json, os, time

import pytest

import session_store as ss

NOW = 1_800_000_000.0


def entry(tier="sonnet", turns=1, ts=None, model=None):
    e = {"tier": tier, "model": model or f"claude-{tier}", "turns": turns}
    if ts is not None:
        e["ts"] = ts
    return e


def test_missing_file(tmp_path):
    assert ss.load(tmp_path / "nope.json") == {}


def test_roundtrip(tmp_path):
    p = tmp_path / "sessions.json"
    data = {"a": entry("haiku", 2, NOW - 10), "b": entry("opus", 0, NOW)}
    ss.write_atomic(p, data)
    got = ss.load(p, now=NOW)
    assert got == {k: {**v, "ts": float(v["ts"])} for k, v in data.items()}


@pytest.mark.parametrize("raw", [b"{not json", b"", b"   \n", b"\xff\xfe{", b"[1, 2]"])
def test_corrupt_file(tmp_path, raw):
    p = tmp_path / "sessions.json"
    p.write_bytes(raw)
    assert ss.load(p, now=NOW) == {}


def test_bad_entries_filtered(tmp_path):
    p = tmp_path / "sessions.json"
    data = {
        "ok": entry("sonnet", 3, NOW),
        "notdict": [1, 2],
        "badtier": entry("gpt", 1, NOW),
        "strturns": {**entry(ts=NOW), "turns": "3"},
        "boolturns": {**entry(ts=NOW), "turns": True},
        "negturns": {**entry(ts=NOW), "turns": -1},
        "intmodel": {**entry(ts=NOW), "model": 5},
        "emptymodel": {**entry(ts=NOW), "model": ""},
        "strts": entry(ts="x"),
        "boolts": entry(ts=True),
    }
    p.write_text(json.dumps(data), encoding="utf-8")
    assert list(ss.load(p, now=NOW)) == ["ok"]


def test_expiry(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text(json.dumps({"old": entry(ts=NOW - 25 * 3600), "new": entry(ts=NOW - 3600)}), encoding="utf-8")
    got = ss.load(p, now=NOW)
    assert list(got) == ["new"]
    assert got["new"]["ts"] == NOW - 3600


@pytest.mark.parametrize("age,kept", [(2 * 3600, True), (48 * 3600, False)])
def test_legacy_no_ts_uses_mtime(tmp_path, age, kept):
    p = tmp_path / "sessions.json"
    p.write_text(json.dumps({"k": entry()}), encoding="utf-8")
    mtime = NOW - age
    os.utime(p, (mtime, mtime))
    got = ss.load(p, now=NOW)
    if kept:
        assert got["k"]["ts"] == pytest.approx(mtime)
    else:
        assert got == {}


def test_future_ts_clamped(tmp_path):
    p = tmp_path / "sessions.json"
    p.write_text(json.dumps({"k": entry(ts=NOW + 3600)}), encoding="utf-8")
    assert ss.load(p, now=NOW)["k"]["ts"] == NOW


@pytest.mark.parametrize("attr", ["replace", "fsync"])
def test_atomic_write_failure_keeps_original(tmp_path, monkeypatch, attr):
    p = tmp_path / "sessions.json"
    original = {"k": entry(ts=NOW)}
    ss.write_atomic(p, original)
    before = p.read_bytes()

    def boom(*a, **kw):
        raise OSError("simulated failure")

    monkeypatch.setattr(ss.os, attr, boom)
    with pytest.raises(OSError):
        ss.write_atomic(p, {"other": entry("opus", ts=NOW)})
    monkeypatch.undo()
    assert p.read_bytes() == before
    assert list(tmp_path.glob("*.tmp")) == []


def test_saver_coalesces_and_keeps_final_state(tmp_path, monkeypatch):
    p = tmp_path / "sessions.json"
    calls = []
    real = ss.write_atomic

    def slow_write(path, data):
        calls.append(1)
        time.sleep(0.05)
        real(path, data)

    monkeypatch.setattr(ss, "write_atomic", slow_write)
    sessions = {}
    saver = ss.Saver(p, sessions)

    async def main():
        for i in range(10):
            sessions[f"k{i}"] = entry(turns=i, ts=NOW)
            saver.mark()
        await asyncio.sleep(0.01)
        sessions["k0"] = entry("opus", 5, NOW)
        sessions["last"] = entry("haiku", 1, NOW)
        saver.mark()
        await saver.flush()

    asyncio.run(main())
    assert json.loads(p.read_text(encoding="utf-8")) == sessions
    assert len(calls) < 11


def test_saver_write_error_does_not_raise(tmp_path, monkeypatch):
    def boom(path, data):
        raise OSError("disk full")

    monkeypatch.setattr(ss, "write_atomic", boom)
    sessions = {"k": entry(ts=NOW)}
    saver = ss.Saver(tmp_path / "sessions.json", sessions)

    async def main():
        saver.mark()
        await saver.flush()

    asyncio.run(main())
    assert not (tmp_path / "sessions.json").exists()


def test_clear_persists_empty(tmp_path):
    p = tmp_path / "sessions.json"
    sessions = {"k": entry(ts=NOW)}
    saver = ss.Saver(p, sessions)

    async def main():
        saver.mark()
        await saver.flush()
        assert ss.load(p, now=NOW) != {}
        sessions.clear()
        saver.mark()
        await saver.flush()

    asyncio.run(main())
    assert json.loads(p.read_text(encoding="utf-8")) == {}
    assert ss.load(p, now=NOW) == {}
