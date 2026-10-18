"""The slot grid.

grid_times(start_hour, end_hour) lists the start times of a working block;
day_slots() turns them into Slot objects for a day.
"""

from datetime import timedelta

import pytest

from clinic.providers import Provider
from clinic.slots import SLOT_MINUTES, day_slots, grid_times
from tests.helpers import TUE


@pytest.mark.parametrize(
    "hours, expected",
    [
        ((9, 10), ["09:00", "09:20", "09:40"]),
        ((14, 15), ["14:00", "14:20", "14:40"]),
        ((8, 10), ["08:00", "08:20", "08:40", "09:00", "09:20", "09:40"]),
    ],
)
def test_grid(hours, expected):
    provider = Provider("px", "Dr Test", start_hour=hours[0], end_hour=hours[1])

    slots = day_slots(provider, TUE)

    assert [s.start.strftime("%H:%M") for s in slots] == expected
    assert all(s.end - s.start == timedelta(minutes=20) for s in slots)


def test_slot_length_setting():
    assert SLOT_MINUTES == 20


def test_grid_empty_without_hours():
    assert grid_times(9, 9) == []

    provider = Provider("px", "Dr Test", start_hour=13, end_hour=13)

    assert day_slots(provider, TUE) == []


def test_grid_rejects_reversed_hours():
    with pytest.raises(ValueError):
        grid_times(12, 9)


def test_slots_do_not_overlap(directory):
    slots = day_slots(directory.get("p2"), TUE)

    assert len(slots) > 1

    for earlier, later in zip(slots, slots[1:]):
        assert earlier.end <= later.start
        assert earlier.provider_id == later.provider_id
