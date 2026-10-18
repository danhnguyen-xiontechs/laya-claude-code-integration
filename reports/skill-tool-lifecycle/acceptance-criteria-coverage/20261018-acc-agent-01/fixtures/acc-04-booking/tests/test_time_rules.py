import pytest

from rooms.calendar import Rejected
from tests.conftest import NOW, at


def test_booking_in_the_past_is_rejected(cal):
    with pytest.raises(Rejected):
        cal.book("R1", NOW.replace(hour=7), NOW.replace(hour=8))


def test_five_hour_booking_is_rejected(cal):
    with pytest.raises(Rejected):
        cal.book("R1", at(2), at(7))


def test_two_hour_booking_is_fine(cal):
    assert cal.book("R1", at(2), at(4))
