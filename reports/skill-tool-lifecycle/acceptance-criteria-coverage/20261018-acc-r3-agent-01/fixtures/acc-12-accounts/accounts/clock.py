"""A clock the services read the time from; tests move it forward by hand."""

from datetime import datetime, timedelta

START = datetime(2026, 3, 2, 9, 0, 0)


class FakeClock:
    def __init__(self, start=START):
        self._now = start

    def now(self):
        return self._now

    def advance(self, *, days=0, hours=0, minutes=0, seconds=0):
        step = timedelta(days=days, hours=hours, minutes=minutes, seconds=seconds)
        if step < timedelta(0):
            raise ValueError("the clock only moves forward")
        self._now += step
        return self._now

    def set(self, when):
        if when < self._now:
            raise ValueError("the clock only moves forward")
        self._now = when

    def iso(self):
        return self._now.isoformat(timespec="seconds")
