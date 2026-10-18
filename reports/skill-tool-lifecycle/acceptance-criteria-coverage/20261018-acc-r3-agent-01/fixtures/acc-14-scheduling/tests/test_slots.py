"""Slots of a provider on one day.

day_slots() lists every slot of the working block; offered_slots() also
checks the calendar; the booking service subtracts what is booked.
"""

from datetime import timedelta

from clinic.slots import Slot, day_slots, offered_slots
from tests.helpers import SAT, TUE, at


def test_day_has_nine_slots(directory):
    slots = day_slots(directory.get("p1"), TUE)
    afternoon = day_slots(directory.get("p2"), TUE)

    assert len(slots) == 9
    assert slots[0].start == at(TUE, "09:00")
    assert slots[-1].start == at(TUE, "11:40")
    assert len(afternoon) == 9


def test_slot_belongs_to_provider(directory):
    slots = day_slots(directory.get("p2"), TUE)

    assert {s.provider_id for s in slots} == {"p2"}
    assert slots[0].start == at(TUE, "14:00")
    assert slots[-1].end == at(TUE, "17:00")
    assert all(s.start.date() == TUE for s in slots)


def test_no_slots_on_days_off(directory, holidays):
    saturday = offered_slots(directory.get("p1"), SAT, holidays)
    friday_p2 = offered_slots(directory.get("p2"), SAT - timedelta(days=1), holidays)

    assert saturday == []
    assert friday_p2 == []


def test_free_slots_skip_booked_ones(service):
    service.book("pat-1", "p1", at(TUE, "09:20"))

    free = [s.start for s in service.free_slots("p1", TUE)]

    assert at(TUE, "09:20") not in free
    assert at(TUE, "09:00") in free
    assert len(free) == 8

    other_provider = service.free_slots("p2", TUE)

    assert len(other_provider) == 9


def test_slots_are_values(directory):
    first = day_slots(directory.get("p1"), TUE)[0]
    again = Slot("p1", at(TUE, "09:00"), at(TUE, "09:20"))

    assert first == again
    assert len({first, again}) == 1

    other = Slot("p2", at(TUE, "09:00"), at(TUE, "09:20"))

    assert other != first
