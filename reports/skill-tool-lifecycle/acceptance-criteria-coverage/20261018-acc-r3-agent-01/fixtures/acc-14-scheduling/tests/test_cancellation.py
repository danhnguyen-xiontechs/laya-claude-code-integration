"""Cancelling appointments.

cancel(service, appointment, by="patient") marks the appointment cancelled
and returns the fee charged, in cents.
"""

import pytest

from clinic.cancellation import cancel
from tests.helpers import THU, TUE, at


def test_cancel_frees_slot(service):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    cancel(service, appt)

    free = [s.start for s in service.free_slots("p1", THU)]

    assert at(THU, "10:00") in free


def test_cancel_sets_status(service):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    cancel(service, appt)

    assert appt.status == "cancelled"
    assert service.get(appt.id).status == "cancelled"


def test_cancel_twice_rejected(service):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))
    cancel(service, appt)

    with pytest.raises(ValueError):
        cancel(service, appt)

    assert appt.status == "cancelled"


def test_cancel_keeps_other_bookings(service):
    keep = service.book("pat-2", "p1", at(THU, "09:40"))
    drop = service.book("pat-1", "p1", at(THU, "10:00"))

    cancel(service, drop)

    assert keep.status == "booked"
    assert at(THU, "09:40") not in [s.start for s in service.free_slots("p1", THU)]


def test_cancel_by_provider(service):
    appt = service.book("pat-1", "p1", at(TUE, "11:00"))

    fee = cancel(service, appt, by="provider")

    assert fee == 0
    assert appt.status == "cancelled"
    assert appt.fee == 0
    assert at(TUE, "11:00") in [s.start for s in service.free_slots("p1", TUE)]
