"""Cancellation fees.

The fee depends on how many hours before the appointment it is cancelled.
"""

from datetime import timedelta

import pytest

from clinic.cancellation import cancel, notice_hours
from tests.helpers import THU, at


@pytest.mark.parametrize("hours_before, fee", [(48, 0), (25, 0)])
def test_fee_by_notice(service, clock, hours_before, fee):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))
    clock.set(appt.start - timedelta(hours=hours_before))

    charged = cancel(service, appt)

    assert charged == fee
    assert appt.fee == fee


def test_notice_hours_computed(service, clock):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    assert notice_hours(appt, clock.now()) == 74

    clock.advance(hours=30, minutes=30)

    assert notice_hours(appt, clock.now()) == 43.5


def test_fee_recorded_on_appointment(service, clock):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))
    clock.set(appt.start - timedelta(hours=30))

    cancel(service, appt)

    assert service.get(appt.id).fee == 0


def test_cancel_after_start_rejected(service, clock):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))
    clock.set(appt.start + timedelta(minutes=5))

    with pytest.raises(ValueError):
        cancel(service, appt)

    assert appt.status == "booked"


def test_new_booking_has_no_fee(service):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))
    other = service.book("pat-2", "p2", at(THU, "14:00"))

    assert appt.fee == 0
    assert other.fee == 0
    assert all(a.fee == 0 for a in service.appointments)
