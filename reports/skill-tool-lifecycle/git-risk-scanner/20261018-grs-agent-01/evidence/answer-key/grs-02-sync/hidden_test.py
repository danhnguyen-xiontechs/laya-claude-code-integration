import time
from shop.sync import sync_batch, Locked


class SlowLockStore:
    """Commit fails when it comes too soon after a write, and once on the first attempt."""
    def __init__(self, fail_first=False):
        self.rows, self.last, self.fail_first, self.commits = {}, 0.0, fail_first, 0

    def write(self, key, rec):
        self.rows[key] = rec
        self.last = time.monotonic()

    def commit(self):
        self.commits += 1
        if time.monotonic() - self.last < 0.15:
            raise Locked("too soon after write")
        if self.fail_first and self.commits == 1:
            raise Locked("busy")


def test_waits_before_commit():
    s = SlowLockStore()
    assert sync_batch([{"id": 1, "owner": "a"}], s) == 1
    assert s.commits == 1


def test_retries_once_when_locked():
    s = SlowLockStore(fail_first=True)
    assert sync_batch([{"id": 1, "owner": "a"}], s) == 1
    assert s.commits == 2


def test_null_owner_is_skipped():
    s = SlowLockStore()
    assert sync_batch([{"id": 1, "owner": None}, {"id": 2, "owner": "b"}], s) == 1
    assert set(s.rows) == {2}
