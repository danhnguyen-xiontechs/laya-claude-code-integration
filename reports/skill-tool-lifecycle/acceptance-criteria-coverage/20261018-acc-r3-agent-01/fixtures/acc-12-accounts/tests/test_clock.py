"""The test clock.

FakeClock starts at a fixed moment and moves only when told to, so the
services see exactly the times a test chooses.
"""

from datetime import datetime

import pytest

from accounts.clock import START, FakeClock


def test_clock_starts_at_fixed_time():
    assert FakeClock().now() == START
    assert START == datetime(2026, 3, 2, 9, 0, 0)


def test_advance_minutes_and_hours(clock):
    clock.advance(minutes=45)
    clock.advance(hours=2)

    assert clock.now() == datetime(2026, 3, 2, 11, 45, 0)

    returned = clock.advance(days=2, seconds=30)

    assert returned == clock.now()
    assert clock.now() == datetime(2026, 3, 4, 11, 45, 30)


def test_clock_never_goes_back(clock):
    with pytest.raises(ValueError):
        clock.advance(minutes=-1)

    with pytest.raises(ValueError):
        clock.set(datetime(2026, 1, 1))

    assert clock.now() == START


def test_iso_format(clock):
    clock.advance(seconds=7)

    assert clock.iso() == "2026-03-02T09:00:07"

    clock.advance(days=1, hours=14)

    assert clock.iso() == "2026-03-03T23:00:07"


def test_set_moves_clock_forward(clock):
    later = datetime(2026, 3, 9, 8, 30)

    clock.set(later)

    assert clock.now() == later
    assert clock.iso() == "2026-03-09T08:30:00"
