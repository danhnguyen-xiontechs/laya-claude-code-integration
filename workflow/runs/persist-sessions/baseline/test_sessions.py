import asyncio, json, os, time

import pytest

import session_store
from session_store import SessionStore, load, write_atomic


def entry(tier="sonnet", ts=None, turns=1):
    return {"tier": tier, "model": f"claude-{tier}", "turns": turns, "ts": time.time() if ts is None else ts}


def test_missing_file_gives_empty(tmp_path):
    assert load(tmp_path / "nope.json") == {}


def test_save_then_load_roundtrip(tmp_path):
    path = tmp_path / "sessions.json"
    sessions = {"a": entry("haiku"), "b": entry("opus", turns=3)}
    asyncio.run(SessionStore(path).save(sessions))
    assert json.loads(path.read_text(encoding="utf-8")) == sessions
    assert SessionStore(path).load() == sessions


def test_save_overwrites_and_keeps_order(tmp_path):
    path = tmp_path / "sessions.json"
    store = SessionStore(path)
    sessions = {"a": entry("haiku")}

    async def run():
        await store.save(dict(sessions))
        sessions["a"] = entry("opus")  # nang tang
        await store.save(dict(sessions))

    asyncio.run(run())
    assert load(path)["a"]["tier"] == "opus"


@pytest.mark.parametrize("content", [b"{not json", b"", b"[1, 2]", b'"str"', b'{"a": {"ts": 1', b"\xff\xfe\x00"])
def test_corrupt_file_gives_empty(tmp_path, content):
    path = tmp_path / "sessions.json"
    path.write_bytes(content)
    assert load(path) == {}


def test_bad_entries_are_dropped(tmp_path):
    path = tmp_path / "sessions.json"
    good = entry()
    path.write_text(json.dumps({"good": good, "no_ts": {"tier": "opus"}, "str_ts": {**good, "ts": "x"},
                                "not_dict": 5}), encoding="utf-8")
    assert load(path) == {"good": good}


def test_expired_sessions_dropped_on_load(tmp_path):
    path = tmp_path / "sessions.json"
    now = 1_000_000.0
    data = {"fresh": entry(ts=now - 3600), "edge": entry(ts=now - 24 * 3600),
            "old": entry(ts=now - 24 * 3600 - 1), "ancient": entry(ts=0)}
    path.write_text(json.dumps(data), encoding="utf-8")
    assert set(load(path, now=now)) == {"fresh", "edge"}


def test_atomic_write_keeps_old_file_on_crash(tmp_path, monkeypatch):
    path = tmp_path / "sessions.json"
    old = {"a": entry("haiku")}
    write_atomic(path, json.dumps(old))

    def boom(src, dst):
        raise OSError("simulated crash before rename")

    monkeypatch.setattr(session_store.os, "replace", boom)
    with pytest.raises(OSError):
        write_atomic(path, json.dumps({"a": entry("opus")}))
    assert json.loads(path.read_text(encoding="utf-8")) == old  # file cu nguyen ven
    assert os.listdir(tmp_path) == ["sessions.json"]  # khong de lai file tam


def test_atomic_write_crash_during_write(tmp_path, monkeypatch):
    path = tmp_path / "sessions.json"
    write_atomic(path, '{"a": 1}')

    def boom(fd):
        raise OSError("simulated disk failure")

    monkeypatch.setattr(session_store.os, "fsync", boom)
    with pytest.raises(OSError):
        write_atomic(path, '{"a": 2}')
    assert path.read_text(encoding="utf-8") == '{"a": 1}'
    assert os.listdir(tmp_path) == ["sessions.json"]


def test_save_failure_does_not_raise(tmp_path, monkeypatch, capsys):
    path = tmp_path / "sessions.json"
    monkeypatch.setattr(session_store.os, "replace", lambda s, d: (_ for _ in ()).throw(OSError("disk full")))
    asyncio.run(SessionStore(path).save({"a": entry()}))  # loi ghi khong lam hong request
    assert not path.exists()
    assert "disk full" in capsys.readouterr().err


def test_save_runs_off_event_loop(tmp_path, monkeypatch):
    path = tmp_path / "sessions.json"
    threads = []
    real = session_store.write_atomic

    def spy(p, text):
        import threading
        threads.append(threading.current_thread())
        real(p, text)

    monkeypatch.setattr(session_store, "write_atomic", spy)

    async def run():
        import threading
        await SessionStore(path).save({"a": entry()})
        return threading.current_thread()

    loop_thread = asyncio.run(run())
    assert threads and threads[0] is not loop_thread
    assert "a" in load(path)
