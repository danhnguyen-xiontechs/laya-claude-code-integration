"""Booking appointments.

BookingService.book(patient_id, provider_id, start) returns an Appointment
and plans its reminder.
"""

import pytest

from clinic.booking import NotOffered, SlotTaken
from tests.helpers import TUE, WED, at


def test_book_free_slot(service):
    appt = service.book("pat-1", "p1", at(TUE, "09:20"))

    assert appt.status == "booked"
    assert appt.start == at(TUE, "09:20")
    assert at(TUE, "09:20") not in [s.start for s in service.free_slots("p1", TUE)]


def test_taken_slot_raises(service):
    service.book("pat-1", "p1", at(TUE, "09:20"))

    with pytest.raises(SlotTaken):
        service.book("pat-2", "p1", at(TUE, "09:20"))

    assert len(service.appointments) == 1


def test_time_off_the_grid_rejected(service):
    with pytest.raises(NotOffered):
        service.book("pat-1", "p1", at(TUE, "09:10"))

    with pytest.raises(NotOffered):
        service.book("pat-1", "p1", at(TUE, "13:00"))

    assert service.appointments == []


def test_booking_stores_appointment(service):
    appt = service.book("pat-1", "p2", at(WED, "15:40"))

    assert service.appointments == [appt]
    assert appt.end == at(WED, "16:00")
    assert appt.provider_id == "p2"
    assert appt.patient_id == "pat-1"
    assert service.for_patient("pat-1") == [appt]


def test_unknown_provider_raises(service):
    with pytest.raises(KeyError):
        service.book("pat-1", "p9", at(TUE, "09:20"))

    with pytest.raises(KeyError):
        service.free_slots("p9", TUE)


def test_appointment_ids_increase(service):
    first = service.book("pat-1", "p1", at(TUE, "09:00"))
    second = service.book("pat-2", "p1", at(TUE, "09:20"))

    assert (first.id, second.id) == (1, 2)
    assert service.get(2) is second

    third = service.book("pat-3", "p2", at(TUE, "14:00"))

    assert third.id == 3
