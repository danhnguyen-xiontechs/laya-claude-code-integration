import pytest

from rooms.calendar import Conflict
from tests.conftest import at


def test_overlapping_booking_conflicts_and_first_is_kept(cal):
    first = cal.book("R1", at(2), at(4))
    with pytest.raises(Conflict):
        cal.book("R1", at(3), at(5))
    assert list(cal.items) == [first]


def test_same_time_other_room_is_fine(cal):
    cal.book("R1", at(2), at(4))
    cal.book("R2", at(2), at(4))
    assert len(cal.items) == 2


def test_back_to_back_bookings_allowed(cal):
    cal.book("R1", at(2), at(3))
    cal.book("R1", at(3), at(4))
    assert len(cal.items) == 2
