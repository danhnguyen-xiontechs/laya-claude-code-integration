"""How far ahead online booking is open.

Patients can book up to 60 days ahead; days further out open later.
"""

from datetime import timedelta

import pytest

from clinic.booking import BOOKING_HORIZON, BookingClosed
from tests.conftest import NOW
from tests.helpers import at


def test_booking_60_days_ahead_allowed(service):
    day = (NOW + timedelta(days=59)).date()

    appt = service.book("pat-1", "p1", at(day, "09:00"))

    assert appt.status == "booked"


def test_booking_61_days_ahead_rejected(service):
    day = (NOW + timedelta(days=61)).date()

    with pytest.raises(BookingClosed):
        service.book("pat-1", "p1", at(day, "09:00"))

    assert service.appointments == []


def test_window_end_moves_with_clock(service, clock):
    assert service.window_end() == NOW + timedelta(days=60)

    clock.advance(days=3)

    assert service.window_end() == NOW + timedelta(days=63)


def test_horizon_setting(service):
    assert BOOKING_HORIZON == timedelta(days=60)

    last_day = service.window_end().date()

    assert last_day.isoformat() == "2026-05-01"
