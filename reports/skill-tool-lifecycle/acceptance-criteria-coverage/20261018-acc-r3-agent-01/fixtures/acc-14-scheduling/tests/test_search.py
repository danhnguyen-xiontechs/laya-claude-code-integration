"""Finding a free slot.

earliest_free() walks forward day by day from a start day and returns the
first free slot of a provider.
"""

from clinic.slots import earliest_free
from tests.helpers import TUE, WED, at


def test_earliest_free_slot(service):
    slot = earliest_free(service, "p1", TUE)
    afternoon = earliest_free(service, "p2", TUE)

    assert slot.start == at(TUE, "09:00")
    assert slot.provider_id == "p1"
    assert afternoon.start == at(TUE, "14:00")


def test_earliest_free_skips_taken(service):
    service.book("pat-1", "p1", at(TUE, "09:00"))
    service.book("pat-2", "p1", at(TUE, "09:20"))

    slot = earliest_free(service, "p1", TUE)

    assert slot.start == at(TUE, "09:40")


def test_earliest_free_moves_to_next_day(service):
    tuesday = [
        "09:00", "09:20", "09:40",
        "10:00", "10:20", "10:40",
        "11:00", "11:20", "11:40",
    ]
    for i, hhmm in enumerate(tuesday):
        service.book(f"walk-in-{i}", "p1", at(TUE, hhmm))

    assert service.free_slots("p1", TUE) == []

    slot = earliest_free(service, "p1", TUE)

    assert slot.start == at(WED, "09:00")


def test_free_slots_for_second_provider(service):
    free = service.free_slots("p2", WED)

    assert [s.start for s in free][:3] == [at(WED, "14:00"), at(WED, "14:20"), at(WED, "14:40")]
    assert len(free) == 9


def test_search_with_zero_days(service):
    assert earliest_free(service, "p1", TUE, days=0) is None

    one_day = earliest_free(service, "p1", TUE, days=1)

    assert one_day.start == at(TUE, "09:00")
